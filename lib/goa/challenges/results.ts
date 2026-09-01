import type { PoolClient } from "pg";
import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull, withClient } from "../../db";
import {
  asRecord,
  challengeAccess,
  publicId,
  semanticKey,
  writeAudit,
} from "../../goa-domain";
import { ApiError, stringValue } from "../../http";
import { bayesianAverage, indicatorBias, mean, meanDelta, spread } from "../analysis";
import { calculateMetric } from "../../metrics";
import { generateOpaqueToken, hashToken } from "../../security";
import { primaryEntryType } from "./entry-types";
import { generateShowcase } from "./showcase";
import type { MetricRow } from "./types";

interface SeriesEntry {
  key: string;
  label: string;
  value: number | null;
  sampleSize: number;
  formattedValue: string;
}

function metricSettings(metric: MetricRow): { minSample: number; bayesPriorWeight: number } {
  const settings = (metric.settings ?? {}) as Record<string, unknown>;
  const minSample = Number(settings.minSample);
  const bayesPriorWeight = Number(settings.bayesPriorWeight);
  return {
    minSample: Number.isFinite(minSample) && minSample > 0 ? Math.floor(minSample) : 1,
    bayesPriorWeight: Number.isFinite(bayesPriorWeight) && bayesPriorWeight >= 0 ? bayesPriorWeight : 4,
  };
}

