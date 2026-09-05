import type { PoolClient } from "pg";

import type { SessionContext } from "../../auth";
import { withClient } from "../../db";
import { challengeAccess } from "../../goa-domain";
import { ApiError } from "../../http";
import {
  entryTypesForChallenge,
  targetPolicyOf,
  usesCheckpoints,
  usesRoundItems,
} from "./entry-types";

export type PreflightSeverity = "error" | "warning";

export interface PreflightIssue {
  /** Stable code — the client maps it to a localized message. */
  code: string;
  severity: PreflightSeverity;
  /** A short server-side fallback message (pt-BR) for logs / non-localized callers. */
  message: string;
}

export interface PreflightReport {
  ready: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
}

const NUMERIC_OPS = new Set([
  "sum", "average", "min", "max", "bayesian_average", "spread", "surprise", "indicator_bias",
]);

/**
 * The full readiness review a challenge gets before it can be activated. DB
 * CHECK constraints already refuse a structurally broken field/checkpoint, so
 * this focuses on the relational and semantic gaps they can't see: no
 * participants, an item recipe with no items, a metric pointing at a dead
 * field, a checkpoint outside the period, and softer "worth reviewing" notes.
 *
 * The same error list is the hard gate in `transitionChallenge`.
 */
export async function computePreflight(
  client: PoolClient,
  challengeId: string,
): Promise<PreflightReport> {
  const errors: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];
  const err = (code: string, message: string) => errors.push({ code, severity: "error", message });
  const warn = (code: string, message: string) => warnings.push({ code, severity: "warning", message });

  const challenge = await client.query<{
    start_date: string | null; end_date: string | null; time_zone: string; recipe_key: string | null;
  }>(
    "SELECT start_date::text, end_date::text, time_zone, recipe_key FROM challenges WHERE id = $1 AND deleted_at IS NULL",
    [challengeId],
  );
  if (!challenge.rows[0]) throw new ApiError(404, "not_found", "Desafio não encontrado.");
  const hasPeriod = challenge.rows[0].start_date !== null && challenge.rows[0].end_date !== null;

  const counts = await client.query<{
    participants: number; items: number; checkpoints: number; metrics: number; text_fields: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM challenge_participants WHERE challenge_id = $1 AND removed_at IS NULL) AS participants,
       (SELECT count(*)::int FROM challenge_items WHERE challenge_id = $1 AND archived_at IS NULL) AS items,
       (SELECT count(*)::int FROM challenge_checkpoints WHERE challenge_id = $1 AND archived_at IS NULL) AS checkpoints,
       (SELECT count(*)::int FROM challenge_metrics WHERE challenge_id = $1 AND archived_at IS NULL) AS metrics,
       (SELECT count(*)::int FROM challenge_fields WHERE challenge_id = $1 AND archived_at IS NULL AND kind = 'text') AS text_fields`,
    [challengeId],
  );
  const { participants, items, checkpoints, metrics, text_fields } = counts.rows[0];

  const types = await entryTypesForChallenge(client, challengeId);
  const needsItems = usesRoundItems(types);
  const needsCheckpoints = usesCheckpoints(types, hasPeriod);

  // --- blocking checks ---------------------------------------------------

  if (participants === 0) err("no_participants", "O desafio não tem participantes.");

  if (!types.length) {
    err("no_entry_type", "O desafio não tem nenhum tipo de registro.");
  } else if (needsItems && items === 0) {
    err("no_items", "A receita registra por item, mas nenhum item foi adicionado.");
  }
  if (needsCheckpoints && checkpoints === 0) {
    err("no_checkpoints", "O período precisa de checkpoints e nenhum foi gerado.");
  }

  // A participant needs at least one concrete row to fill: a targeted type
  // needs items; a free/daily type is always fillable.
  const canRegister = types.some((type) => {
    const target = targetPolicyOf(type);
    if (target === "none") return true;
    return items > 0;
  });
  if (types.length && !canRegister) {
    err("no_way_to_register", "Não há forma válida de registrar participação (falta item ou checkpoint).");
  }

  const primaryType = types.find((type) => type.is_primary) ?? types[0];
  const fields = await client.query<{
    id: string; entry_type_id: string; kind: string; required: boolean; label: string; archived_at: Date | null;
  }>(
    "SELECT id, entry_type_id, kind, required, label, archived_at FROM challenge_fields WHERE challenge_id = $1",
    [challengeId],
  );
  const liveFields = fields.rows.filter((field) => field.archived_at === null);
  if (primaryType && !liveFields.some((field) => field.entry_type_id === primaryType.id)) {
    err("primary_type_no_fields", "O tipo de registro principal não tem nenhum campo.");
  }

  const choiceFieldIds = liveFields.filter((field) => field.kind === "choice").map((field) => field.id);
  if (choiceFieldIds.length) {
    const optionCounts = await client.query<{ field_id: string; total: number }>(
      "SELECT field_id, count(*)::int AS total FROM field_options WHERE field_id = ANY($1) GROUP BY field_id",
      [choiceFieldIds],
    );
    const withOptions = new Set(optionCounts.rows.filter((row) => row.total > 0).map((row) => row.field_id));
    for (const fieldId of choiceFieldIds) {
      if (!withOptions.has(fieldId)) {
        const label = liveFields.find((field) => field.id === fieldId)?.label ?? fieldId;
        err("choice_without_options", `O campo de escolha "${label}" não tem opções.`);
      }
    }
  }

  const liveFieldById = new Map(liveFields.map((field) => [field.id, field]));
  const metricRows = await client.query<{
    id: string; label: string; operation: string; field_id: string | null; group_by: string; settings: unknown;
  }>(
    "SELECT id, label, operation, field_id, group_by, settings FROM challenge_metrics WHERE challenge_id = $1 AND archived_at IS NULL",
    [challengeId],
  );
  for (const metric of metricRows.rows) {
    if (metric.field_id && !liveFieldById.has(metric.field_id)) {
      err("metric_field_archived", `A métrica "${metric.label}" aponta para um campo que não existe mais.`);
      continue;
    }
    const field = metric.field_id ? liveFieldById.get(metric.field_id) : null;
    if (NUMERIC_OPS.has(metric.operation)) {
      if (!field) {
        err("metric_needs_field", `A métrica "${metric.label}" precisa de um campo numérico.`);
      } else if (field.kind !== "number" && field.kind !== "rating") {
        err("metric_field_not_numeric", `A métrica "${metric.label}" usa uma operação numérica sobre o campo "${field.label}", que não é numérico.`);
      }
    }
    const settings = (metric.settings ?? {}) as { minSample?: number };
    const minSample = Number(settings.minSample);
    if (
      Number.isFinite(minSample)
      && minSample > 0
      && (metric.operation === "bayesian_average" || metric.operation === "spread")
      && metric.group_by === "item"
      && participants > 0
      && minSample > participants
    ) {
      warn("ranking_min_sample_unreachable", `A métrica "${metric.label}" exige ${minSample} avaliações por item, mas o desafio só tem ${participants} participante(s).`);
    }
    if (field && !field.required && NUMERIC_OPS.has(metric.operation)) {
      warn("metric_on_optional_field", `A métrica "${metric.label}" depende do campo opcional "${field.label}", que pode ficar sem dados.`);
    }
  }

  if (hasPeriod) {
    const outOfRange = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM challenge_checkpoints cc
        JOIN challenges c ON c.id = cc.challenge_id
       WHERE cc.challenge_id = $1 AND cc.archived_at IS NULL
         AND (
           (cc.starts_at IS NOT NULL AND (cc.starts_at AT TIME ZONE c.time_zone)::date < c.start_date)
           OR (cc.due_at IS NOT NULL AND (cc.due_at AT TIME ZONE c.time_zone)::date > c.end_date)
         )`,
      [challengeId],
    );
    if (outOfRange.rows[0].count > 0) {
      err("checkpoint_outside_period", "Há checkpoint fora do período do desafio.");
    }
  }

  // --- warnings --------------------------------------------------------

  if (metrics === 0) warn("no_metrics", "Nenhuma métrica configurada — a retrospectiva ficará vazia.");
  if (text_fields === 0) warn("no_comment_source", "Nenhum campo de texto — não haverá comentários para a retrospectiva.");

  const requiredOnPrimary = primaryType
    ? liveFields.filter((field) => field.entry_type_id === primaryType.id && field.required).length
    : 0;
  if (requiredOnPrimary > 5) {
    warn("many_required_fields", `O formulário tem ${requiredOnPrimary} campos obrigatórios — considere tornar alguns opcionais.`);
  }

  if (needsItems && hasPeriod && items > 0 && checkpoints > 0 && items / checkpoints > 3) {
    warn("many_items_for_period", `São ${items} itens para ${checkpoints} checkpoint(s) — pode ser apertado.`);
  }

  // An expectation everyone can see in real time colours the others' guesses —
  // the sane default is "after_own".
  const openExpectation = types.find(
    (type) => type.purpose === "expectation" && type.visibility_policy === "group_realtime",
  );
  if (openExpectation) {
    warn("expectation_visible_early", "A expectativa está visível para o grupo antes da avaliação — considere 'depois da própria resposta'.");
  }

  return { ready: errors.length === 0, errors, warnings };
}

export async function challengePreflight(session: SessionContext, challengeId: string): Promise<PreflightReport> {
  return withClient(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client);
    if (!access.canManage) {
      throw new ApiError(403, "forbidden", "Somente administradores veem a revisão de prontidão.");
    }
    return computePreflight(client, challengeId);
  });
}
