import type { PoolClient } from "pg";
import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull, withClient } from "../../db";
// Direct module imports, not the `goa-domain` barrel — `leaveGroup` (in
// `domain/groups`) calls into this file, and the barrel re-exports it, so going
// through the barrel here would form an import cycle.
import { challengeAccess } from "../domain/access";
import { writeAudit } from "../domain/audit";
import { asRecord, publicId, semanticKey } from "../domain/shared";
import { ApiError, stringValue } from "../../http";
import { bayesianAverage, consensus, indicatorBias, mean, meanDelta, median, spread } from "../analysis";
import { calculateMetric } from "../../metrics";
import { generateOpaqueToken, hashToken } from "../../security";
import { primaryEntryType } from "./entry-types";
import { computeRankings } from "./rankings";
import { generateShowcase } from "./showcase";
import type { MetricRow } from "./types";

interface SeriesEntry {
  key: string;
  label: string;
  value: number | null;
  sampleSize: number;
  formattedValue: string;
  /** Item-grouped rows only: who recommended it, the catalogue year, and the
   *  plain (un-adjusted) average — shown next to the shrunk `bayesian_average`
   *  so the group can see the raw math behind the adjusted number. */
  recommendedBy?: string | null;
  year?: number | null;
  rawValue?: number | null;
  rawFormattedValue?: string;
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
  catalog_year: number | null;
  catalog_author: string | null;
  catalog_genre: string | null;
  recommended_by_name: string | null;
  checkpoint_id: string | null;
  checkpoint_title: string | null;
  checkpoint_position: number | null;
}


/**
 * Numeric field values for a metric, tagged with their item, participant, and
 * — when the round tracks a catalog — the release year / author / main genre
 * of the film or book that item points at. That's what lets a metric group by
 * "best movies of 2026" or "best authors" instead of only participant/item.
 */
async function ratingRows(client: PoolClient, metric: MetricRow): Promise<RatingRow[]> {
  const result = await client.query<RatingRow>(
    // A participant who has since left the challenge (or the group, or whose
    // account is gone) keeps contributing to the numbers but not the name — the
    // per-person breakdown labels them generically instead. Same rule for
    // whoever recommended the item.
    `SELECT (ev.number_scaled::float8 / (10 ^ f.number_scale)) AS value,
            e.item_id, ci.title AS item_title,
            e.participant_user_id AS participant_id,
            CASE WHEN cp.user_id IS NOT NULL THEN u.display_name ELSE 'Quem já saiu' END AS participant_name,
            cat.year AS catalog_year, cat.author AS catalog_author, cat.main_genre AS catalog_genre,
            CASE WHEN ci.recommended_by_user_id IS NULL THEN NULL
                 WHEN active_recommender.user_id IS NOT NULL THEN recommender.display_name
                 ELSE 'Quem já saiu' END AS recommended_by_name,
            cc.id AS checkpoint_id, cc.title AS checkpoint_title, cc.position AS checkpoint_position
       FROM entry_values ev
       JOIN entries e ON e.id = ev.entry_id
       JOIN challenge_fields f ON f.id = ev.field_id
       JOIN challenges c ON c.id = e.challenge_id
       LEFT JOIN challenge_items ci ON ci.id = e.item_id
       LEFT JOIN catalog_items cat ON cat.id = ci.catalog_item_id
       -- The checkpoint is the entry's own (session-bound types) or, for a plain
       -- item rating, whichever checkpoint the item was organised under.
       LEFT JOIN challenge_checkpoints cc
         ON cc.id = coalesce(e.checkpoint_id, ci.checkpoint_id) AND cc.archived_at IS NULL
       LEFT JOIN users u ON u.id = e.participant_user_id
       LEFT JOIN challenge_participants cp
         ON cp.challenge_id = e.challenge_id AND cp.user_id = e.participant_user_id AND cp.removed_at IS NULL
       LEFT JOIN users recommender ON recommender.id = ci.recommended_by_user_id
       LEFT JOIN group_members active_recommender
         ON active_recommender.group_id = c.group_id
        AND active_recommender.user_id = ci.recommended_by_user_id
        AND active_recommender.removed_at IS NULL
      WHERE e.challenge_id = $1 AND ev.field_id = $2
        AND e.deleted_at IS NULL AND ev.number_scaled IS NOT NULL`,
    [metric.challenge_id, metric.field_id],
  );
  return result.rows;
}