function formatValue(value: number | null, decimalPlaces: number, suffix = ""): string {
  if (value === null) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: decimalPlaces })}${suffix}`;
}

interface RatingRow {
  value: number;
  item_id: string | null;
  item_title: string | null;
  participant_id: string;
  participant_name: string | null;
}

/** Numeric field values for a metric, tagged with their item and participant. */
async function ratingRows(client: PoolClient, metric: MetricRow): Promise<RatingRow[]> {
  const result = await client.query<RatingRow>(
    `SELECT (ev.number_scaled::float8 / (10 ^ f.number_scale)) AS value,
            e.item_id, ci.title AS item_title,
            e.participant_user_id AS participant_id, u.display_name AS participant_name
       FROM entry_values ev
       JOIN entries e ON e.id = ev.entry_id
       JOIN challenge_fields f ON f.id = ev.field_id
       LEFT JOIN challenge_items ci ON ci.id = e.item_id
       LEFT JOIN users u ON u.id = e.participant_user_id
      WHERE e.challenge_id = $1 AND ev.field_id = $2
        AND e.deleted_at IS NULL AND ev.number_scaled IS NOT NULL`,
    [metric.challenge_id, metric.field_id],
  );
  return result.rows;
}

function groupBy<T>(rows: T[], key: (row: T) => { id: string; label: string } | null) {
  const groups = new Map<string, { label: string; rows: T[] }>();
  for (const row of rows) {
    const g = key(row);
    if (!g) continue;
    const bucket = groups.get(g.id) ?? { label: g.label, rows: [] };
    bucket.rows.push(row);
    groups.set(g.id, bucket);
  }
  return groups;
}

/**
 * How many "done" entries one participant can produce for a completion-rate
 * metric, read off the completion type's orthogonal axes (not `submission_mode`):
 * item-bound → one per item; session-bound → one per checkpoint; an undated daily
 * habit → one per active day; otherwise a single expected entry.
 */
function expectedPerParticipant(ctx: {
  submission_mode: "item" | "daily" | "free";
  target_policy: string | null;
  schedule_policy: string | null;
  start_date: string | null;
  item_count: number;
  checkpoint_count: number;
  active_days: number;
}): number {
  const targetPolicy = ctx.target_policy ?? (ctx.submission_mode === "item" ? "required" : "none");
  const schedulePolicy =
    ctx.schedule_policy
    ?? (ctx.submission_mode === "item"
      ? "while_active"
      : ctx.submission_mode === "daily" && ctx.start_date !== null
        ? "checkpoint"
        : "free");
  if (targetPolicy !== "none") return ctx.item_count;
  if (schedulePolicy === "checkpoint" && ctx.start_date !== null) return ctx.checkpoint_count;
  if (ctx.submission_mode === "daily") {
    return ctx.start_date === null ? ctx.active_days : ctx.checkpoint_count;
  }
  return 1;
}

export async function calculateMetricRow(
  client: PoolClient,
  metric: MetricRow,
): Promise<Record<string, unknown>> {
  let result;
  if (metric.operation === "completion_rate") {
    const context = await oneOrNull<{
      submission_mode: "item" | "daily" | "free";
      target_policy: string | null;
      schedule_policy: string | null;
      start_date: string | null;
      end_date: string | null;
      participants: number;
      completed: number;
      item_count: number;
      checkpoint_count: number;
      active_days: number;
    }>(
      client,
      `SELECT et.submission_mode, et.target_policy, et.schedule_policy,
              c.start_date::text AS start_date, c.end_date::text AS end_date,
              (SELECT count(*)::int FROM challenge_participants cp
                WHERE cp.challenge_id = c.id AND cp.removed_at IS NULL) AS participants,
              (SELECT count(*)::int FROM entries e
                WHERE e.challenge_id = c.id AND e.entry_type_id = et.id AND e.deleted_at IS NULL) AS completed,
              (SELECT count(*)::int FROM challenge_items ci
                WHERE ci.challenge_id = c.id AND ci.archived_at IS NULL) AS item_count,
              (SELECT count(*)::int FROM challenge_checkpoints cc
                WHERE cc.challenge_id = c.id AND cc.archived_at IS NULL) AS checkpoint_count,
              CASE WHEN c.activated_at IS NULL THEN 0
                ELSE greatest(1,
                  (coalesce(c.closed_at, now()) AT TIME ZONE c.time_zone)::date
                  - (c.activated_at AT TIME ZONE c.time_zone)::date + 1
                )::int
              END AS active_days
         FROM entry_types et JOIN challenges c ON c.id = et.challenge_id
        WHERE et.id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [metric.entry_type_id, metric.challenge_id],
    );
    const expected = !context ? 0 : context.participants * expectedPerParticipant(context);
    result = calculateMetric({
      operation: "completion_rate",
      completed: context?.completed ?? 0,
      expected,
      decimalPlaces: metric.decimal_places,
    });
  } else if (metric.operation === "count") {
    const count = metric.field_id
      ? await oneOrNull<{ count: number }>(
          client,
          `SELECT count(*)::int AS count FROM entry_values ev JOIN entries e ON e.id = ev.entry_id
            WHERE e.challenge_id = $1 AND ev.field_id = $2 AND e.deleted_at IS NULL`,
          [metric.challenge_id, metric.field_id],
        )
      : await oneOrNull<{ count: number }>(
          client,
          // Scoped to the metric's own entry type — a bare count must not fold in
          // expectations, progress notes and other types' entries.
          "SELECT count(*)::int AS count FROM entries WHERE challenge_id = $1 AND entry_type_id = $2 AND deleted_at IS NULL",
          [metric.challenge_id, metric.entry_type_id],
        );
    result = { value: count?.count ?? 0, sampleSize: count?.count ?? 0 };
  } else {
    result = await computeValueMetric(client, metric);
  }
  const suffix = metric.operation === "completion_rate" && result.value !== null ? "%" : "";
  return {
    id: metric.id,
    key: metric.semantic_key,
    label: metric.label,
    operation: metric.operation,
    fieldId: metric.field_id,
    groupBy: metric.group_by,
    visibleDuring: metric.visible_during_challenge,
    visibleInResults: metric.settings?.visibleInResults !== false,
    minSample: metricSettings(metric).minSample,
    value: result.value,
    sampleSize: result.sampleSize,
    series: "series" in result ? result.series : undefined,
    formattedValue: formatValue(result.value, metric.decimal_places, suffix),
  };
}

