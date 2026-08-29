import type { PoolClient } from "pg";
import { type SessionContext, requireGroupRole } from "./auth";
import { inTransaction, oneOrNull, withClient } from "./db";
import {
  asRecord,
  challengeAccess,
  dateString,
  insertField,
  integerValue,
  publicId,
  semanticKey,
  writeAudit,
} from "./goa-domain";
import { ApiError, stringValue } from "./http";
import { calculateMetric, type MetricOperation } from "./metrics";
import { generateOpaqueToken, hashToken } from "./security";
import {
  escapeCsvCell,
  type FieldDefinition,
  validateFieldValue,
} from "./validation";

interface MetricRow {
  id: string;
  challenge_id: string;
  entry_type_id: string;
  field_id: string | null;
  semantic_key: string;
  label: string;
  operation: MetricOperation;
  group_by: "none" | "participant" | "item" | "day" | "week";
  decimal_places: number;
  visible_during_challenge: boolean;
  position: number;
  settings?: Record<string, unknown>;
}

interface FieldRow {
  id: string;
  challenge_id: string;
  entry_type_id: string;
  semantic_key: string;
  label: string;
  help_text: string | null;
  kind: "text" | "number" | "rating" | "choice" | "boolean" | "date";
  required: boolean;
  position: number;
  number_scale: number | null;
  min_scaled: number | null;
  max_scaled: number | null;
  step_scaled: number | null;
  max_length: number | null;
  settings: Record<string, unknown>;
}

function unscale(value: number | null, scale: number | null): number | undefined {
  return value === null || scale === null ? undefined : value / 10 ** scale;
}

function scaledConfigValue(value: unknown, scale: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  const result = Math.round(parsed * 10 ** scale);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(result)) {
    throw new ApiError(400, "invalid_field_config", "Limite numérico fora da faixa.");
  }
  return result;
}

function windowStatus(
  challengeStatus: "draft" | "active" | "closed",
  opensAt: Date | null,
  dueAt: Date | null,
): "scheduled" | "open" | "past_due" | "closed" {
  if (challengeStatus === "closed") return "closed";
  const now = Date.now();
  if (opensAt && opensAt.getTime() > now) return "scheduled";
  if (dueAt && dueAt.getTime() <= now) return "past_due";
  return "open";
}

