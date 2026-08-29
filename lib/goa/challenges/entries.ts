import type { PoolClient } from "pg";
import { type SessionContext, requireGroupRole } from "../../auth";
import { inTransaction, oneOrNull, withClient } from "../../db";
import {
  asRecord,
  challengeAccess,
  dateString,
  publicId,
  writeAudit,
} from "../../goa-domain";
import { ApiError } from "../../http";
import {
  escapeCsvCell,
  type FieldDefinition,
  validateFieldValue,
} from "../../validation";
import { fieldsForChallenge } from "./fields";
import type { FieldRow } from "./types";

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
        WHERE e.id=$1 AND e.deleted_at IS NULL AND c.deleted_at IS NULL FOR UPDATE`, [entryId]);
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