type ValueResult = { value: number | null; sampleSize: number; series?: SeriesEntry[] };

/** Basic numeric ops + the analysis ops, with `group_by` expanded into a ranked series. */
async function computeValueMetric(client: PoolClient, metric: MetricRow): Promise<ValueResult> {
  const { minSample, bayesPriorWeight } = metricSettings(metric);
  const dp = metric.decimal_places;

  if (metric.operation === "surprise") return computeSurprise(client, metric, minSample, dp);
  if (metric.operation === "indicator_bias") return computeIndicatorBias(client, metric, minSample, dp);

  const rows = await ratingRows(client, metric);
  const all = rows.map((row) => row.value);
  const globalMean = mean(all) ?? 0;
  const overall = aggregateValues(metric.operation, all, globalMean, bayesPriorWeight, minSample, dp);

  const keyFn =
    metric.group_by === "item"
      ? (row: RatingRow) => (row.item_id ? { id: row.item_id, label: row.item_title ?? "—" } : null)
      : metric.group_by === "participant"
        ? (row: RatingRow) => ({ id: row.participant_id, label: row.participant_name ?? "—" })
        : null;
  if (!keyFn) return overall;

  const series: SeriesEntry[] = [];
  for (const [id, bucket] of groupBy(rows, keyFn)) {
    const grouped = aggregateValues(
      metric.operation,
      bucket.rows.map((row) => row.value),
      globalMean,
      bayesPriorWeight,
      minSample,
      dp,
    );
    series.push({
      key: id,
      label: bucket.label,
      value: grouped.value,
      sampleSize: grouped.sampleSize,
      formattedValue: formatValue(grouped.value, dp),
    });
  }
  series.sort((a, b) => (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY));
  return { value: overall.value, sampleSize: overall.sampleSize, series };
}

function aggregateValues(
  operation: MetricRow["operation"],
  values: number[],
  priorMean: number,
  priorWeight: number,
  minSample: number,
  decimalPlaces: number,
): { value: number | null; sampleSize: number } {
  if (operation === "bayesian_average") {
    return bayesianAverage(values, priorMean, priorWeight, { decimalPlaces, minSample });
  }
  if (operation === "spread") return spread(values, { decimalPlaces, minSample });
  const basic = calculateMetric({
    operation: operation as "sum" | "average" | "count" | "min" | "max",
    values,
    decimalPlaces,
  });
  const thin = minSample > 1 && basic.sampleSize < minSample;
  return { value: thin ? null : basic.value, sampleSize: basic.sampleSize };
}

async function computeSurprise(
  client: PoolClient,
  metric: MetricRow,
  minSample: number,
  decimalPlaces: number,
): Promise<ValueResult> {
  const rows = await client.query<{ item_id: string; item_title: string | null; rating: number; expectation: number }>(
    `SELECT re.item_id, ci.title AS item_title,
            (rv.number_scaled::float8 / (10 ^ rf.number_scale)) AS rating,
            (xv.number_scaled::float8 / (10 ^ xf.number_scale)) AS expectation
       FROM entries re
       JOIN entry_types rt ON rt.id = re.entry_type_id AND rt.purpose = 'rating'
       JOIN entry_values rv ON rv.entry_id = re.id AND rv.field_id = $2
       JOIN challenge_fields rf ON rf.id = rv.field_id
       JOIN entries xe ON xe.challenge_id = re.challenge_id AND xe.item_id = re.item_id
        AND xe.participant_user_id = re.participant_user_id AND xe.deleted_at IS NULL
       JOIN entry_types xt ON xt.id = xe.entry_type_id AND xt.purpose = 'expectation'
       JOIN entry_values xv ON xv.entry_id = xe.id
       JOIN challenge_fields xf ON xf.id = xv.field_id AND xf.kind = 'rating'
       LEFT JOIN challenge_items ci ON ci.id = re.item_id
      WHERE re.challenge_id = $1 AND re.deleted_at IS NULL AND re.item_id IS NOT NULL
        AND rv.number_scaled IS NOT NULL AND xv.number_scaled IS NOT NULL`,
    [metric.challenge_id, metric.field_id],
  );
  const overall = meanDelta(
    rows.rows.map((row) => [row.rating, row.expectation] as const),
    { decimalPlaces, minSample },
  );
  if (metric.group_by !== "item") return overall;
  const byItem = new Map<string, { label: string; pairs: Array<readonly [number, number]> }>();
  for (const row of rows.rows) {
    const bucket = byItem.get(row.item_id) ?? { label: row.item_title ?? "—", pairs: [] };
    bucket.pairs.push([row.rating, row.expectation]);
    byItem.set(row.item_id, bucket);
  }
  const series: SeriesEntry[] = [...byItem].map(([id, bucket]) => {
    const delta = meanDelta(bucket.pairs, { decimalPlaces, minSample });
    return {
      key: id,
      label: bucket.label,
      value: delta.value,
      sampleSize: delta.sampleSize,
      formattedValue: formatValue(delta.value, decimalPlaces),
    };
  });
  series.sort((a, b) => (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY));
  return { value: overall.value, sampleSize: overall.sampleSize, series };
}