/** Scale span of the metric's numeric field (e.g. 5 for a 0–5 rating). */
async function fieldRange(client: PoolClient, fieldId: string | null): Promise<number | null> {
  if (!fieldId) return null;
  const row = await oneOrNull<{ min_scaled: number | null; max_scaled: number | null; number_scale: number | null }>(
    client,
    "SELECT min_scaled, max_scaled, number_scale FROM challenge_fields WHERE id = $1",
    [fieldId],
  );
  if (!row || row.min_scaled === null || row.max_scaled === null) return null;
  const factor = 10 ** (row.number_scale ?? 0);
  const span = (row.max_scaled - row.min_scaled) / factor;
  return span > 0 ? span : null;
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

/**
 * Plain-language formula + how the sample was counted for one calculated metric
 * (V1 §9 "apresentar amostra e explicação"; §11 "Toda métrica mostra amostra e
 * explicação"). `expected` / `expectedNote` are only set for completion rate.
 */
function explainMetric(
  metric: MetricRow,
  result: { value: number | null; sampleSize: number },
  extra: { expected?: number; expectedNote?: string } = {},
): { formula: string; sample: string } {
  const { minSample, bayesPriorWeight } = metricSettings(metric);
  const n = result.sampleSize;
  switch (metric.operation) {
    case "count":
      return { formula: "Número de registros válidos.", sample: `${n} registro(s).` };
    case "sum":
      return { formula: "Soma dos valores do campo.", sample: `${n} valor(es).` };
    case "average":
      return { formula: "média = soma dos valores ÷ n.", sample: `n = ${n} avaliação(ões).` };
    case "median":
      return { formula: "Valor central da sequência ordenada (em contagem par, a média dos dois centrais).", sample: `n = ${n}.` };
    case "min":
      return { formula: "Menor valor registrado.", sample: `n = ${n}.` };
    case "max":
      return { formula: "Maior valor registrado.", sample: `n = ${n}.` };
    case "completion_rate":
      return {
        formula: "conclusão = registros concluídos ÷ total esperado × 100.",
        sample: `${n} de ${extra.expected ?? 0} esperados${extra.expectedNote ? ` (${extra.expectedNote})` : ""}.`,
      };
    case "bayesian_average":
      return {
        formula: `nota ajustada = (n × média do item + m × média global) ÷ (n + m); m = ${bayesPriorWeight}.`,
        sample: `elegível a partir de ${minSample} avaliação(ões) por item.`,
      };
    case "spread":
      return { formula: "Desvio-padrão populacional das avaliações — quanto maior, mais o grupo divergiu.", sample: `mínimo ${Math.max(2, minSample)} avaliações.` };
    case "consensus":
      return { formula: "consenso = max(0, 1 − desvio ÷ (amplitude ÷ 2)) × 100.", sample: `mínimo ${Math.max(2, minSample)} avaliações; 100 = unanimidade.` };
    case "surprise":
      return { formula: "surpresa = avaliação − expectativa, em respostas pareadas da mesma pessoa e item.", sample: `${n} par(es) avaliação/expectativa.` };
    case "indicator_bias":
      return { formula: "desempenho = média dos itens indicados pela pessoa − média global.", sample: `${n} indicação(ões) avaliada(s).` };
    default:
      return { formula: "", sample: `n = ${n}.` };
  }
}

export async function calculateMetricRow(
  client: PoolClient,
  metric: MetricRow,
): Promise<Record<string, unknown>> {
  let result;
  let explainExtra: { expected?: number; expectedNote?: string } = {};
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
    if (context) {
      const per = expectedPerParticipant(context);
      const unit = context.target_policy !== "none"
        ? `${context.item_count} itens`
        : context.schedule_policy === "checkpoint" && context.start_date
          ? `${context.checkpoint_count} checkpoints`
          : context.submission_mode === "daily"
            ? `${context.active_days} dias ativos`
            : "1 registro";
      explainExtra = {
        expected,
        expectedNote: `${context.participants} participante(s) × ${per} = ${unit} por pessoa`,
      };
    }
  } else if (metric.operation === "count") {
    result = await computeCountMetric(client, metric);
  } else {
    result = await computeValueMetric(client, metric);
  }
  const suffix = metric.operation === "completion_rate" && result.value !== null ? "%" : "";
  const explanation = explainMetric(metric, result, explainExtra);
  return {
    id: metric.id,
    key: metric.semantic_key,
    label: metric.label,
    operation: metric.operation,
    fieldId: metric.field_id,
    groupBy: metric.group_by,
    cumulative: (metric.settings as { cumulative?: unknown })?.cumulative === true,
    visibleDuring: metric.visible_during_challenge,
    visibleInResults: metric.settings?.visibleInResults !== false,
    minSample: metricSettings(metric).minSample,
    value: result.value,
    sampleSize: result.sampleSize,
    series: "series" in result ? result.series : undefined,
    formattedValue: formatValue(result.value, metric.decimal_places, suffix),
    explanation: explanation.formula,
    sample: explanation.sample,
  };
}

type ValueResult = { value: number | null; sampleSize: number; series?: SeriesEntry[] };

/**
 * Number of valid entries, optionally fanned out by participant ("registros por
 * pessoa"), item, or checkpoint ("participação da semana"). A `field_id` narrows
 * the count to entries that actually filled that field.
 */
async function computeCountMetric(client: PoolClient, metric: MetricRow): Promise<ValueResult> {
  const fromWhere = metric.field_id
    ? `FROM entry_values ev JOIN entries e ON e.id = ev.entry_id
        LEFT JOIN challenge_items ci ON ci.id = e.item_id
       WHERE e.challenge_id = $1 AND ev.field_id = $2 AND e.deleted_at IS NULL`
    : `FROM entries e LEFT JOIN challenge_items ci ON ci.id = e.item_id
       WHERE e.challenge_id = $1 AND e.entry_type_id = $2 AND e.deleted_at IS NULL`;
  const params = [metric.challenge_id, metric.field_id ?? metric.entry_type_id];

  if (metric.group_by === "none") {
    const total = await oneOrNull<{ n: number }>(client, `SELECT count(*)::int AS n ${fromWhere}`, params);
    return { value: total?.n ?? 0, sampleSize: total?.n ?? 0 };
  }

  const keyExpr =
    metric.group_by === "participant" ? "e.participant_user_id"
      : metric.group_by === "item" ? "e.item_id"
        : "coalesce(e.checkpoint_id, ci.checkpoint_id)";
  const rows = await client.query<{ key: string | null; label: string | null; position: number; n: number }>(
    `SELECT k.key,
            CASE $3
              WHEN 'participant' THEN u.display_name
              WHEN 'item' THEN it.title
              ELSE cc.title END AS label,
            coalesce(cc.position, 0)::int AS position,
            k.n
       FROM (SELECT ${keyExpr} AS key, count(*)::int AS n ${fromWhere} GROUP BY 1) k
       LEFT JOIN users u ON u.id = k.key
       LEFT JOIN challenge_items it ON it.id = k.key
       LEFT JOIN challenge_checkpoints cc ON cc.id = k.key
      WHERE k.key IS NOT NULL
      ORDER BY position, n DESC`,
    [...params, metric.group_by],
  );
  const series: SeriesEntry[] = rows.rows.map((row) => ({
    key: row.key ?? "—",
    label: row.label ?? "—",
    value: row.n,
    sampleSize: row.n,
    formattedValue: formatValue(row.n, 0),
  }));
  const total = series.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  return { value: total, sampleSize: total, series };
}

interface AggregateContext {
  priorMean: number;
  priorWeight: number;
  minSample: number;
  decimalPlaces: number;
  range: number | null;
}