async function generateDailyCheckpoints(
  client: PoolClient,
  challengeId: string,
  startsOn: string,
  endsOn: string,
): Promise<string[]> {
  const current = new Date(`${startsOn}T00:00:00Z`);
  const last = new Date(`${endsOn}T00:00:00Z`);
  const ids: string[] = [];
  let position = 0;
  while (current <= last) {
    if (position >= 366) throw new ApiError(400, "date_range", "Use no máximo 366 checkpoints.");
    const day = current.toISOString().slice(0, 10);
    const inserted = await oneOrNull<{ id: string }>(client,
      `INSERT INTO challenge_checkpoints
        (id,challenge_id,semantic_key,title,position,starts_at,due_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::date::timestamp AT TIME ZONE 'America/Sao_Paulo',
               ($6::date + interval '1 day')::timestamp AT TIME ZONE 'America/Sao_Paulo',now(),now())
       ON CONFLICT (challenge_id,semantic_key) DO UPDATE SET
         title=excluded.title,position=excluded.position,starts_at=excluded.starts_at,
         due_at=excluded.due_at,archived_at=NULL,updated_at=now()
       RETURNING id`,
      [publicId(), challengeId, `dia_${position + 1}`, `Dia ${position + 1}`, position, day]);
    if (inserted) ids.push(inserted.id);
    position += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  await client.query(
    `UPDATE challenge_checkpoints SET archived_at=now(),updated_at=now()
      WHERE challenge_id=$1 AND archived_at IS NULL AND NOT (id=ANY($2::text[]))`,
    [challengeId, ids],
  );
  return ids;
}

async function fieldsForChallenge(client: PoolClient, challengeId: string): Promise<Array<Record<string, unknown>>> {
  const fieldResult = await client.query<FieldRow>(
    `SELECT id, challenge_id, entry_type_id, semantic_key, label, help_text, kind, required,
            position, number_scale, min_scaled, max_scaled, step_scaled, max_length, settings
       FROM challenge_fields
      WHERE challenge_id = $1 AND archived_at IS NULL
      ORDER BY position, created_at`,
    [challengeId],
  );
  const ids = fieldResult.rows.map((field) => field.id);
  const optionsByField = new Map<string, Array<Record<string, unknown>>>();
  if (ids.length) {
    const options = await client.query<{
      id: string;
      field_id: string;
      semantic_key: string;
      label: string;
    }>(
      `SELECT id, field_id, semantic_key, label FROM field_options
        WHERE field_id = ANY($1::text[]) AND archived_at IS NULL ORDER BY position`,
      [ids],
    );
    for (const option of options.rows) {
      const list = optionsByField.get(option.field_id) ?? [];
      list.push({ id: option.id, value: option.semantic_key, label: option.label });
      optionsByField.set(option.field_id, list);
    }
  }
  return fieldResult.rows.map((field) => ({
    id: field.id,
    entryTypeId: field.entry_type_id,
    key: field.semantic_key,
    label: field.label,
    helpText: field.help_text,
    type: field.kind === "choice" ? "select" : field.kind,
    required: field.required,
    position: field.position,
    config: {
      multiline: field.kind === "text" && field.settings?.multiline === true,
      min: unscale(field.min_scaled, field.number_scale),
      max: unscale(field.max_scaled, field.number_scale),
      step: unscale(field.step_scaled, field.number_scale),
      maxLength: field.max_length ?? undefined,
      options: optionsByField.get(field.id) ?? [],
    },
  }));
}

async function calculateMetricRow(client: PoolClient, metric: MetricRow): Promise<Record<string, unknown>> {
  let result;
  if (metric.operation === "completion_rate") {
    const context = await oneOrNull<{
      submission_mode: "item" | "daily" | "free";
      start_date: string;
      end_date: string;
      participants: number;
      completed: number;
      item_count: number;
    }>(
      client,
      `SELECT et.submission_mode, c.start_date::text AS start_date, c.end_date::text AS end_date,
              (SELECT count(*)::int FROM challenge_participants cp
                WHERE cp.challenge_id = c.id AND cp.removed_at IS NULL) AS participants,
              (SELECT count(*)::int FROM entries e
                WHERE e.challenge_id = c.id AND e.entry_type_id = et.id AND e.deleted_at IS NULL) AS completed,
              (SELECT count(*)::int FROM challenge_items ci
                WHERE ci.challenge_id = c.id AND ci.entry_type_id = et.id AND ci.archived_at IS NULL) AS item_count
         FROM entry_types et JOIN challenges c ON c.id = et.challenge_id
        WHERE et.id = $1 AND c.id = $2`,
      [metric.entry_type_id, metric.challenge_id],
    );
    const expected = !context
      ? 0
      : context.participants *
        (context.submission_mode === "item"
          ? context.item_count
          : context.submission_mode === "daily"
            ? Math.max(0, Math.round((new Date(`${context.end_date}T00:00:00Z`).getTime() - new Date(`${context.start_date}T00:00:00Z`).getTime()) / 86_400_000) + 1)
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

async function resultForChallenge(client: PoolClient, challengeId: string) {
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
  const currentMetrics = await metricsForChallenge(client, challengeId);
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

export async function getChallengeDetail(session: SessionContext, challengeId: string) {
  return withClient(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client);
    const fields = await fieldsForChallenge(client, challengeId);
    const itemsResult = await client.query<{
        id: string; entry_type_id: string; title: string; description: string | null;
        position: number; opens_at: Date | null; due_at: Date | null;
      }>(
        `SELECT id, entry_type_id, title, description, position, opens_at, due_at
           FROM challenge_items WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position`,
        [challengeId],
      );
    const checkpointsResult = await client.query<{
        id: string; title: string; description: string | null; position: number;
        starts_at: Date | null; due_at: Date | null;
      }>(
        `SELECT id, title, description, position, starts_at, due_at
           FROM challenge_checkpoints WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position`,
        [challengeId],
      );
    const participantsResult = await client.query<{ id: string; display_name: string; username: string }>(
        `SELECT u.id, u.display_name, u.username
           FROM challenge_participants cp JOIN users u ON u.id = cp.user_id
          WHERE cp.challenge_id = $1 AND cp.removed_at IS NULL ORDER BY u.display_name`,
        [challengeId],
      );
    const typeResult = await client.query<{ submission_mode: "item" | "daily" | "free" }>(
        "SELECT submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1",
        [challengeId],
      );
    const metrics = await metricsForChallenge(client, challengeId);
    const result = await resultForChallenge(client, challengeId);
    const items = itemsResult.rows.length
      ? itemsResult.rows.map((item) => ({
          id: item.id, entryTypeId: item.entry_type_id, title: item.title,
          description: item.description, position: item.position,
          opensAt: item.opens_at?.toISOString() ?? null, dueAt: item.due_at?.toISOString() ?? null,
          status: windowStatus(access.challenge.status, item.opens_at, item.due_at),
        }))
      : checkpointsResult.rows.map((checkpoint) => ({
          id: checkpoint.id, checkpointId: checkpoint.id, title: checkpoint.title,
          description: checkpoint.description, position: checkpoint.position,
          opensAt: checkpoint.starts_at?.toISOString() ?? null,
          dueAt: checkpoint.due_at?.toISOString() ?? null,
          date: checkpoint.starts_at?.toISOString().slice(0, 10) ?? null,
          status: windowStatus(access.challenge.status, checkpoint.starts_at, checkpoint.due_at),
        }));
    return {
      id: access.challenge.id,
      groupId: access.challenge.group_id,
      title: access.challenge.title,
      description: access.challenge.description,
      rules: access.challenge.rules,
      startsOn: access.challenge.start_date,
      endsOn: access.challenge.end_date,
      status: access.challenge.status,
      submissionMode: typeResult.rows[0]?.submission_mode ?? "free",
      viewerRole: access.challenge.role,
      isParticipant: access.challenge.is_participant,
      fields,
      items,
      participants: participantsResult.rows.map((participant) => ({
        id: participant.id, userId: participant.id, name: participant.display_name, username: participant.username,
      })),
      metrics,
      result,
    };
  });
}

export async function updateChallenge(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem editar o desafio.");
    if (access.challenge.status === "closed") {
      throw new ApiError(409, "challenge_locked", "Desafios encerrados preservam sua leitura histórica.");
    }
    const title = body.title === undefined ? access.challenge.title : stringValue(body, "title", { max: 160 })!;
    const description = body.description === undefined
      ? access.challenge.description
      : stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
    const rules = body.rules === undefined
      ? access.challenge.rules
      : stringValue(body, "rules", { max: 10_000, optional: true }) ?? null;
    const startDate = body.startsOn === undefined && body.startDate === undefined
      ? access.challenge.start_date
      : dateString(body.startsOn ?? body.startDate, "Data inicial");
    const endDate = body.endsOn === undefined && body.endDate === undefined
      ? access.challenge.end_date
      : dateString(body.endsOn ?? body.endDate, "Data final");
    if (endDate < startDate) throw new ApiError(400, "date_range", "A data final deve ser posterior ao início.");
    if (access.challenge.status === "active" &&
      (startDate !== access.challenge.start_date || endDate !== access.challenge.end_date)) {
      throw new ApiError(409, "dates_locked", "As datas não podem mudar depois da ativação.");
    }
    await client.query(
      `UPDATE challenges SET title=$2, description=$3, rules=$4, start_date=$5,
              end_date=$6, updated_at=now() WHERE id=$1`,
      [challengeId, title, description, rules, startDate, endDate],
    );
    if (access.challenge.status === "draft") {
      const entryType = await oneOrNull<{ submission_mode: string }>(client,
        "SELECT submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1",
        [challengeId]);
      if (entryType?.submission_mode === "daily") {
        await generateDailyCheckpoints(client, challengeId, startDate, endDate);
      }
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "challenge.updated", "challenge", challengeId,
      { title: access.challenge.title, description: access.challenge.description, rules: access.challenge.rules,
        startsOn: access.challenge.start_date, endsOn: access.challenge.end_date },
      { title, description, rules, startsOn: startDate, endsOn: endDate });
    return { id: challengeId, title, description, rules, startsOn: startDate, endsOn: endDate };
  });
}

export async function setChallengeParticipants(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const requestedIds = Array.isArray(body.participantIds)
    ? [...new Set(body.participantIds.filter((id): id is string => typeof id === "string"))]
    : typeof body.userId === "string" ? [body.userId] : [];
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem definir participantes.");
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_closed", "O desafio está encerrado.");
    const members = requestedIds.length
      ? await client.query<{ user_id: string }>(
          `SELECT user_id FROM group_members WHERE group_id=$1 AND user_id=ANY($2::text[]) AND removed_at IS NULL`,
          [access.challenge.group_id, requestedIds],
        )
      : { rows: [] as Array<{ user_id: string }> };
    if (members.rows.length !== requestedIds.length) {
      throw new ApiError(400, "invalid_participant", "Todos os participantes precisam ser membros ativos do grupo.");
    }
    if (body.replace === true) {
      await client.query(
        `UPDATE challenge_participants SET removed_at=now()
          WHERE challenge_id=$1 AND removed_at IS NULL
            AND NOT (user_id=ANY($2::text[]))`,
        [challengeId, requestedIds],
      );
    }
    for (const member of members.rows) {
      await client.query(
        `INSERT INTO challenge_participants
          (challenge_id, group_id, user_id, added_by_user_id, joined_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (challenge_id,user_id) DO UPDATE SET removed_at=NULL, joined_at=now(), added_by_user_id=$4`,
        [challengeId, access.challenge.group_id, member.user_id, session.user.id],
      );
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "challenge.participants_updated", "challenge", challengeId, null, { participantIds: requestedIds });
    return { participantIds: requestedIds };
  });
}