async function computeIndicatorBias(
  client: PoolClient,
  metric: MetricRow,
  minSample: number,
  decimalPlaces: number,
): Promise<ValueResult> {
  const all = await ratingRows(client, metric);
  const groupMean = mean(all.map((row) => row.value)) ?? 0;
  const picks = await client.query<{ person: string; person_name: string | null; value: number }>(
    `SELECT ci.recommended_by_user_id AS person, u.display_name AS person_name,
            (ev.number_scaled::float8 / (10 ^ f.number_scale)) AS value
       FROM entry_values ev
       JOIN entries e ON e.id = ev.entry_id
       JOIN challenge_fields f ON f.id = ev.field_id
       JOIN challenge_items ci ON ci.id = e.item_id AND ci.recommended_by_user_id IS NOT NULL
       JOIN users u ON u.id = ci.recommended_by_user_id
      WHERE e.challenge_id = $1 AND ev.field_id = $2
        AND e.deleted_at IS NULL AND ev.number_scaled IS NOT NULL`,
    [metric.challenge_id, metric.field_id],
  );
  const byPerson = new Map<string, { label: string; values: number[] }>();
  for (const row of picks.rows) {
    const bucket = byPerson.get(row.person) ?? { label: row.person_name ?? "—", values: [] };
    bucket.values.push(row.value);
    byPerson.set(row.person, bucket);
  }
  const series: SeriesEntry[] = [...byPerson].map(([id, bucket]) => {
    const bias = indicatorBias(bucket.values, groupMean, { decimalPlaces, minSample });
    return {
      key: id,
      label: bucket.label,
      value: bias.value,
      sampleSize: bias.sampleSize,
      formattedValue: formatValue(bias.value, decimalPlaces),
    };
  });
  series.sort((a, b) => (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY));
  const values = series.map((entry) => entry.value).filter((value): value is number => value !== null);
  return {
    value: values.length ? mean(values.map(Math.abs)) ?? null : null,
    sampleSize: picks.rows.length,
    series: metric.group_by === "participant" ? series : undefined,
  };
}

export async function metricsForChallenge(client: PoolClient, challengeId: string) {
  const metrics = await client.query<MetricRow>(
    `SELECT id, challenge_id, entry_type_id, field_id, semantic_key, label, operation,
            group_by, decimal_places, visible_during_challenge, position, settings
       FROM challenge_metrics
      WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position, created_at`,
    [challengeId],
  );
  const calculated: Array<Record<string, unknown>> = [];
  for (const metric of metrics.rows) {
    calculated.push(await calculateMetricRow(client, metric));
  }
  return calculated;
}