/** Basic numeric ops + the analysis ops, with `group_by` expanded into a ranked series. */
async function computeValueMetric(client: PoolClient, metric: MetricRow): Promise<ValueResult> {
  const { minSample, bayesPriorWeight } = metricSettings(metric);
  const dp = metric.decimal_places;

  if (metric.operation === "surprise") return computeSurprise(client, metric, minSample, dp);
  if (metric.operation === "indicator_bias") return computeIndicatorBias(client, metric, minSample, dp);

  const rows = await ratingRows(client, metric);
  const all = rows.map((row) => row.value);
  const globalMean = mean(all) ?? 0;
  const ctx: AggregateContext = {
    priorMean: globalMean,
    priorWeight: bayesPriorWeight,
    minSample,
    decimalPlaces: dp,
    range: metric.operation === "consensus" ? await fieldRange(client, metric.field_id) : null,
  };
  const overall = aggregateValues(metric.operation, all, ctx);

  const cumulative = (metric.settings as { cumulative?: unknown })?.cumulative === true;

  if (metric.group_by === "checkpoint") {
    const checkpoints = await client.query<{ id: string; title: string; position: number }>(
      "SELECT id, title, position FROM challenge_checkpoints WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position",
      [metric.challenge_id],
    );
    return checkpointSeries(rows, metric.operation, ctx, cumulative, checkpoints.rows);
  }

  const keyFn =
    metric.group_by === "item"
      ? (row: RatingRow) => (row.item_id ? { id: row.item_id, label: row.item_title ?? "—" } : null)
      : metric.group_by === "participant"
        ? (row: RatingRow) => ({ id: row.participant_id, label: row.participant_name ?? "—" })
        : metric.group_by === "catalog_year"
          ? (row: RatingRow) => (row.catalog_year ? { id: String(row.catalog_year), label: String(row.catalog_year) } : null)
          : metric.group_by === "catalog_author"
            ? (row: RatingRow) => (row.catalog_author ? { id: row.catalog_author, label: row.catalog_author } : null)
            : metric.group_by === "catalog_genre"
              ? (row: RatingRow) => (row.catalog_genre ? { id: row.catalog_genre, label: row.catalog_genre } : null)
              : null;
  if (!keyFn) return overall;

  const series: SeriesEntry[] = [];
  for (const [id, bucket] of groupBy(rows, keyFn)) {
    const values = bucket.rows.map((row) => row.value);
    const grouped = aggregateValues(metric.operation, values, ctx);
    // Every row in an item bucket shares the same item, so its recommender and
    // year are constant within the bucket — read them off the first row.
    const first = metric.group_by === "item" ? bucket.rows[0] : undefined;
    const raw = metric.operation === "bayesian_average"
      ? aggregateValues("average", values, ctx)
      : null;
    series.push({
      key: id,
      label: bucket.label,
      value: grouped.value,
      sampleSize: grouped.sampleSize,
      formattedValue: formatValue(grouped.value, dp),
      ...(first ? { recommendedBy: first.recommended_by_name, year: first.catalog_year } : {}),
      ...(raw ? { rawValue: raw.value, rawFormattedValue: formatValue(raw.value, dp) } : {}),
    });
  }
  series.sort((a, b) => (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY) || a.label.localeCompare(b.label, "pt-BR"));
  return { value: overall.value, sampleSize: overall.sampleSize, series };
}

/**
 * A metric grouped by checkpoint — one row per week/session in schedule order.
 * `cumulative` folds in every earlier checkpoint's rows too ("média acumulada",
 * "participação até a semana"); otherwise each row is that checkpoint alone.
 */
function checkpointSeries(
  rows: RatingRow[],
  operation: MetricRow["operation"],
  ctx: AggregateContext,
  cumulative: boolean,
  allCheckpoints: Array<{ id: string; title: string; position: number }> = [],
): ValueResult {
  const buckets = new Map<string, { label: string; position: number; values: number[] }>();
  // Seed every checkpoint so an empty week / session still shows as a row
  // (value null, n = 0) instead of vanishing from the trend.
  for (const cp of allCheckpoints) {
    buckets.set(cp.id, { label: cp.title, position: cp.position, values: [] });
  }
  for (const row of rows) {
    if (!row.checkpoint_id) continue;
    const bucket = buckets.get(row.checkpoint_id)
      ?? { label: row.checkpoint_title ?? "—", position: row.checkpoint_position ?? 0, values: [] };
    bucket.values.push(row.value);
    buckets.set(row.checkpoint_id, bucket);
  }
  const ordered = [...buckets.entries()].sort((a, b) => a[1].position - b[1].position);
  const series: SeriesEntry[] = [];
  const running: number[] = [];
  for (const [id, bucket] of ordered) {
    running.push(...bucket.values);
    const values = cumulative ? [...running] : bucket.values;
    const result = aggregateValues(operation, values, ctx);
    series.push({
      key: id,
      label: bucket.label,
      value: result.value,
      sampleSize: result.sampleSize,
      formattedValue: formatValue(result.value, ctx.decimalPlaces),
    });
  }
  // Checkpoint series read in schedule order, not ranked — the trend is the point.
  const last = series[series.length - 1];
  return { value: last?.value ?? null, sampleSize: rows.length, series };
}