export async function addChallengeField(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem criar campos.");
    if (access.challenge.status !== "draft") throw new ApiError(409, "challenge_locked", "Campos só podem ser criados no rascunho.");
    const entryType = await oneOrNull<{ id: string }>(client,
      "SELECT id FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1", [challengeId]);
    if (!entryType) throw new ApiError(409, "missing_entry_type", "O desafio não possui tipo de registro.");
    const positionRow = await oneOrNull<{ position: number }>(client,
      "SELECT coalesce(max(position),-1)::int + 1 AS position FROM challenge_fields WHERE challenge_id=$1", [challengeId]);
    const inserted = await insertField(client, challengeId, entryType.id, body, positionRow?.position ?? 0);
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "field.created", "challenge_field", inserted.id, null, { key: inserted.semanticKey, kind: inserted.kind });
    return { id: inserted.id };
  });
}

export async function saveChallengeFields(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  if (!Array.isArray(body.fields)) return addChallengeField(session, challengeId, body);
  const requestedFields = body.fields;
  if (!requestedFields.length || requestedFields.length > 30) throw new ApiError(400, "field_limit", "Use de 1 a 30 campos.");
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem editar campos.");
    if (access.challenge.status !== "draft") throw new ApiError(409, "challenge_locked", "Campos só podem ser editados no rascunho.");
    const entryType = await oneOrNull<{ id: string }>(client,
      "SELECT id FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1", [challengeId]);
    if (!entryType) throw new ApiError(409, "missing_entry_type", "Tipo de registro ausente.");
    const keptIds: string[] = [];
    for (let position = 0; position < requestedFields.length; position += 1) {
      const field = asRecord(requestedFields[position]);
      if (typeof field.id !== "string") {
        const inserted = await insertField(client, challengeId, entryType.id, field, position);
        keptIds.push(inserted.id);
        continue;
      }
      const current = await oneOrNull<{
        id: string; kind: string; number_scale: number | null; min_scaled: number | null;
        max_scaled: number | null; step_scaled: number | null; max_length: number | null;
        settings: Record<string, unknown>;
      }>(client,
        `SELECT id,kind,number_scale,min_scaled,max_scaled,step_scaled,max_length,settings
           FROM challenge_fields WHERE id=$1 AND challenge_id=$2`, [field.id, challengeId]);
      if (!current) throw new ApiError(400, "invalid_field", "Campo não pertence ao desafio.");
      const requestedKind = field.type === "select" ? "choice" : field.type;
      if (requestedKind !== undefined && requestedKind !== current.kind) {
        throw new ApiError(409, "immutable_field_type", "O tipo de um campo persistido não pode ser alterado.");
      }
      const label = typeof field.label === "string" ? field.label.trim() : "";
      if (!label || label.length > 120) throw new ApiError(400, "invalid_field", "Rótulo de campo inválido.");
      const config = asRecord(field.config);
      let minScaled = current.min_scaled;
      let maxScaled = current.max_scaled;
      let stepScaled = current.step_scaled;
      let maxLength = current.max_length;
      let settings = current.settings ?? {};
      if (current.kind === "number") {
        const scale = current.number_scale ?? 3;
        minScaled = scaledConfigValue(config.min, scale);
        maxScaled = scaledConfigValue(config.max, scale);
        stepScaled = scaledConfigValue(config.step, scale);
        if (minScaled !== null && maxScaled !== null && maxScaled < minScaled) {
          throw new ApiError(400, "invalid_field_config", "O máximo precisa ser maior ou igual ao mínimo.");
        }
        if (stepScaled !== null && stepScaled <= 0) {
          throw new ApiError(400, "invalid_field_config", "O intervalo precisa ser positivo.");
        }
      } else if (current.kind === "text") {
        maxLength = integerValue(config.maxLength, current.max_length ?? 5_000, 1, 20_000);
        settings = { ...settings, multiline: config.multiline === true };
      }
      await client.query(
        `UPDATE challenge_fields SET label=$2,help_text=$3,required=$4,position=$5,
                min_scaled=$6,max_scaled=$7,step_scaled=$8,max_length=$9,settings=$10::jsonb,
                archived_at=NULL,updated_at=now() WHERE id=$1`,
        [field.id, label, typeof field.helpText === "string" ? field.helpText.trim() || null : null,
          field.required === true, position, minScaled, maxScaled, stepScaled, maxLength, JSON.stringify(settings)],
      );
      keptIds.push(field.id);
      if (current.kind === "choice") {
        const options = Array.isArray(config.options) ? config.options : [];
        if (!options.length) throw new ApiError(400, "invalid_field", "Campos de opção precisam de alternativas.");
        const keptOptions: string[] = [];
        for (let optionPosition = 0; optionPosition < options.length; optionPosition += 1) {
          const option = asRecord(options[optionPosition]);
          const labelValue = typeof option.label === "string" ? option.label.trim() : "";
          if (!labelValue) throw new ApiError(400, "invalid_field", "Opção sem rótulo.");
          if (typeof option.id === "string") {
            const updated = await client.query(
              `UPDATE field_options SET label=$3,position=$4,archived_at=NULL
                WHERE id=$1 AND field_id=$2 RETURNING id`,
              [option.id, field.id, labelValue, optionPosition],
            );
            if (!updated.rowCount) throw new ApiError(400, "invalid_option", "Opção não pertence ao campo.");
            keptOptions.push(option.id);
          } else {
            const optionId = publicId();
            await client.query(
              `INSERT INTO field_options (id,field_id,semantic_key,label,position,created_at)
               VALUES ($1,$2,$3,$4,$5,now())`,
              [optionId, field.id, semanticKey(option.value ?? option.label, `opcao_${optionPosition + 1}`), labelValue, optionPosition],
            );
            keptOptions.push(optionId);
          }
        }
        await client.query(
          `UPDATE field_options SET archived_at=now()
            WHERE field_id=$1 AND archived_at IS NULL AND NOT (id=ANY($2::text[]))`,
          [field.id, keptOptions],
        );
      }
    }
    if (body.archiveMissing === true || body.replace === true) {
      await client.query(
        `UPDATE challenge_fields SET archived_at=now(),updated_at=now()
          WHERE challenge_id=$1 AND archived_at IS NULL AND NOT (id=ANY($2::text[]))`,
        [challengeId, keptIds],
      );
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "fields.updated", "challenge", challengeId, null, { fieldIds: keptIds });
    return { fieldIds: keptIds };
  });
}