export async function resultForChallenge(
  client: PoolClient,
  challengeId: string,
  calculatedMetrics?: Array<Record<string, unknown>>,
) {
  const challenge = await oneOrNull<{ results_published_at: Date | null; result_share_token: string | null }>(
    client,
    "SELECT results_published_at, result_share_token FROM challenges WHERE id = $1",
    [challengeId],
  );
  const blocks = await client.query<{
    id: string;
    kind: "metric" | "entry_value" | "text";
    metric_id: string | null;
    heading: string | null;
    body_snapshot: string | null;
    value_snapshot: unknown;
    position: number;
  }>(
    `SELECT id, kind, metric_id, heading, body_snapshot, value_snapshot, position
       FROM result_blocks WHERE challenge_id = $1 AND visible = true ORDER BY position`,
    [challengeId],
  );
  const needsMetricFallback = blocks.rows.some(
    (block) => block.kind === "metric" && block.value_snapshot === null && block.metric_id !== null,
  );
  const currentMetrics = needsMetricFallback
    ? calculatedMetrics ?? await metricsForChallenge(client, challengeId)
    : [];
  const metricById = new Map(currentMetrics.map((metric) => [metric.id, metric]));
  const textBlocks = blocks.rows.filter((block) => block.kind === "text");
  return {
    headline: textBlocks.find((block) => block.heading === "headline")?.body_snapshot ?? null,
    summary: textBlocks.find((block) => block.heading === "summary")?.body_snapshot ?? null,
    metrics: blocks.rows
      .filter((block) => block.kind === "metric")
      .map((block) => block.value_snapshot ?? (block.metric_id ? metricById.get(block.metric_id) : null))
      .filter(Boolean),
    comments: blocks.rows
      .filter((block) => block.kind === "entry_value")
      .map((block) => ({ id: block.id, text: block.body_snapshot ?? "", itemTitle: block.heading })),
    publishedAt: challenge?.results_published_at?.toISOString() ?? null,
    shareToken: challenge?.result_share_token ?? null,
  };
}

export async function addMetric(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const operations = new Set([
    "sum", "average", "count", "min", "max", "completion_rate",
    "bayesian_average", "spread", "surprise", "indicator_bias",
  ]);
  const numericFieldOps = ["sum", "average", "min", "max", "bayesian_average", "spread", "surprise", "indicator_bias"];
  const operation = typeof body.operation === "string" ? body.operation : "count";
  if (!operations.has(operation)) throw new ApiError(400, "invalid_metric", "Operação de métrica inválida.");
  const label = stringValue(body, "label", { max: 120 })!;
  const minSample = Number(body.minSample);
  const bayesPriorWeight = Number(body.bayesPriorWeight);
  if (body.groupBy === "day" || body.groupBy === "week") {
    // The compute path only expands `item`/`participant` into a series; day/week
    // would be silently ignored, so refuse it until it is actually implemented.
    throw new ApiError(400, "invalid_metric", "Agrupar por dia ou semana ainda não é suportado.");
  }
  const groupBy = typeof body.groupBy === "string" && ["none", "participant", "item"].includes(body.groupBy)
    ? body.groupBy : "none";
  const visibleDuring = body.visibleDuring !== false;
  const visibleInResults = body.visibleInResults !== false;
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem criar métricas.");
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_closed", "O desafio está encerrado.");
    let fieldId = typeof body.fieldId === "string" ? body.fieldId : null;
    let entryTypeId: string;
    if (fieldId) {
      const field = await oneOrNull<{ entry_type_id: string; kind: string }>(client,
        "SELECT entry_type_id, kind FROM challenge_fields WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL",
        [fieldId, challengeId]);
      if (!field) throw new ApiError(400, "invalid_field", "Campo não pertence ao desafio.");
      if (numericFieldOps.includes(operation) && !["number", "rating"].includes(field.kind)) {
        throw new ApiError(400, "invalid_metric", "Essa operação exige campo numérico ou nota.");
      }
      entryTypeId = field.entry_type_id;
    } else {
      if (numericFieldOps.includes(operation)) {
        throw new ApiError(400, "invalid_metric", "Selecione um campo numérico.");
      }
      const type = await primaryEntryType(client, challengeId);
      if (!type) throw new ApiError(409, "missing_entry_type", "Tipo de registro ausente.");
      entryTypeId = type.id;
      if (operation === "completion_rate") fieldId = null;
    }
    const id = publicId();
    const positionRow = await oneOrNull<{ position: number }>(client,
      "SELECT coalesce(max(position),-1)::int + 1 AS position FROM challenge_metrics WHERE challenge_id=$1", [challengeId]);
    await client.query(
      `INSERT INTO challenge_metrics
        (id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
         decimal_places,visible_during_challenge,position,settings,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,2,$9,$10,$11::jsonb,$12,now(),now())`,
      [id, challengeId, entryTypeId, fieldId, semanticKey(body.key ?? label, `metrica_${positionRow?.position ?? 0}`),
        label, operation, groupBy, visibleDuring, positionRow?.position ?? 0,
        JSON.stringify({
          visibleInResults,
          ...(Number.isFinite(minSample) && minSample > 0 ? { minSample: Math.floor(minSample) } : {}),
          ...(Number.isFinite(bayesPriorWeight) && bayesPriorWeight >= 0 ? { bayesPriorWeight } : {}),
        }),
        session.user.id],
    );
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "metric.created", "challenge_metric", id, null, { label, operation, fieldId });
    return { id };
  });
}