function aggregateValues(
  operation: MetricRow["operation"],
  values: number[],
  ctx: AggregateContext,
): { value: number | null; sampleSize: number } {
  const { priorMean, priorWeight, minSample, decimalPlaces, range } = ctx;
  if (operation === "bayesian_average") {
    return bayesianAverage(values, priorMean, priorWeight, { decimalPlaces, minSample });
  }
  if (operation === "spread") return spread(values, { decimalPlaces, minSample });
  if (operation === "median") return median(values, { decimalPlaces, minSample });
  if (operation === "consensus") {
    if (range === null) return { value: null, sampleSize: values.length };
    return consensus(values, range, { decimalPlaces, minSample });
  }
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
  series.sort((a, b) => (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY) || a.label.localeCompare(b.label, "pt-BR"));
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
    // Same anonymity rule as everywhere else: a recommender no longer in the
    // group keeps their bias score, loses their name.
    `SELECT ci.recommended_by_user_id AS person,
            CASE WHEN active_recommender.user_id IS NOT NULL THEN u.display_name ELSE 'Quem já saiu' END AS person_name,
            (ev.number_scaled::float8 / (10 ^ f.number_scale)) AS value
       FROM entry_values ev
       JOIN entries e ON e.id = ev.entry_id
       JOIN challenge_fields f ON f.id = ev.field_id
       JOIN challenge_items ci ON ci.id = e.item_id AND ci.recommended_by_user_id IS NOT NULL
       JOIN users u ON u.id = ci.recommended_by_user_id
       JOIN challenges c ON c.id = e.challenge_id
       LEFT JOIN group_members active_recommender
         ON active_recommender.group_id = c.group_id
        AND active_recommender.user_id = ci.recommended_by_user_id
        AND active_recommender.removed_at IS NULL
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
  series.sort((a, b) => (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY) || a.label.localeCompare(b.label, "pt-BR"));
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
  // Personal rankings + affinity are O(participants²) to compute. `getChallengeDetail`
  // (a very hot path) skips them — during an active round the Wrapped shows them
  // only once frozen. `generateShowcase` / `curateResults` freeze them on close.
  options: { liveRankings?: boolean } = {},
) {
  const challenge = await oneOrNull<{ results_published_at: Date | null; result_share_token_hash: string | null; status: string }>(
    client,
    "SELECT results_published_at, result_share_token_hash, status FROM challenges WHERE id = $1",
    [challengeId],
  );
  // Frozen blocks only stand once the round is closed (`generateShowcase` fills
  // them then). While it is still open the internal result is always live — a
  // draft curated too early must never override the running numbers.
  const useFrozenBlocks = challenge?.status === "closed";
  const blocksResult = useFrozenBlocks
    ? await client.query<{
        id: string;
        kind: "metric" | "entry_value" | "text" | "ranking" | "affinity";
        metric_id: string | null;
        heading: string | null;
        body_snapshot: string | null;
        value_snapshot: unknown;
        position: number;
        visible: boolean;
      }>(
        `SELECT id, kind, metric_id, heading, body_snapshot, value_snapshot, position, visible
           FROM result_blocks WHERE challenge_id = $1 ORDER BY position`,
        [challengeId],
      )
    : { rows: [] as Array<{
        id: string; kind: "metric" | "entry_value" | "text" | "ranking" | "affinity";
        metric_id: string | null; heading: string | null; body_snapshot: string | null;
        value_snapshot: unknown; position: number; visible: boolean;
      }> };
  const blocks = { rows: blocksResult.rows.filter((block) => block.visible) };
  const needsMetricFallback = blocks.rows.some(
    (block) => block.kind === "metric" && block.value_snapshot === null && block.metric_id !== null,
  );
  const currentMetrics = needsMetricFallback
    ? calculatedMetrics ?? await metricsForChallenge(client, challengeId)
    : [];
  const metricById = new Map(currentMetrics.map((metric) => [metric.id, metric]));
  const textBlocks = blocks.rows.filter((block) => block.kind === "text");

  const totalEntries = (await oneOrNull<{ count: number }>(
    client,
    "SELECT count(*)::int AS count FROM entries WHERE challenge_id = $1 AND deleted_at IS NULL",
    [challengeId],
  ))?.count ?? 0;

  const rankingBlock = blocksResult.rows.find((block) => block.kind === "ranking");
  const affinityBlock = blocksResult.rows.find((block) => block.kind === "affinity");
  // Frozen when present; computed live only when the caller asks (never for an
  // empty challenge).
  const live = options.liveRankings && !rankingBlock && !affinityBlock && totalEntries > 0
    ? await computeRankings(client, challengeId)
    : { personal: [], affinity: null };
  const personalRankings = rankingBlock
    ? (rankingBlock.visible ? (rankingBlock.value_snapshot as { personal: unknown }).personal ?? [] : [])
    : live.personal;
  const affinity = affinityBlock
    ? (affinityBlock.visible ? affinityBlock.value_snapshot : null)
    : live.affinity;

  // The ordered, admin-arranged Wrapped — every stored block with its position
  // and visibility, resolved to its payload. Empty while the round is open and
  // no draft has been saved; the renderer then composes a default order.
  const orderedBlocks = blocksResult.rows.map((block) => ({
    id: block.id,
    kind: block.kind,
    position: block.position,
    visible: block.visible,
    heading: block.heading,
    ...(block.kind === "text" ? { text: block.body_snapshot } : {}),
    ...(block.kind === "metric"
      ? { metric: block.value_snapshot ?? (block.metric_id ? metricById.get(block.metric_id) : null) }
      : {}),
    ...(block.kind === "entry_value" ? { comment: { id: block.id, text: block.body_snapshot ?? "", itemTitle: block.heading } } : {}),
    ...(block.kind === "ranking" ? { ranking: (block.value_snapshot as { personal?: unknown })?.personal ?? [] } : {}),
    ...(block.kind === "affinity" ? { affinity: block.value_snapshot } : {}),
  }));

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
    personalRankings,
    affinity,
    blocks: orderedBlocks,
    totalEntries,
    publishedAt: challenge?.results_published_at?.toISOString() ?? null,
    // The raw link is never persisted; the admin sees it once, at publish time.
    hasPublishedLink: challenge?.result_share_token_hash != null,
  };
}

const METRIC_OPERATIONS = new Set([
  "sum", "average", "count", "min", "max", "median", "completion_rate",
  "bayesian_average", "spread", "consensus", "surprise", "indicator_bias",
]);
const NUMERIC_FIELD_OPS = new Set([
  "sum", "average", "min", "max", "median",
  "bayesian_average", "spread", "consensus", "surprise", "indicator_bias",
]);
// `day`/`week` stay refused: the compute path only expands item/participant/
// checkpoint/catalog_* into a series, so they would be silently ignored today.
const GROUP_BY_VALUES = new Set([
  "none", "participant", "item", "checkpoint", "catalog_year", "catalog_author", "catalog_genre",
]);
// Which groupings each analysis op accepts — the rest are refused as incoherent
// combinations (V1 §9 "recusa combinações inválidas").
const GROUP_BY_BY_OP: Record<string, Set<string>> = {
  spread: new Set(["none", "item", "checkpoint", "catalog_year", "catalog_author", "catalog_genre"]),
  consensus: new Set(["none", "item", "checkpoint", "catalog_year", "catalog_author", "catalog_genre"]),
  surprise: new Set(["none", "item"]),
  indicator_bias: new Set(["none", "participant"]),
  // Count fans out into a real series; completion rate only computes its total.
  count: new Set(["none", "item", "participant", "checkpoint"]),
  completion_rate: new Set(["none"]),
};

interface ParsedMetricInput {
  operation: string;
  label: string;
  groupBy: string;
  visibleDuring: boolean;
  visibleInResults: boolean;
  minSample: number;
  bayesPriorWeight: number;
  cumulative: boolean;
}

function parseMetricInput(body: Record<string, unknown>): ParsedMetricInput {
  const operation = typeof body.operation === "string" ? body.operation : "count";
  if (!METRIC_OPERATIONS.has(operation)) throw new ApiError(400, "invalid_metric", "Operação de métrica inválida.");
  const label = stringValue(body, "label", { max: 120 })!;
  if (body.groupBy === "day" || body.groupBy === "week") {
    throw new ApiError(400, "invalid_metric", "Agrupar por dia ou semana ainda não é suportado.");
  }
  const groupBy = typeof body.groupBy === "string" && GROUP_BY_VALUES.has(body.groupBy) ? body.groupBy : "none";
  const allowed = GROUP_BY_BY_OP[operation];
  if (allowed && !allowed.has(groupBy)) {
    throw new ApiError(400, "invalid_metric_grouping", "Essa operação não combina com esse agrupamento.");
  }
  const cumulative = body.cumulative === true;
  if (cumulative && groupBy !== "checkpoint") {
    throw new ApiError(400, "invalid_metric", "O modo acumulado só existe agrupando por checkpoint.");
  }
  return {
    operation,
    label,
    groupBy,
    visibleDuring: body.visibleDuring !== false,
    visibleInResults: body.visibleInResults !== false,
    minSample: Number(body.minSample),
    bayesPriorWeight: Number(body.bayesPriorWeight),
    cumulative,
  };
}

/**
 * Relational coherence a bare `parseMetricInput` can't see: a checkpoint
 * grouping needs checkpoints, a catalogue grouping needs a catalogue, surprise
 * needs an expectation type to pair against.
 */
async function assertMetricCoherent(
  client: PoolClient,
  challengeId: string,
  parsed: ParsedMetricInput,
): Promise<void> {
  if (parsed.groupBy === "checkpoint") {
    const has = await oneOrNull<{ count: number }>(client,
      "SELECT count(*)::int AS count FROM challenge_checkpoints WHERE challenge_id=$1 AND archived_at IS NULL",
      [challengeId]);
    if (!has || has.count === 0) {
      throw new ApiError(409, "metric_needs_checkpoints", "Agrupar por checkpoint exige checkpoints no desafio.");
    }
  }
  if (parsed.groupBy.startsWith("catalog_")) {
    const has = await oneOrNull<{ count: number }>(client,
      "SELECT count(*)::int AS count FROM challenge_items ci WHERE ci.challenge_id=$1 AND ci.archived_at IS NULL AND ci.catalog_item_id IS NOT NULL",
      [challengeId]);
    if (!has || has.count === 0) {
      throw new ApiError(409, "metric_needs_catalog", "Esse agrupamento só existe num desafio com acervo.");
    }
  }
  if (parsed.operation === "surprise") {
    const has = await oneOrNull<{ count: number }>(client,
      "SELECT count(*)::int AS count FROM entry_types WHERE challenge_id=$1 AND purpose='expectation' AND archived_at IS NULL",
      [challengeId]);
    if (!has || has.count === 0) {
      throw new ApiError(409, "metric_needs_expectation", "Surpresa precisa de um tipo de expectativa para comparar.");
    }
  }
}

/** Resolves + validates the field/entry-type pair a metric computes over. Shared by create and edit. */
async function resolveMetricField(
  client: PoolClient,
  challengeId: string,
  operation: string,
  fieldId: string | null,
): Promise<{ entryTypeId: string; fieldId: string | null }> {
  if (fieldId) {
    const field = await oneOrNull<{ entry_type_id: string; kind: string }>(client,
      "SELECT entry_type_id, kind FROM challenge_fields WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL",
      [fieldId, challengeId]);
    if (!field) throw new ApiError(400, "invalid_field", "Campo não pertence ao desafio.");
    if (NUMERIC_FIELD_OPS.has(operation) && !["number", "rating"].includes(field.kind)) {
      throw new ApiError(400, "invalid_metric", "Essa operação exige campo numérico ou nota.");
    }
    return { entryTypeId: field.entry_type_id, fieldId };
  }
  if (NUMERIC_FIELD_OPS.has(operation)) {
    throw new ApiError(400, "invalid_metric", "Selecione um campo numérico.");
  }
  const type = await primaryEntryType(client, challengeId);
  if (!type) throw new ApiError(409, "missing_entry_type", "Tipo de registro ausente.");
  return { entryTypeId: type.id, fieldId: operation === "completion_rate" ? null : fieldId };
}

function metricSettingsJson(parsed: ParsedMetricInput): string {
  return JSON.stringify({
    visibleInResults: parsed.visibleInResults,
    ...(Number.isFinite(parsed.minSample) && parsed.minSample > 0 ? { minSample: Math.floor(parsed.minSample) } : {}),
    ...(Number.isFinite(parsed.bayesPriorWeight) && parsed.bayesPriorWeight >= 0 ? { bayesPriorWeight: parsed.bayesPriorWeight } : {}),
    ...(parsed.cumulative ? { cumulative: true } : {}),
  });
}

export async function addMetric(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const parsed = parseMetricInput(body);
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem criar métricas.");
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_closed", "O desafio está encerrado.");
    await assertMetricCoherent(client, challengeId, parsed);
    const requestedFieldId = typeof body.fieldId === "string" ? body.fieldId : null;
    const { entryTypeId, fieldId } = await resolveMetricField(client, challengeId, parsed.operation, requestedFieldId);
    const id = publicId();
    const positionRow = await oneOrNull<{ position: number }>(client,
      "SELECT coalesce(max(position),-1)::int + 1 AS position FROM challenge_metrics WHERE challenge_id=$1", [challengeId]);
    await client.query(
      `INSERT INTO challenge_metrics
        (id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
         decimal_places,visible_during_challenge,position,settings,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,2,$9,$10,$11::jsonb,$12,now(),now())`,
      [id, challengeId, entryTypeId, fieldId, semanticKey(body.key ?? parsed.label, `metrica_${positionRow?.position ?? 0}`),
        parsed.label, parsed.operation, parsed.groupBy, parsed.visibleDuring, positionRow?.position ?? 0,
        metricSettingsJson(parsed), session.user.id],
    );
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "metric.created", "challenge_metric", id, null, { label: parsed.label, operation: parsed.operation, fieldId });
    return { id };
  });
}

/**
 * Edits an existing metric in place. Safe to change anything (operation,
 * field, grouping) because a metric is only ever a live-computed view over
 * entries — never data of its own — so there is nothing historical to break.
 */
export async function updateMetric(
  session: SessionContext,
  challengeId: string,
  metricId: string,
  body: Record<string, unknown>,
) {
  const parsed = parseMetricInput(body);
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem editar métricas.");
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_closed", "O desafio está encerrado.");
    const existing = await oneOrNull<{ id: string }>(client,
      "SELECT id FROM challenge_metrics WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL FOR UPDATE",
      [metricId, challengeId]);
    if (!existing) throw new ApiError(404, "not_found", "Métrica não encontrada.");
    await assertMetricCoherent(client, challengeId, parsed);
    const requestedFieldId = typeof body.fieldId === "string" ? body.fieldId : null;
    const { entryTypeId, fieldId } = await resolveMetricField(client, challengeId, parsed.operation, requestedFieldId);
    await client.query(
      `UPDATE challenge_metrics
          SET entry_type_id=$3, field_id=$4, label=$5, operation=$6, group_by=$7,
              visible_during_challenge=$8, settings=$9::jsonb, updated_at=now()
        WHERE id=$1 AND challenge_id=$2`,
      [metricId, challengeId, entryTypeId, fieldId, parsed.label, parsed.operation, parsed.groupBy,
        parsed.visibleDuring, metricSettingsJson(parsed)],
    );
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "metric.updated", "challenge_metric", metricId, null, { label: parsed.label, operation: parsed.operation, fieldId });
    return { id: metricId };
  });
}

export async function archiveMetric(session: SessionContext, challengeId: string, metricId: string) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem remover métricas.");
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_closed", "O desafio está encerrado.");
    const existing = await oneOrNull<{ id: string; label: string }>(client,
      "SELECT id, label FROM challenge_metrics WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL FOR UPDATE",
      [metricId, challengeId]);
    if (!existing) throw new ApiError(404, "not_found", "Métrica não encontrada.");
    await client.query("UPDATE challenge_metrics SET archived_at=now(), updated_at=now() WHERE id=$1", [metricId]);
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "metric.archived", "challenge_metric", metricId, null, { label: existing.label });
    return { id: metricId, archived: true as const };
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
    // The Wrapped is curated *after* the round closes — while it is open the
    // internal result is always live, and closing regenerates the blocks anyway
    // (ROADMAP §11).
    if (access.challenge.status !== "closed") {
      throw new ApiError(409, "challenge_not_closed", "A vitrine só pode ser organizada depois que o desafio é encerrado.");
    }
    // Changing the anonymisation setting is a privacy decision: a snapshot that
    // is already public would keep serving the *previous* setting until someone
    // remembers to republish. Take it down automatically instead — the admin
    // publishes again when the new draft is ready (ROADMAP §12).
    let unpublishedForAnon = false;
    if (Object.hasOwn(body, "anonymizeParticipants")) {
      const nextAnon = body.anonymizeParticipants === true;
      if (nextAnon !== access.challenge.results_anon) {
        await client.query("UPDATE challenges SET results_anon = $2, updated_at = now() WHERE id = $1",
          [challengeId, nextAnon]);
        if (access.challenge.results_published_at !== null) {
          await unpublishResults(client, challengeId);
          await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
            "results.unpublished", "challenge", challengeId, null, null, { reason: "anonymization_changed" });
          unpublishedForAnon = true;
        }
      }
    }
    const stillPublished = access.challenge.results_published_at !== null && !unpublishedForAnon;
    if (body.regenerate === true) {
      await generateShowcase(client, challengeId, session.user.id);
      await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
        "results.regenerated", "challenge", challengeId, null, null);
      return { challengeId, published: stillPublished, unpublished: unpublishedForAnon };
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
    // Personal rankings + affinity: on by default, dropped only when the admin
    // clears their checkbox. Frozen from the same live computation.
    if (body.includeRankings !== false || body.includeAffinity !== false) {
      const { personal, affinity } = await computeRankings(client, challengeId);
      if (body.includeRankings !== false && personal.length > 1) {
        await client.query(
          `INSERT INTO result_blocks
            (id,challenge_id,kind,heading,value_snapshot,position,visible,created_by_user_id,created_at,updated_at)
           VALUES ($1,$2,'ranking',$3,$4::jsonb,$5,true,$6,now(),now())`,
          [publicId(), challengeId, "Rankings pessoais", JSON.stringify({ personal }), position++, session.user.id],
        );
      }
      if (body.includeAffinity !== false && affinity && affinity.pairs.length > 0) {
        await client.query(
          `INSERT INTO result_blocks
            (id,challenge_id,kind,heading,value_snapshot,position,visible,created_by_user_id,created_at,updated_at)
           VALUES ($1,$2,'affinity',$3,$4::jsonb,$5,true,$6,now(),now())`,
          [publicId(), challengeId, "Afinidades", JSON.stringify(affinity), position++, session.user.id],
        );
      }
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
    return { challengeId, published: stillPublished, unpublished: unpublishedForAnon };
  });
}

/**
 * Admin reorders the Wrapped's blocks and toggles which ones show, without
 * rebuilding them — the frozen values stay frozen (V1 §11 "O administrador
 * escolhe ordem e visibilidade dos blocos", "Valores calculados não podem ser
 * editados").
 */
export async function reorderResultBlocks(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const wanted = Array.isArray(body.blocks) ? body.blocks : null;
  if (!wanted) throw new ApiError(400, "invalid_request", "Envie a lista de blocos.");
  const parsed = wanted.map((raw) => {
    const record = asRecord(raw);
    if (typeof record.id !== "string" || !record.id) throw new ApiError(400, "invalid_request", "Bloco sem id.");
    return { id: record.id, visible: record.visible !== false };
  });
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores organizam a vitrine.");
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM result_blocks WHERE challenge_id = $1 FOR UPDATE",
      [challengeId],
    );
    if (!existing.rows.length) throw new ApiError(409, "no_blocks", "Salve a vitrine primeiro.");
    const known = new Set(existing.rows.map((row) => row.id));
    for (const block of parsed) {
      if (!known.has(block.id)) throw new ApiError(404, "not_found", "Um bloco não pertence a esta vitrine.");
    }
    let position = 0;
    for (const block of parsed) {
      await client.query(
        "UPDATE result_blocks SET position = $2, visible = $3, updated_at = now() WHERE id = $1 AND challenge_id = $4",
        [block.id, position++, block.visible, challengeId],
      );
    }
    // Anything the client left out keeps its data but drops to the end, hidden.
    await client.query(
      `UPDATE result_blocks SET visible = false, position = position + $2, updated_at = now()
        WHERE challenge_id = $1 AND NOT (id = ANY($3::text[]))`,
      [challengeId, parsed.length, parsed.map((block) => block.id)],
    );
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "results.blocks_reordered", "challenge", challengeId, null, null, { count: parsed.length });
    return { challengeId, blocks: parsed.length };
  });
}

/**
 * A member left the group (or a challenge): every published showcase there is
 * pulled offline and its blocks regenerated without them (V1 §12 "publicações
 * existentes regeneradas anonimamente; link temporariamente despublicado até a
 * regeneração"). The admin republishes when ready.
 */
export async function regeneratePublishedShowcases(
  client: PoolClient,
  groupId: string,
  actorUserId: string,
  options: { challengeId?: string } = {},
): Promise<void> {
  const published = await client.query<{ id: string }>(
    `SELECT id FROM challenges
      WHERE group_id = $1 AND deleted_at IS NULL AND results_published_at IS NOT NULL
        AND ($2::text IS NULL OR id = $2)`,
    [groupId, options.challengeId ?? null],
  );
  for (const row of published.rows) {
    await unpublishResults(client, row.id);
    await client.query("UPDATE challenges SET results_anon = true, updated_at = now() WHERE id = $1", [row.id]);
    await generateShowcase(client, row.id, actorUserId);
    await writeAudit(client, groupId, row.id, actorUserId,
      "results.unpublished", "challenge", row.id, null, null, { reason: "member_left" });
  }
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
    personalRankings: unknown;
    affinity: unknown;
    blocks: unknown;
    totalEntries: number;
    publishedAt: string;
  };
}

/**
 * Freezes the current draft into the document served at `/results/<token>`.
 *
 * Every participant-grouped series, the personal rankings and the affinity pairs
 * lose the real name of anyone who is masked. Who is masked (V1 §12): when
 * `anonymized`, everyone; otherwise only participants without `name_consent`.
 * Item-grouped series keep film / book titles by design.
 */
async function buildPublishedSnapshot(
  client: PoolClient,
  challenge: SnapshotChallenge,
  anonymized: boolean,
) {
  const result = await resultForChallenge(client, challenge.id, undefined, { liveRankings: true });
  const participants = await client.query<{ id: string; display_name: string; name_consent: boolean }>(
    `SELECT u.id, u.display_name, cp.name_consent FROM challenge_participants cp JOIN users u ON u.id=cp.user_id
      WHERE cp.challenge_id=$1 AND cp.removed_at IS NULL ORDER BY u.display_name`,
    [challenge.id],
  );
  const metricList = result.metrics as Array<Record<string, unknown>>;
  let personalRankings = result.personalRankings;
  let affinity = result.affinity;

  const maskedIds = new Set(
    participants.rows.filter((row) => anonymized || !row.name_consent).map((row) => row.id),
  );

  // Who recommended each item — an item-grouped ranking shows this name next to
  // the film, so it needs the same masking as a per-person series.
  const recommenderByItem = new Map<string, string>(
    (await client.query<{ id: string; recommended_by_user_id: string | null }>(
      "SELECT id, recommended_by_user_id FROM challenge_items WHERE challenge_id = $1 AND recommended_by_user_id IS NOT NULL",
      [challenge.id],
    )).rows.map((row) => [row.id, row.recommended_by_user_id as string]),
  );

  // Every id that could carry a name in the payload — so a departed member who
  // was still rated (or recommended a film) also gets a stable "Participante N" label.
  const seriesIds = new Set<string>(maskedIds);
  for (const recommenderId of recommenderByItem.values()) seriesIds.add(recommenderId);
  for (const metric of metricList) {
    if (metric?.groupBy !== "participant" || !Array.isArray(metric.series)) continue;
    for (const row of metric.series as Array<{ key?: unknown }>) if (typeof row.key === "string") seriesIds.add(row.key);
  }
  for (const row of (Array.isArray(personalRankings) ? personalRankings : []) as Array<{ userId?: unknown }>) {
    if (typeof row.userId === "string") seriesIds.add(row.userId);
  }
  for (const pair of ((affinity as { pairs?: unknown })?.pairs ?? []) as Array<{ a?: { userId?: unknown }; b?: { userId?: unknown } }>) {
    if (typeof pair.a?.userId === "string") seriesIds.add(pair.a.userId);
    if (typeof pair.b?.userId === "string") seriesIds.add(pair.b.userId);
  }
  const roster = new Map<string, string>(participants.rows.map((row) => [row.id, row.display_name]));
  const consentById = new Map(participants.rows.map((row) => [row.id, row.name_consent]));
  const extraIds = [...seriesIds].filter((id) => !roster.has(id));
  if (extraIds.length) {
    const extra = await client.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM users WHERE id = ANY($1::text[])", [extraIds]);
    for (const row of extra.rows) roster.set(row.id, row.display_name);
  }
  // A series id not in the participant roster is a departed member — always masked.
  const isMasked = (id: string) => maskedIds.has(id) || anonymized || !consentById.has(id) || consentById.get(id) === false;
  const labelById = new Map(
    [...seriesIds]
      .filter(isMasked)
      .sort((a, b) => (roster.get(a) ?? "").localeCompare(roster.get(b) ?? "", "pt-BR"))
      .map((id, index) => [id, `Participante ${index + 1}`] as const),
  );
  // The published document never carries a real user id — not even for a
  // consenting participant in a named publication. Each id becomes an opaque,
  // per-publication token; the *name* is the only thing that can be shown.
  const publicKeyCache = new Map<string, string>();
  const publicKey = async (id: string): Promise<string> => {
    const cached = publicKeyCache.get(id);
    if (cached) return cached;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${challenge.id}:${id}`));
    const token = "p_" + Array.from(new Uint8Array(digest)).slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
    publicKeyCache.set(id, token);
    return token;
  };
  const publicName = (id: unknown) =>
    typeof id === "string" ? labelById.get(id) ?? roster.get(id) ?? "Participante ?" : "Participante ?";

  const participantNames = participants.rows.map((row) => labelById.get(row.id) ?? row.display_name);
  // An item-grouped row's `recommendedBy` is a real display name — swap it for the
  // masked label when that recommender is masked.
  const maskRecommender = (row: Record<string, unknown>): Record<string, unknown> => {
    if (!("recommendedBy" in row) || typeof row.key !== "string") return row;
    const recommenderId = recommenderByItem.get(row.key);
    if (recommenderId && isMasked(recommenderId)) {
      return { ...row, recommendedBy: labelById.get(recommenderId) ?? "Participante ?" };
    }
    return row;
  };
  const metrics = await Promise.all(metricList.map(async (metric) => {
    if (!Array.isArray(metric.series)) return metric;
    if (metric?.groupBy !== "participant") {
      return { ...metric, series: (metric.series as Array<Record<string, unknown>>).map(maskRecommender) };
    }
    return {
      ...metric,
      series: await Promise.all((metric.series as Array<Record<string, unknown>>).map(async (row) => {
        if (typeof row.key !== "string") return row;
        return { ...row, key: await publicKey(row.key), label: publicName(row.key) };
      })),
    };
  }));
  if (Array.isArray(personalRankings)) {
    personalRankings = await Promise.all((personalRankings as Array<Record<string, unknown>>).map(async (row) =>
      typeof row.userId === "string"
        ? { ...row, userId: await publicKey(row.userId), name: publicName(row.userId) }
        : row,
    ));
  }
  if (affinity && Array.isArray((affinity as { pairs?: unknown }).pairs)) {
    affinity = {
      ...(affinity as Record<string, unknown>),
      pairs: await Promise.all(((affinity as { pairs: Array<{ a: { userId: string }; b: { userId: string } }> }).pairs).map(async (pair) => ({
        ...pair,
        a: { userId: await publicKey(pair.a.userId), name: publicName(pair.a.userId) },
        b: { userId: await publicKey(pair.b.userId), name: publicName(pair.b.userId) },
      }))),
    };
  }

  // The ordered block list carries the same anonymised payloads.
  const metricByPayloadId = new Map(metrics.map((metric) => [metric.id, metric]));
  const blocks = (result.blocks as Array<Record<string, unknown>>).map((block) => {
    if (block.kind === "metric" && block.metric && typeof (block.metric as { id?: unknown }).id === "string") {
      return { ...block, metric: metricByPayloadId.get((block.metric as { id: string }).id) ?? block.metric };
    }
    if (block.kind === "ranking") return { ...block, ranking: personalRankings };
    if (block.kind === "affinity") return { ...block, affinity };
    return block;
  });

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
      personalRankings,
      affinity,
      blocks,
      totalEntries: result.totalEntries,
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
    const existing = await oneOrNull<{ hash: string | null }>(
      client, "SELECT result_share_token_hash AS hash FROM challenges WHERE id=$1", [challengeId]);
    // First publish or an explicit rotate mints a fresh token (the old link dies).
    // A plain re-publish keeps the current link working — its hash is left as is,
    // and the raw token is not re-derivable, so nothing new is handed back.
    const rotate = body.rotateLink === true || !existing?.hash;
    let shareToken: string | null = null;
    let shareHash = existing?.hash ?? "";
    if (rotate) {
      shareToken = generateOpaqueToken();
      shareHash = await hashToken(shareToken);
    }
    await client.query(
      `UPDATE challenges
          SET results_published_snapshot=$2::jsonb, results_published_at=now(),
              result_share_token_hash=$3, updated_at=now()
        WHERE id=$1`,
      [challengeId, JSON.stringify(snapshot), shareHash],
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
        SET results_published_at=NULL, result_share_token_hash=NULL,
            results_published_snapshot=NULL, updated_at=now()
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
      // The parent group's state also gates the public link: a binned group
      // takes its challenges' showcases offline with it (ROADMAP §13).
      `SELECT c.results_published_snapshot AS snapshot FROM challenges c
         JOIN groups g ON g.id = c.group_id AND g.deleted_at IS NULL
        WHERE c.result_share_token_hash=$1 AND c.results_published_at IS NOT NULL
          AND c.status='closed' AND c.deleted_at IS NULL`,
      [hash],
    );
    if (!row || !row.snapshot) throw new ApiError(404, "not_found", "Resultados não encontrados.");
    return { challenge: row.snapshot as PublishedShowcase };
  });
}
