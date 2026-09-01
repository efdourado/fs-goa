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
import { calculateMetric } from "../../metrics";
import { generateOpaqueToken, hashToken } from "../../security";
import { primaryEntryType } from "./entry-types";
import type { MetricRow } from "./types";

export async function calculateMetricRow(
  client: PoolClient,
  metric: MetricRow,
): Promise<Record<string, unknown>> {
  let result;
  if (metric.operation === "completion_rate") {
    const context = await oneOrNull<{
      submission_mode: "item" | "daily" | "free";
      start_date: string | null;
      end_date: string | null;
      participants: number;
      completed: number;
      item_count: number;
      checkpoint_count: number;
      active_days: number;
    }>(
      client,
      `SELECT et.submission_mode, c.start_date::text AS start_date, c.end_date::text AS end_date,
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
    const expected = !context
      ? 0
      : context.participants *
        (context.submission_mode === "item"
          ? context.item_count
          : context.submission_mode === "daily"
            ? context.start_date === null
              ? context.active_days
              : context.checkpoint_count
            : 1);
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
          "SELECT count(*)::int AS count FROM entries WHERE challenge_id = $1 AND deleted_at IS NULL",
          [metric.challenge_id],
        );
    result = { value: count?.count ?? 0, sampleSize: count?.count ?? 0 };
  } else {
    const values = await client.query<{ number_scaled: number; number_scale: number }>(
      `SELECT ev.number_scaled, f.number_scale
         FROM entry_values ev
         JOIN entries e ON e.id = ev.entry_id
         JOIN challenge_fields f ON f.id = ev.field_id
        WHERE e.challenge_id = $1 AND ev.field_id = $2
          AND e.deleted_at IS NULL AND ev.number_scaled IS NOT NULL`,
      [metric.challenge_id, metric.field_id],
    );
    result = calculateMetric({
      operation: metric.operation,
      values: values.rows.map((value) => value.number_scaled / 10 ** value.number_scale),
      decimalPlaces: metric.decimal_places,
    });
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
    value: result.value,
    sampleSize: result.sampleSize,
    formattedValue: result.value === null ? "—" : `${result.value.toLocaleString("pt-BR")}${suffix}`,
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
  const challenge = await oneOrNull<{ results_published_at: Date | null }>(
    client,
    "SELECT results_published_at FROM challenges WHERE id = $1",
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
  };
}

export async function addMetric(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const operations = new Set(["sum", "average", "count", "min", "max", "completion_rate"]);
  const operation = typeof body.operation === "string" ? body.operation : "count";
  if (!operations.has(operation)) throw new ApiError(400, "invalid_metric", "Operação de métrica inválida.");
  const label = stringValue(body, "label", { max: 120 })!;
  const groupBy = typeof body.groupBy === "string" && ["none", "participant", "item", "day", "week"].includes(body.groupBy)
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
      if (["sum", "average", "min", "max"].includes(operation) && !["number", "rating"].includes(field.kind)) {
        throw new ApiError(400, "invalid_metric", "Essa operação exige campo numérico ou nota.");
      }
      entryTypeId = field.entry_type_id;
    } else {
      if (["sum", "average", "min", "max"].includes(operation)) {
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
        JSON.stringify({ visibleInResults }), session.user.id],
    );
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "metric.created", "challenge_metric", id, null, { label, operation, fieldId });
    return { id };
  });
}

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
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem publicar resultados.");
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
              decimal_places,visible_during_challenge,position
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
    let shareToken: string | null = null;
    if (access.challenge.status === "closed") {
      shareToken = generateOpaqueToken();
      const shareHash = await hashToken(shareToken);
      await client.query(
        `UPDATE challenges SET results_published_at=now(),result_share_token_hash=$2,updated_at=now()
          WHERE id=$1`, [challengeId, shareHash]);
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "results.published", "challenge", challengeId, null,
      { metricCount: availableMetrics.rows.length, commentCount: comments.length });
    return { challengeId, shareToken, published: access.challenge.status === "closed" };
  });
}

export async function publicResults(token: string) {
  let hash: string;
  try { hash = await hashToken(token); } catch { throw new ApiError(404, "not_found", "Resultados não encontrados."); }
  return withClient(async (client) => {
    const challenge = await oneOrNull<{
      id: string; title: string; description: string | null;
      start_date: string | null; end_date: string | null;
    }>(client,
      `SELECT id,title,description,start_date::text AS start_date,end_date::text AS end_date FROM challenges
        WHERE result_share_token_hash=$1 AND results_published_at IS NOT NULL AND status='closed'
          AND deleted_at IS NULL`, [hash]);
    if (!challenge) throw new ApiError(404, "not_found", "Resultados não encontrados.");
    const participants = await client.query<{ display_name: string }>(
      `SELECT u.display_name FROM challenge_participants cp JOIN users u ON u.id=cp.user_id
        WHERE cp.challenge_id=$1 AND cp.removed_at IS NULL ORDER BY u.display_name`, [challenge.id]);
    return {
      challenge: {
        id: challenge.id, title: challenge.title, description: challenge.description,
        startsOn: challenge.start_date, endsOn: challenge.end_date,
        participants: participants.rows.map((participant) => participant.display_name),
        result: await resultForChallenge(client, challenge.id),
      },
    };
  });
}