/**
 * Saves the showcase **draft** — the `result_blocks` the admin curates and the
 * in-app preview renders. Never publishes: `results_published_at` and the share
 * token are only touched by `publishResults` / `unpublishChallengeResults`.
 */
export async function curateResults(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const headline = stringValue(body, "headline", { max: 160, optional: true }) ?? null;
  const summary = stringValue(body, "summary", { max: 2_000, optional: true }) ?? null;
  const metricIds = Array.isArray(body.metricIds)
    ? [...new Set(body.metricIds.filter((id): id is string => typeof id === "string"))]
    : [];
  const comments = Array.isArray(body.comments) ? body.comments : [];
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem editar a vitrine.");
    if (Object.hasOwn(body, "anonymizeParticipants")) {
      await client.query("UPDATE challenges SET results_anon = $2, updated_at = now() WHERE id = $1",
        [challengeId, body.anonymizeParticipants === true]);
    }
    if (body.regenerate === true) {
      await generateShowcase(client, challengeId, session.user.id);
      await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
        "results.regenerated", "challenge", challengeId, null, null);
      return { challengeId, published: access.challenge.results_published_at !== null };
    }
    await client.query("DELETE FROM result_blocks WHERE challenge_id=$1", [challengeId]);
    let position = 0;
    for (const [heading, text] of [["headline", headline], ["summary", summary]] as const) {
      if (!text) continue;
      await client.query(
        `INSERT INTO result_blocks
          (id,challenge_id,kind,heading,body_snapshot,position,visible,created_by_user_id,created_at,updated_at)
         VALUES ($1,$2,'text',$3,$4,$5,true,$6,now(),now())`,
        [publicId(), challengeId, heading, text, position++, session.user.id],
      );
    }
    const availableMetrics = await client.query<MetricRow>(
      `SELECT id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
              decimal_places,visible_during_challenge,position,settings
         FROM challenge_metrics WHERE challenge_id=$1 AND archived_at IS NULL
          AND ($2::text[] = '{}'::text[] OR id=ANY($2::text[])) ORDER BY position`,
      [challengeId, metricIds],
    );
    for (const metric of availableMetrics.rows) {
      const snapshot = await calculateMetricRow(client, metric);
      await client.query(
        `INSERT INTO result_blocks
          (id,challenge_id,kind,metric_id,heading,value_snapshot,position,visible,created_by_user_id,created_at,updated_at)
         VALUES ($1,$2,'metric',$3,$4,$5::jsonb,$6,true,$7,now(),now())`,
        [publicId(), challengeId, metric.id, metric.label, JSON.stringify(snapshot), position++, session.user.id],
      );
    }
    for (const candidate of comments.slice(0, 20)) {
      const comment = asRecord(candidate);
      if (typeof comment.entryId !== "string" || typeof comment.fieldId !== "string") continue;
      const value = await oneOrNull<{
        body: string | null; item_title: string | null;
      }>(client,
        `SELECT ev.text_value AS body,coalesce(ci.title,cc.title) AS item_title
           FROM entry_values ev JOIN entries e ON e.id=ev.entry_id
           LEFT JOIN challenge_items ci ON ci.id=e.item_id
           LEFT JOIN challenge_checkpoints cc ON cc.challenge_id=e.challenge_id
            AND (cc.starts_at AT TIME ZONE 'America/Sao_Paulo')::date=e.occurred_on
            AND cc.archived_at IS NULL
          WHERE ev.entry_id=$1 AND ev.field_id=$2 AND e.challenge_id=$3 AND e.deleted_at IS NULL`,
        [comment.entryId, comment.fieldId, challengeId]);
      if (!value?.body) continue;
      await client.query(
        `INSERT INTO result_blocks
          (id,challenge_id,kind,source_entry_id,source_field_id,heading,body_snapshot,
           position,visible,created_by_user_id,created_at,updated_at)
         VALUES ($1,$2,'entry_value',$3,$4,$5,$6,$7,true,$8,now(),now())`,
        [publicId(), challengeId, comment.entryId, comment.fieldId, value.item_title, value.body, position++, session.user.id],
      );
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "results.draft_saved", "challenge", challengeId, null, null,
      { metricCount: availableMetrics.rows.length, commentCount: comments.length });
    return { challengeId, published: access.challenge.results_published_at !== null };
  });
}