export async function addChallengeItem(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const title = stringValue(body, "title", { max: 200 })!;
  const description = stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem criar itens.");
    if (access.challenge.status !== "draft") throw new ApiError(409, "challenge_locked", "Itens só podem ser criados no rascunho.");
    const entryType = await oneOrNull<{ id: string; submission_mode: string }>(client,
      "SELECT id, submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1", [challengeId]);
    if (!entryType || entryType.submission_mode !== "item") throw new ApiError(409, "invalid_mode", "Este desafio não usa itens.");
    const position = integerValue(body.position, 0, 0, 10_000);
    const id = publicId();
    await client.query(
      `INSERT INTO challenge_items
        (id, challenge_id, entry_type_id, semantic_key, title, description, position, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,now(),now())`,
      [id, challengeId, entryType.id, semanticKey(body.key ?? title, `item_${position + 1}`), title, description, position],
    );
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "item.created", "challenge_item", id, null, { title });
    return { id, title, position };
  });
}

export async function saveChallengeItems(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const generation = asRecord(body.generate);
  if (generation.frequency === "daily") {
    const startsOn = dateString(generation.startsOn, "Data inicial");
    const endsOn = dateString(generation.endsOn, "Data final");
    if (endsOn < startsOn) throw new ApiError(400, "date_range", "A data final deve ser posterior ao início.");
    return inTransaction(async (client) => {
      const access = await challengeAccess(session.user.id, challengeId, client, true);
      if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem gerar checkpoints.");
      if (access.challenge.status !== "draft") throw new ApiError(409, "challenge_locked", "Checkpoints só podem ser gerados no rascunho.");
      const type = await oneOrNull<{ submission_mode: string }>(client,
        "SELECT submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1",
        [challengeId]);
      if (type?.submission_mode !== "daily") {
        throw new ApiError(409, "invalid_mode", "Este desafio não usa checkpoints diários.");
      }
      if (startsOn !== access.challenge.start_date || endsOn !== access.challenge.end_date) {
        throw new ApiError(400, "date_range", "Os checkpoints diários precisam cobrir todo o período do desafio.");
      }
      const ids = await generateDailyCheckpoints(client, challengeId, startsOn, endsOn);
      await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
        "checkpoints.generated", "challenge", challengeId, null, { startsOn, endsOn, count: ids.length });
      return { checkpointIds: ids };
    });
  }
  if (!Array.isArray(body.items)) return addChallengeItem(session, challengeId, body);
  const requestedItems = body.items;
  if (!requestedItems.length || requestedItems.length > 200) throw new ApiError(400, "item_limit", "Use de 1 a 200 itens.");
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem criar itens.");
    if (access.challenge.status !== "draft") throw new ApiError(409, "challenge_locked", "Itens só podem ser editados no rascunho.");
    const type = await oneOrNull<{ id: string; submission_mode: string }>(client,
      "SELECT id,submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1", [challengeId]);
    if (!type || type.submission_mode !== "item") throw new ApiError(409, "invalid_mode", "Este desafio não usa itens.");
    const ids: string[] = [];
    for (let position = 0; position < requestedItems.length; position += 1) {
      const item = asRecord(requestedItems[position]);
      const title = typeof item.title === "string" ? item.title.trim() : "";
      if (!title) throw new ApiError(400, "invalid_item", "Item sem título.");
      const id = publicId();
      await client.query(
        `INSERT INTO challenge_items
          (id,challenge_id,entry_type_id,semantic_key,title,description,position,metadata,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,now(),now())`,
        [id, challengeId, type.id, semanticKey(item.key ?? title, `item_${position + 1}`), title,
          typeof item.description === "string" ? item.description.trim() || null : null, position],
      );
      ids.push(id);
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "items.created", "challenge", challengeId, null, { itemIds: ids });
    return { itemIds: ids };
  });
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
      const type = await oneOrNull<{ id: string }>(client,
        "SELECT id FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1", [challengeId]);
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