interface SnapshotChallenge {
  id: string;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface PublishedShowcase {
  id: string;
  title: string;
  description: string | null;
  startsOn: string | null;
  endsOn: string | null;
  participants: string[];
  result: {
    headline: string | null;
    summary: string | null;
    metrics: Array<Record<string, unknown>>;
    comments: Array<{ id: string; text: string; itemTitle: string | null }>;
    publishedAt: string;
  };
}

/**
 * Freezes the current draft into the document served at `/results/<token>`. When
 * anonymized, both the participant chips and every participant-grouped metric
 * series (pages per person, indicator bias — keyed by the recommender) lose the
 * real names and ids. Item-grouped series keep film / book titles by design.
 */
async function buildPublishedSnapshot(
  client: PoolClient,
  challenge: SnapshotChallenge,
  anonymized: boolean,
) {
  const result = await resultForChallenge(client, challenge.id);
  const participants = await client.query<{ id: string; display_name: string }>(
    `SELECT u.id, u.display_name FROM challenge_participants cp JOIN users u ON u.id=cp.user_id
      WHERE cp.challenge_id=$1 AND cp.removed_at IS NULL ORDER BY u.display_name`,
    [challenge.id],
  );
  const metricList = result.metrics as Array<Record<string, unknown>>;
  let participantNames: string[];
  let metrics: Array<Record<string, unknown>> = metricList;

  if (anonymized) {
    const seriesIds = new Set<string>();
    for (const metric of metricList) {
      if (metric?.groupBy !== "participant" || !Array.isArray(metric.series)) continue;
      for (const row of metric.series as Array<{ key?: unknown }>) {
        if (typeof row.key === "string") seriesIds.add(row.key);
      }
    }
    const roster = new Map<string, string>(participants.rows.map((row) => [row.id, row.display_name]));
    const missing = [...seriesIds].filter((id) => !roster.has(id));
    if (missing.length) {
      const extra = await client.query<{ id: string; display_name: string }>(
        "SELECT id, display_name FROM users WHERE id = ANY($1::text[])", [missing]);
      for (const row of extra.rows) roster.set(row.id, row.display_name);
    }
    const labelById = new Map(
      [...roster.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
        .map(([id], index) => [id, `Participante ${index + 1}`] as const),
    );
    participantNames = participants.rows.map((row) => labelById.get(row.id) ?? "Participante ?");
    metrics = metricList.map((metric) => {
      if (metric?.groupBy !== "participant" || !Array.isArray(metric.series)) return metric;
      return {
        ...metric,
        series: (metric.series as Array<Record<string, unknown>>).map((row, index) => {
          const label = typeof row.key === "string" ? labelById.get(row.key) : undefined;
          return { ...row, key: label ?? `anon-${index}`, label: label ?? "Participante ?" };
        }),
      };
    });
  } else {
    participantNames = participants.rows.map((row) => row.display_name);
  }

  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    startsOn: challenge.start_date,
    endsOn: challenge.end_date,
    participants: participantNames,
    result: {
      headline: result.headline,
      summary: result.summary,
      metrics,
      comments: result.comments,
      publishedAt: new Date().toISOString(),
    },
  };
}

/**
 * Publishes the frozen snapshot. Mints the share token on the first publish and,
 * with `rotateLink`, replaces it (invalidating the old URL). Never changes the
 * draft blocks — the admin publishes only what they have reviewed.
 */
export async function publishResults(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem publicar a vitrine.");
    if (access.challenge.status !== "closed") {
      throw new ApiError(409, "challenge_not_closed", "A vitrine só pode ser publicada depois que o desafio é encerrado.");
    }
    const anonymized = access.challenge.results_anon === true;
    const snapshot = await buildPublishedSnapshot(client, access.challenge, anonymized);
    const existing = await oneOrNull<{ token: string | null }>(
      client, "SELECT result_share_token AS token FROM challenges WHERE id=$1", [challengeId]);
    const rotate = body.rotateLink === true || !existing?.token;
    const shareToken = rotate ? generateOpaqueToken() : existing?.token ?? generateOpaqueToken();
    const shareHash = await hashToken(shareToken);
    await client.query(
      `UPDATE challenges
          SET results_published_snapshot=$2::jsonb, results_published_at=now(),
              result_share_token=$3, result_share_token_hash=$4, updated_at=now()
        WHERE id=$1`,
      [challengeId, JSON.stringify(snapshot), shareToken, shareHash],
    );
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "results.published", "challenge", challengeId, null, null, { rotated: rotate, anonymized });
    return { challengeId, publishedAt: new Date().toISOString(), anonymized, shareToken };
  });
}

/** Clears publication + token + frozen snapshot. Shared by the route and reopen. */
export async function unpublishResults(client: PoolClient, challengeId: string): Promise<void> {
  await client.query(
    `UPDATE challenges
        SET results_published_at=NULL, result_share_token=NULL,
            result_share_token_hash=NULL, results_published_snapshot=NULL, updated_at=now()
      WHERE id=$1`,
    [challengeId],
  );
}

export async function unpublishChallengeResults(session: SessionContext, challengeId: string) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem despublicar a vitrine.");
    const had = access.challenge.results_published_at !== null;
    await unpublishResults(client, challengeId);
    if (had) {
      await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
        "results.unpublished", "challenge", challengeId, null, null, {});
    }
    return { challengeId, published: false };
  });
}

export async function publicResults(token: string) {
  let hash: string;
  try { hash = await hashToken(token); } catch { throw new ApiError(404, "not_found", "Resultados não encontrados."); }
  return withClient(async (client) => {
    const row = await oneOrNull<{ snapshot: unknown }>(
      client,
      `SELECT results_published_snapshot AS snapshot FROM challenges
        WHERE result_share_token_hash=$1 AND results_published_at IS NOT NULL
          AND status='closed' AND deleted_at IS NULL`,
      [hash],
    );
    if (!row || !row.snapshot) throw new ApiError(404, "not_found", "Resultados não encontrados.");
    return { challenge: row.snapshot as PublishedShowcase };
  });
}