export async function transitionChallenge(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const target = body.status;
  if (target !== "active" && target !== "closed") throw new ApiError(400, "invalid_status", "Transição inválida.");
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem mudar o estado.");
    const valid = (access.challenge.status === "draft" && target === "active") ||
      (access.challenge.status === "active" && target === "closed");
    if (!valid) throw new ApiError(409, "invalid_transition", "A transição de estado não é permitida.");
    if (target === "active") {
      const readiness = await oneOrNull<{
        submission_mode: "item" | "daily" | "free";
        fields: number; participants: number; items: number; checkpoints: number;
      }>(client,
        `SELECT et.submission_mode,
           (SELECT count(*)::int FROM challenge_fields WHERE challenge_id=$1 AND archived_at IS NULL) AS fields,
           (SELECT count(*)::int FROM challenge_participants WHERE challenge_id=$1 AND removed_at IS NULL) AS participants,
           (SELECT count(*)::int FROM challenge_items WHERE challenge_id=$1 AND archived_at IS NULL) AS items,
           (SELECT count(*)::int FROM challenge_checkpoints WHERE challenge_id=$1 AND archived_at IS NULL) AS checkpoints
           FROM entry_types et WHERE et.challenge_id=$1 AND et.archived_at IS NULL
           ORDER BY et.created_at LIMIT 1`,
        [challengeId]);
      if (!readiness?.fields || !readiness.participants) {
        throw new ApiError(409, "challenge_incomplete", "Adicione campos e participantes antes de ativar.");
      }
      if ((readiness.submission_mode === "item" && !readiness.items) ||
          (readiness.submission_mode === "daily" && !readiness.checkpoints)) {
        throw new ApiError(409, "challenge_incomplete", "Adicione os itens ou checkpoints antes de ativar.");
      }
      await client.query("UPDATE challenges SET status='active', activated_at=now(), updated_at=now() WHERE id=$1", [challengeId]);
    } else {
      const metricRows = await client.query<MetricRow>(
        `SELECT id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
                decimal_places,visible_during_challenge,position,settings
           FROM challenge_metrics WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [challengeId]);
      await client.query("UPDATE challenges SET status='closed', closed_at=now(), updated_at=now() WHERE id=$1", [challengeId]);
      const existingBlocks = await oneOrNull<{ count: number }>(client,
        "SELECT count(*)::int AS count FROM result_blocks WHERE challenge_id=$1", [challengeId]);
      if (!existingBlocks?.count) {
        for (const metric of metricRows.rows) {
          const value = await calculateMetricRow(client, metric);
          await client.query(
            `INSERT INTO result_blocks
              (id,challenge_id,kind,metric_id,heading,value_snapshot,position,visible,created_by_user_id,created_at,updated_at)
             VALUES ($1,$2,'metric',$3,$4,$5::jsonb,$6,true,$7,now(),now())`,
            [publicId(), challengeId, metric.id, metric.label, JSON.stringify(value), metric.position, session.user.id],
          );
        }
      }
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      `challenge.${target}`, "challenge", challengeId, { status: access.challenge.status }, { status: target });
    return { id: challengeId, status: target };
  });
}

interface StorageField extends FieldRow {
  option_ids: string[];
}

async function storageFields(client: PoolClient, challengeId: string, entryTypeId: string): Promise<StorageField[]> {
  const fields = await client.query<FieldRow>(
    `SELECT id,challenge_id,entry_type_id,semantic_key,label,help_text,kind,required,position,
            number_scale,min_scaled,max_scaled,step_scaled,max_length,settings
       FROM challenge_fields WHERE challenge_id=$1 AND entry_type_id=$2 AND archived_at IS NULL
      ORDER BY position`,
    [challengeId, entryTypeId],
  );
  const ids = fields.rows.map((field) => field.id);
  const options = ids.length
    ? await client.query<{ id: string; field_id: string }>(
        "SELECT id,field_id FROM field_options WHERE field_id=ANY($1::text[]) AND archived_at IS NULL", [ids])
    : { rows: [] as Array<{ id: string; field_id: string }> };
  return fields.rows.map((field) => ({
    ...field,
    option_ids: options.rows.filter((option) => option.field_id === field.id).map((option) => option.id),
  }));
}

function fieldDefinition(field: StorageField): FieldDefinition {
  const factor = 10 ** (field.number_scale ?? 0);
  if (field.kind === "text") return { type: "text", required: field.required, maxLength: field.max_length ?? 5_000 };
  if (field.kind === "number") return {
    type: "number",
    required: field.required,
    min: field.min_scaled === null ? undefined : field.min_scaled / factor,
    max: field.max_scaled === null ? undefined : field.max_scaled / factor,
    step: field.step_scaled === null ? undefined : field.step_scaled / factor,
  };
  if (field.kind === "rating") return { type: "rating", required: field.required };
  if (field.kind === "choice") return { type: "choice", required: field.required, optionIds: field.option_ids };
  if (field.kind === "boolean") return { type: "boolean", required: field.required };
  return { type: "date", required: field.required };
}

async function writeEntryValues(
  client: PoolClient,
  entryId: string,
  challengeId: string,
  entryTypeId: string,
  fields: StorageField[],
  rawValues: unknown,
): Promise<Record<string, unknown>> {
  const values = asRecord(rawValues);
  const knownKeys = new Set(fields.flatMap((field) => [field.id, field.semantic_key]));
  const unknown = Object.keys(values).filter((key) => !knownKeys.has(key));
  if (unknown.length) throw new ApiError(400, "unknown_field", "O registro contém campos desconhecidos.", unknown);
  const normalized: Record<string, unknown> = {};
  for (const field of fields) {
    const candidate = Object.hasOwn(values, field.id) ? values[field.id] : values[field.semantic_key];
    const validation = validateFieldValue(fieldDefinition(field), candidate);
    if (!validation.ok) {
      throw new ApiError(400, "invalid_entry_value", `${field.label}: ${validation.message}`, { fieldId: field.id, code: validation.code });
    }
    if (validation.value === null) continue;
    const columns: [string | null, number | null, boolean | null, string | null, string | null] = [null, null, null, null, null];
    if (field.kind === "text") columns[0] = validation.value as string;
    else if (field.kind === "number" || field.kind === "rating") {
      columns[1] = Math.round((validation.value as number) * 10 ** (field.number_scale ?? 0));
    } else if (field.kind === "boolean") columns[2] = validation.value as boolean;
    else if (field.kind === "date") columns[3] = validation.value as string;
    else if (field.kind === "choice") columns[4] = validation.value as string;
    await client.query(
      `INSERT INTO entry_values
        (entry_id,challenge_id,entry_type_id,field_id,text_value,number_scaled,boolean_value,date_value,option_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())`,
      [entryId, challengeId, entryTypeId, field.id, ...columns],
    );
    normalized[field.id] = validation.value;
  }
  return normalized;
}

async function entryValues(client: PoolClient, entryIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const byEntry = new Map<string, Record<string, unknown>>();
  if (!entryIds.length) return byEntry;
  const values = await client.query<{
    entry_id: string; field_id: string; text_value: string | null; number_scaled: number | null;
    boolean_value: boolean | null; date_value: string | null; option_id: string | null; number_scale: number | null;
  }>(
      `SELECT ev.entry_id,ev.field_id,ev.text_value,ev.number_scaled,ev.boolean_value,
            ev.date_value::text AS date_value,ev.option_id,f.number_scale
       FROM entry_values ev JOIN challenge_fields f ON f.id=ev.field_id
      WHERE ev.entry_id=ANY($1::text[])`, [entryIds]);
  for (const row of values.rows) {
    const record = byEntry.get(row.entry_id) ?? {};
    record[row.field_id] = row.text_value ??
      (row.number_scaled === null ? null : row.number_scaled / 10 ** (row.number_scale ?? 0)) ??
      row.boolean_value ?? row.date_value ?? row.option_id;
    if (row.boolean_value !== null) record[row.field_id] = row.boolean_value;
    else if (row.date_value !== null) record[row.field_id] = row.date_value;
    else if (row.option_id !== null) record[row.field_id] = row.option_id;
    byEntry.set(row.entry_id, record);
  }
  return byEntry;
}

export async function listEntries(session: SessionContext, challengeId: string) {
  return withClient(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client);
    if (!access.canManage && !access.challenge.is_participant) {
      throw new ApiError(403, "forbidden", "Você não participa deste desafio.");
    }
    const result = await client.query<{
      id: string; item_id: string | null; participant_user_id: string; display_name: string;
      username: string; occurred_on: string; submitted_at: Date; updated_at: Date;
    }>(
      `SELECT e.id,e.item_id,e.participant_user_id,u.display_name,u.username,e.occurred_on::text AS occurred_on,
              e.submitted_at,e.updated_at
         FROM entries e JOIN users u ON u.id=e.participant_user_id
        WHERE e.challenge_id=$1 AND e.deleted_at IS NULL
          AND ($2::boolean OR e.participant_user_id=$3)
        ORDER BY e.occurred_on DESC,e.created_at DESC`,
      [challengeId, access.canManage, session.user.id],
    );
    const values = await entryValues(client, result.rows.map((entry) => entry.id));
    const checkpoints = await client.query<{ id: string; day: string }>(
      `SELECT id,(starts_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day
         FROM challenge_checkpoints WHERE challenge_id=$1 AND archived_at IS NULL`,
      [challengeId],
    );
    const checkpointByDay = new Map(checkpoints.rows.map((checkpoint) => [checkpoint.day, checkpoint.id]));
    return result.rows.map((entry) => ({
      id: entry.id,
      itemId: entry.item_id ?? checkpointByDay.get(entry.occurred_on) ?? null,
      checkpointId: checkpointByDay.get(entry.occurred_on) ?? null,
      participantId: entry.participant_user_id,
      userId: entry.participant_user_id,
      participantName: entry.display_name,
      participantUsername: entry.username,
      occurredOn: entry.occurred_on,
      submittedAt: entry.submitted_at.toISOString(),
      updatedAt: entry.updated_at.toISOString(),
      values: values.get(entry.id) ?? {},
    }));
  });
}

export async function saveEntry(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (access.challenge.status !== "active") throw new ApiError(409, "challenge_not_active", "Registros só podem ser enviados durante o desafio ativo.");
    const participantId = access.canManage && typeof body.participantId === "string" ? body.participantId : session.user.id;
    const participant = await oneOrNull<{ user_id: string }>(client,
      "SELECT user_id FROM challenge_participants WHERE challenge_id=$1 AND user_id=$2 AND removed_at IS NULL",
      [challengeId, participantId]);
    if (!participant) throw new ApiError(403, "forbidden", "Usuário não participa deste desafio.");
    const entryType = typeof body.entryTypeId === "string"
      ? await oneOrNull<{ id: string; submission_mode: "item" | "daily" | "free" }>(client,
          "SELECT id,submission_mode FROM entry_types WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL",
          [body.entryTypeId, challengeId])
      : await oneOrNull<{ id: string; submission_mode: "item" | "daily" | "free" }>(client,
          "SELECT id,submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1",
          [challengeId]);
    if (!entryType) throw new ApiError(400, "invalid_entry_type", "Tipo de registro inválido.");
    let itemId: string | null = null;
    let occurredOn: string;
    if (entryType.submission_mode === "item") {
      if (typeof body.itemId !== "string") throw new ApiError(400, "missing_item", "Selecione um item.");
      const item = await oneOrNull<{ id: string }>(client,
        "SELECT id FROM challenge_items WHERE id=$1 AND challenge_id=$2 AND entry_type_id=$3 AND archived_at IS NULL",
        [body.itemId, challengeId, entryType.id]);
      if (!item) throw new ApiError(400, "invalid_item", "Item não pertence ao desafio.");
      itemId = item.id;
      occurredOn = typeof body.occurredOn === "string" ? dateString(body.occurredOn, "Data") : new Date().toISOString().slice(0, 10);
    } else if (entryType.submission_mode === "daily") {
      const requestedDay = typeof body.occurredOn === "string" ? dateString(body.occurredOn, "Data") : null;
      const requestedCheckpointId = typeof body.itemId === "string" || typeof body.checkpointId === "string"
        ? String(body.itemId ?? body.checkpointId) : null;
      const checkpoint = requestedCheckpointId
        ? await oneOrNull<{ day: string; starts_at: Date }>(client,
            `SELECT (starts_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day,starts_at
               FROM challenge_checkpoints WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL`,
            [requestedCheckpointId, challengeId])
        : requestedDay
          ? await oneOrNull<{ day: string; starts_at: Date }>(client,
              `SELECT (starts_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day,starts_at
                 FROM challenge_checkpoints
                WHERE challenge_id=$1 AND archived_at IS NULL
                  AND (starts_at AT TIME ZONE 'America/Sao_Paulo')::date=$2::date`,
              [challengeId, requestedDay])
          : await oneOrNull<{ day: string; starts_at: Date }>(client,
              `SELECT (starts_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day,starts_at
                 FROM challenge_checkpoints
                WHERE challenge_id=$1 AND archived_at IS NULL AND starts_at<=now()
                  AND (due_at IS NULL OR due_at>now()) ORDER BY starts_at DESC LIMIT 1`,
              [challengeId]);
      if (!checkpoint) throw new ApiError(400, "invalid_checkpoint", "Checkpoint diário inexistente ou indisponível.");
      if (checkpoint.starts_at.getTime() > Date.now()) {
        throw new ApiError(409, "checkpoint_scheduled", "Este checkpoint ainda não foi liberado.");
      }
      occurredOn = checkpoint.day;
      if (occurredOn < access.challenge.start_date || occurredOn > access.challenge.end_date) {
        throw new ApiError(400, "date_range", "A data está fora do período do desafio.");
      }
    } else {
      occurredOn = typeof body.occurredOn === "string" ? dateString(body.occurredOn, "Data") : new Date().toISOString().slice(0, 10);
    }
    const fields = await storageFields(client, challengeId, entryType.id);
    const existing = entryType.submission_mode === "item"
      ? await oneOrNull<{ id: string }>(client,
          "SELECT id FROM entries WHERE item_id=$1 AND participant_user_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [itemId, participantId])
      : entryType.submission_mode === "daily"
        ? await oneOrNull<{ id: string }>(client,
            `SELECT id FROM entries WHERE challenge_id=$1 AND entry_type_id=$2
              AND participant_user_id=$3 AND occurred_on=$4 AND deleted_at IS NULL FOR UPDATE`,
            [challengeId, entryType.id, participantId, occurredOn])
        : null;
    const entryId = existing?.id ?? publicId();
    if (existing) {
      await client.query(
        "UPDATE entries SET occurred_on=$2,last_edited_by_user_id=$3,updated_at=now(),submitted_at=now() WHERE id=$1",
        [entryId, occurredOn, session.user.id]);
      await client.query("DELETE FROM entry_values WHERE entry_id=$1", [entryId]);
    } else {
      await client.query(
        `INSERT INTO entries
          (id,challenge_id,entry_type_id,submission_mode,item_id,participant_user_id,occurred_on,
           submitted_at,created_by_user_id,last_edited_by_user_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$8,now(),now())`,
        [entryId, challengeId, entryType.id, entryType.submission_mode, itemId, participantId, occurredOn, session.user.id],
      );
    }
    const normalized = await writeEntryValues(client, entryId, challengeId, entryType.id, fields, body.values);
    if (access.canManage && participantId !== session.user.id) {
      await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
        existing ? "entry.corrected" : "entry.created_by_admin", "entry", entryId, null,
        { participantId, values: normalized });
    }
    return { id: entryId, itemId, participantId, occurredOn, values: normalized, updated: Boolean(existing) };
  });
}

export async function updateEntry(
  session: SessionContext,
  entryId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const entry = await oneOrNull<{
      id: string; challenge_id: string; entry_type_id: string; participant_user_id: string;
      group_id: string; status: "draft" | "active" | "closed";
    }>(client,
      `SELECT e.id,e.challenge_id,e.entry_type_id,e.participant_user_id,c.group_id,c.status
         FROM entries e JOIN challenges c ON c.id=e.challenge_id
        WHERE e.id=$1 AND e.deleted_at IS NULL FOR UPDATE`, [entryId]);
    if (!entry) throw new ApiError(404, "not_found", "Registro não encontrado.");
    const role = await requireGroupRole(session.user.id, entry.group_id, ["owner", "admin", "participant"], client);
    const canManage = role === "owner" || role === "admin";
    if (!canManage && entry.participant_user_id !== session.user.id) throw new ApiError(404, "not_found", "Registro não encontrado.");
    if (entry.status !== "active") throw new ApiError(409, "challenge_not_active", "O desafio não aceita correções agora.");
    const fields = await storageFields(client, entry.challenge_id, entry.entry_type_id);
    const before = (await entryValues(client, [entryId])).get(entryId) ?? {};
    await client.query("DELETE FROM entry_values WHERE entry_id=$1", [entryId]);
    const values = await writeEntryValues(client, entryId, entry.challenge_id, entry.entry_type_id, fields, body.values);
    await client.query("UPDATE entries SET last_edited_by_user_id=$2,updated_at=now() WHERE id=$1", [entryId, session.user.id]);
    if (canManage) await writeAudit(client, entry.group_id, entry.challenge_id, session.user.id,
      "entry.corrected", "entry", entryId, before, values);
    return { id: entryId, values };
  });
}

export async function exportEntriesCsv(session: SessionContext, challengeId: string): Promise<Response> {
  return withClient(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem exportar registros.");
    const fields = await fieldsForChallenge(client, challengeId);
    const entries = await listEntriesWithClient(client, challengeId);
    const header = ["registro_id", "participante", "usuario", "data", "item", ...fields.map((field) => String(field.label))];
    const lines = [header.map((value) => escapeCsvCell(value)).join(",")];
    for (const entry of entries) {
      const values = entry.values as Record<string, unknown>;
      const row = [entry.id, entry.participantName, entry.participantUsername, entry.occurredOn, entry.itemTitle ?? "",
        ...fields.map((field) => {
          const value = values[String(field.id)];
          return value === null || value === undefined ? "" : String(value);
        })];
      lines.push(row.map((value) => escapeCsvCell(String(value))).join(","));
    }
    return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="goa-${challengeId}.csv"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}

async function listEntriesWithClient(client: PoolClient, challengeId: string): Promise<Array<Record<string, unknown>>> {
  const result = await client.query<{
    id: string; item_id: string | null; item_title: string | null; participant_user_id: string;
    display_name: string; username: string; occurred_on: string; submitted_at: Date; updated_at: Date;
  }>(
    `SELECT e.id,e.item_id,coalesce(ci.title,cc.title) AS item_title,e.participant_user_id,u.display_name,u.username,
            e.occurred_on::text AS occurred_on,e.submitted_at,e.updated_at
       FROM entries e JOIN users u ON u.id=e.participant_user_id
       LEFT JOIN challenge_items ci ON ci.id=e.item_id
       LEFT JOIN challenge_checkpoints cc ON cc.challenge_id=e.challenge_id
        AND (cc.starts_at AT TIME ZONE 'America/Sao_Paulo')::date=e.occurred_on
        AND cc.archived_at IS NULL
      WHERE e.challenge_id=$1 AND e.deleted_at IS NULL ORDER BY e.occurred_on,e.created_at`, [challengeId]);
  const values = await entryValues(client, result.rows.map((entry) => entry.id));
  return result.rows.map((entry) => ({
    id: entry.id, itemId: entry.item_id, itemTitle: entry.item_title,
    participantId: entry.participant_user_id, participantName: entry.display_name,
    participantUsername: entry.username, occurredOn: entry.occurred_on,
    submittedAt: entry.submitted_at.toISOString(), updatedAt: entry.updated_at.toISOString(),
    values: values.get(entry.id) ?? {},
  }));
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
      id: string; title: string; description: string | null; start_date: string; end_date: string;
    }>(client,
      `SELECT id,title,description,start_date::text AS start_date,end_date::text AS end_date FROM challenges
        WHERE result_share_token_hash=$1 AND results_published_at IS NOT NULL AND status='closed'`, [hash]);
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

export async function duplicateChallenge(
  session: SessionContext,
  sourceChallengeId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const sourceAccess = await challengeAccess(session.user.id, sourceChallengeId, client, true);
    await requireGroupRole(session.user.id, sourceAccess.challenge.group_id, ["owner", "admin"], client);
    if (typeof body.targetGroupId === "string" && body.targetGroupId !== sourceAccess.challenge.group_id) {
      throw new ApiError(400, "cross_group_copy_unavailable", "No MVP, a cópia permanece no grupo original.");
    }
    const title = stringValue(body, "title", { max: 160, optional: true }) ?? `Cópia de ${sourceAccess.challenge.title}`;
    const targetId = publicId();
    await client.query(
      `INSERT INTO challenges
        (id,group_id,created_by_user_id,title,description,rules,start_date,end_date,time_zone,status,created_at,updated_at)
       SELECT $1,group_id,$2,$3,description,rules,start_date,end_date,time_zone,'draft',now(),now()
         FROM challenges WHERE id=$4`,
      [targetId, session.user.id, title, sourceChallengeId],
    );

    const typeMap = new Map<string, string>();
    const sourceTypes = await client.query<{
      id: string; semantic_key: string; name: string; description: string | null; submission_mode: string;
    }>("SELECT id,semantic_key,name,description,submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at", [sourceChallengeId]);
    for (const source of sourceTypes.rows) {
      const id = publicId();
      typeMap.set(source.id, id);
      await client.query(
        `INSERT INTO entry_types
          (id,challenge_id,semantic_key,name,description,submission_mode,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
        [id, targetId, source.semantic_key, source.name, source.description, source.submission_mode],
      );
    }

    const checkpointMap = new Map<string, string>();
    const checkpoints = await client.query<{
      id: string; semantic_key: string; title: string; description: string | null;
      position: number; starts_at: Date | null; due_at: Date | null;
    }>(
      `SELECT id,semantic_key,title,description,position,starts_at,due_at
         FROM challenge_checkpoints WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [sourceChallengeId]);
    for (const source of checkpoints.rows) {
      const id = publicId();
      checkpointMap.set(source.id, id);
      await client.query(
        `INSERT INTO challenge_checkpoints
          (id,challenge_id,semantic_key,title,description,position,starts_at,due_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())`,
        [id, targetId, source.semantic_key, source.title, source.description, source.position, source.starts_at, source.due_at],
      );
    }

    const fieldMap = new Map<string, string>();
    const sourceFields = await client.query<FieldRow>(
      `SELECT id,challenge_id,entry_type_id,semantic_key,label,help_text,kind,required,position,
              number_scale,min_scaled,max_scaled,step_scaled,max_length,settings
         FROM challenge_fields WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [sourceChallengeId]);
    for (const source of sourceFields.rows) {
      const id = publicId();
      fieldMap.set(source.id, id);
      await client.query(
        `INSERT INTO challenge_fields
          (id,challenge_id,entry_type_id,semantic_key,label,help_text,kind,required,position,
           number_scale,min_scaled,max_scaled,step_scaled,max_length,settings,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,now(),now())`,
        [id, targetId, typeMap.get(source.entry_type_id), source.semantic_key, source.label,
          source.help_text, source.kind, source.required, source.position, source.number_scale,
          source.min_scaled, source.max_scaled, source.step_scaled, source.max_length, JSON.stringify(source.settings ?? {})],
      );
      const options = await client.query<{
        semantic_key: string; label: string; position: number;
      }>("SELECT semantic_key,label,position FROM field_options WHERE field_id=$1 AND archived_at IS NULL ORDER BY position", [source.id]);
      for (const option of options.rows) {
        await client.query(
          `INSERT INTO field_options (id,field_id,semantic_key,label,position,created_at)
           VALUES ($1,$2,$3,$4,$5,now())`,
          [publicId(), id, option.semantic_key, option.label, option.position],
        );
      }
    }

    const sourceItems = await client.query<{
      checkpoint_id: string | null; entry_type_id: string; semantic_key: string; title: string;
      description: string | null; position: number; opens_at: Date | null; due_at: Date | null; metadata: unknown;
    }>(
      `SELECT checkpoint_id,entry_type_id,semantic_key,title,description,position,opens_at,due_at,metadata
         FROM challenge_items WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [sourceChallengeId]);
    for (const source of sourceItems.rows) {
      await client.query(
        `INSERT INTO challenge_items
          (id,challenge_id,checkpoint_id,entry_type_id,semantic_key,title,description,position,
           opens_at,due_at,metadata,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now(),now())`,
        [publicId(), targetId, source.checkpoint_id ? checkpointMap.get(source.checkpoint_id) : null,
          typeMap.get(source.entry_type_id), source.semantic_key, source.title, source.description,
          source.position, source.opens_at, source.due_at, JSON.stringify(source.metadata ?? {})],
      );
    }

    const metrics = await client.query<MetricRow>(
      `SELECT id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
              decimal_places,visible_during_challenge,position,settings
         FROM challenge_metrics WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [sourceChallengeId]);
    for (const source of metrics.rows) {
      await client.query(
        `INSERT INTO challenge_metrics
          (id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
           decimal_places,visible_during_challenge,position,settings,created_by_user_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,now(),now())`,
        [publicId(), targetId, typeMap.get(source.entry_type_id), source.field_id ? fieldMap.get(source.field_id) : null,
          source.semantic_key, source.label, source.operation, source.group_by, source.decimal_places,
          source.visible_during_challenge, source.position, JSON.stringify(source.settings ?? {}), session.user.id],
      );
    }

    await client.query(
      `INSERT INTO challenge_duplications
        (group_id,source_challenge_id,target_challenge_id,copied_by_user_id,created_at)
       VALUES ($1,$2,$3,$4,now())`,
      [sourceAccess.challenge.group_id, sourceChallengeId, targetId, session.user.id],
    );
    await writeAudit(client, sourceAccess.challenge.group_id, targetId, session.user.id,
      "challenge.duplicated", "challenge", targetId, null, { sourceChallengeId });
    return { id: targetId, challengeId: targetId, status: "draft" };
  });
}
