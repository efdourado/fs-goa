import type { PoolClient } from "pg";
import { type SessionContext, requireGroupRole } from "../../auth";
import { inTransaction, oneOrNull, withClient } from "../../db";
import {
  asRecord,
  challengeAccess,
  dateKeyInTimeZone,
  dateString,
  publicId,
} from "../../goa-domain";
import { ApiError } from "../../http";
import {
  type FieldDefinition,
  validateFieldValue,
} from "../../validation";
import {
  cardinalityOf,
  entryTypeById,
  primaryEntryType,
  purposeOf,
  schedulePolicyOf,
  targetPolicyOf,
} from "./entry-types";
import type { FieldRow } from "./types";
import { moveToTrash } from "../trash";

interface StorageField extends FieldRow {
  option_ids: string[];
}

interface EntryValueInsert {
  field_id: string;
  text_value: string | null;
  number_scaled: number | null;
  boolean_value: boolean | null;
  date_value: string | null;
  option_id: string | null;
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

/**
 * Writes an entry's field values as an upsert, one row per field, instead of
 * wiping the entry's `entry_values` and reinserting them from scratch. A
 * curated Vitrine comment is a `result_blocks` row that references a specific
 * (entry, field) pair with `ON DELETE RESTRICT` — deleting-then-recreating
 * that row on every save (even to edit an unrelated field, like the rating)
 * used to hit that restriction and fail the whole save with a raw constraint
 * violation. Upserting keeps an edited field's row (and its identity) intact;
 * only a field that genuinely drops out of this submission — cleared, or its
 * definition archived — has its row removed, and only after any Vitrine
 * reference to it is cleared first, so that removal itself never 23503s.
 */
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
  const inserts: EntryValueInsert[] = [];
  const presentFieldIds: string[] = [];
  for (const field of fields) {
    const candidate = Object.hasOwn(values, field.id) ? values[field.id] : values[field.semantic_key];
    const validation = validateFieldValue(fieldDefinition(field), candidate);
    if (!validation.ok) {
      throw new ApiError(400, "invalid_entry_value", `${field.label}: ${validation.message}`, { fieldId: field.id, code: validation.code });
    }
    if (validation.value === null) continue;
    presentFieldIds.push(field.id);
    const columns: [string | null, number | null, boolean | null, string | null, string | null] = [null, null, null, null, null];
    if (field.kind === "text") columns[0] = validation.value as string;
    else if (field.kind === "number" || field.kind === "rating") {
      columns[1] = Math.round((validation.value as number) * 10 ** (field.number_scale ?? 0));
    } else if (field.kind === "boolean") columns[2] = validation.value as boolean;
    else if (field.kind === "date") columns[3] = validation.value as string;
    else if (field.kind === "choice") columns[4] = validation.value as string;
    inserts.push({
      field_id: field.id,
      text_value: columns[0],
      number_scaled: columns[1],
      boolean_value: columns[2],
      date_value: columns[3],
      option_id: columns[4],
    });
    normalized[field.id] = validation.value;
  }

  // A field this submission no longer answers (blanked to null, or archived
  // out of `fields` since the last save) loses its row. Its Vitrine reference,
  // if any, is removed first — a comment being genuinely dropped means its
  // curated card goes with it, rather than blocking the whole save.
  const stale = await client.query<{ field_id: string }>(
    "SELECT field_id FROM entry_values WHERE entry_id=$1 AND field_id <> ALL($2::text[])",
    [entryId, presentFieldIds],
  );
  if (stale.rows.length) {
    const staleFieldIds = stale.rows.map((row) => row.field_id);
    await client.query(
      "DELETE FROM result_blocks WHERE source_entry_id=$1 AND challenge_id=$2 AND source_field_id=ANY($3::text[])",
      [entryId, challengeId, staleFieldIds],
    );
    await client.query(
      "DELETE FROM entry_values WHERE entry_id=$1 AND field_id=ANY($2::text[])",
      [entryId, staleFieldIds],
    );
  }

  if (inserts.length) {
    await client.query(
      `INSERT INTO entry_values
        (entry_id,challenge_id,entry_type_id,field_id,text_value,number_scaled,boolean_value,date_value,option_id,created_at,updated_at)
       SELECT $1,$2,$3,value.field_id,value.text_value,value.number_scaled,value.boolean_value,
              value.date_value,value.option_id,now(),now()
         FROM jsonb_to_recordset($4::jsonb) AS value(
           field_id text,text_value text,number_scaled bigint,boolean_value boolean,
           date_value date,option_id text
         )
       ON CONFLICT (entry_id, field_id) DO UPDATE SET
         text_value = EXCLUDED.text_value,
         number_scaled = EXCLUDED.number_scaled,
         boolean_value = EXCLUDED.boolean_value,
         date_value = EXCLUDED.date_value,
         option_id = EXCLUDED.option_id,
         updated_at = now()`,
      [entryId, challengeId, entryTypeId, JSON.stringify(inserts)],
    );
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
    const closed = access.challenge.status === "closed";
    const result = await client.query<{
      id: string; item_id: string | null; checkpoint_id: string | null; entry_type_id: string;
      participant_user_id: string | null; display_name: string | null; visibility_policy: string;
      answer_scope: "individual" | "shared";
      username: string | null; occurred_on: string | null; submitted_at: Date; updated_at: Date;
    }>(
      `SELECT e.id,e.item_id,e.checkpoint_id,e.entry_type_id,e.participant_user_id,u.display_name,u.username,
              e.answer_scope,
              coalesce(et.visibility_policy, 'group_realtime') AS visibility_policy,
              e.occurred_on::text AS occurred_on,e.submitted_at,e.updated_at
         FROM entries e
         LEFT JOIN users u ON u.id=e.participant_user_id
         LEFT JOIN entry_types et ON et.id = e.entry_type_id
        WHERE e.challenge_id=$1 AND e.deleted_at IS NULL
        ORDER BY e.occurred_on DESC NULLS LAST,e.created_at DESC`,
      [challengeId],
    );

    // Per-type visibility. Admins and the author always see everything; the
    // rest is gated by the entry type's policy.
    //   after_own — needs an entry of the same (item, type) from the viewer
    //   after_close — hidden until the round closes
    //   author_only — never surfaced here (aggregate metrics aside)
    // A shared answer has no single author to gate by — it's the group's, so
    // it's always visible to every participant regardless of policy.
    const ownItemType = new Set(
      result.rows
        .filter((entry) => entry.participant_user_id === session.user.id)
        .map((entry) => `${entry.entry_type_id}:${entry.item_id ?? entry.checkpoint_id ?? "-"}`),
    );
    const visibleRows = result.rows.filter((entry) => {
      if (access.canManage || entry.participant_user_id === session.user.id || entry.answer_scope === "shared") return true;
      switch (entry.visibility_policy) {
        case "author_only": return false;
        case "after_close": return closed;
        case "after_own": return ownItemType.has(`${entry.entry_type_id}:${entry.item_id ?? entry.checkpoint_id ?? "-"}`);
        default: return true;
      }
    });

    const values = await entryValues(client, visibleRows.map((entry) => entry.id));
    const checkpoints = await client.query<{ id: string; day: string }>(
      `SELECT id,(starts_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day
         FROM challenge_checkpoints WHERE challenge_id=$1 AND archived_at IS NULL`,
      [challengeId],
    );
    const checkpointByDay = new Map(checkpoints.rows.map((checkpoint) => [checkpoint.day, checkpoint.id]));
    return visibleRows.map((entry) => ({
      id: entry.id,
      // Item and checkpoint are independent axes — keep them distinct. The
      // checkpoint still falls back to the entry's day for pre-orthogonal rows.
      itemId: entry.item_id ?? null,
      checkpointId: entry.checkpoint_id ?? checkpointByDay.get(entry.occurred_on ?? "") ?? null,
      entryTypeId: entry.entry_type_id,
      answerScope: entry.answer_scope,
      // Null for a shared answer — it belongs to the item, not a person.
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
    const participantId = session.user.id;
    const participant = await oneOrNull<{ user_id: string }>(client,
      "SELECT user_id FROM challenge_participants WHERE challenge_id=$1 AND user_id=$2 AND removed_at IS NULL",
      [challengeId, participantId]);
    if (!participant) throw new ApiError(403, "forbidden", "Usuário não participa deste desafio.");
    const entryType = typeof body.entryTypeId === "string"
      ? await entryTypeById(client, challengeId, body.entryTypeId)
      : await primaryEntryType(client, challengeId);
    if (!entryType) throw new ApiError(400, "invalid_entry_type", "Tipo de registro inválido.");
    const challengeHasPeriod =
      access.challenge.start_date !== null && access.challenge.end_date !== null;
    const targetPolicy = targetPolicyOf(entryType);
    const cardinality = cardinalityOf(entryType);
    const schedulePolicy = schedulePolicyOf(entryType, challengeHasPeriod);
    // A recipe can ask for checkpoints, but an undated round has none — those
    // entries just carry a free date, like Cine Livre.
    const effectiveSchedule =
      schedulePolicy === "checkpoint" && !challengeHasPeriod ? "while_active" : schedulePolicy;

    let itemId: string | null = null;
    let checkpointId: string | null = null;
    let occurredOn: string | null;
    const today = dateKeyInTimeZone(new Date(), access.challenge.time_zone);
    // Day-keyed entries always need a date; a plain round entry may go without one.
    const dateOptional = cardinality !== "once_per_day" && cardinality !== "once_per_item_day";

    // Target axis — which round item the entry points at. Fully independent of the
    // schedule axis below: a session-bound cine round is "filme X na sessão Y", so
    // one entry can carry both `item_id` and `checkpoint_id`.
    if (targetPolicy !== "none") {
      const requestedItemId =
        typeof body.itemId === "string" && body.itemId ? body.itemId : null;
      if (targetPolicy === "required" && !requestedItemId) {
        throw new ApiError(400, "missing_item", "Selecione um item.");
      }
      if (requestedItemId) {
        const item = await oneOrNull<{ id: string }>(client,
          "SELECT id FROM challenge_items WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL",
          [requestedItemId, challengeId]);
        if (!item) throw new ApiError(400, "invalid_item", "Item não pertence ao desafio.");
        itemId = item.id;
      }
    }

    // Schedule axis — a free/period date, or a dated checkpoint (session).
    if (effectiveSchedule !== "checkpoint") {
      occurredOn = dateOptional && (body.occurredOn === null || body.occurredOn === "")
        ? null
        : typeof body.occurredOn === "string" && body.occurredOn
          ? dateString(body.occurredOn, "Data")
          : today;
      if (occurredOn !== null && occurredOn > today) {
        throw itemId
          ? new ApiError(409, "watch_in_future", "A data assistida pode ser hoje ou uma data passada.")
          : new ApiError(409, "checkin_in_future", "O check-in pode ser de hoje ou de uma data passada.");
      }
    } else {
      const requestedDay = typeof body.occurredOn === "string" ? dateString(body.occurredOn, "Data") : null;
      // Only a type with no round item overloads `body.itemId` as the checkpoint
      // id — that is how the pre-orthogonal clients addressed a daily round. When
      // the type also targets an item, the session comes from `body.checkpointId`.
      const requestedCheckpointId =
        typeof body.checkpointId === "string" && body.checkpointId
          ? body.checkpointId
          : targetPolicy === "none" && typeof body.itemId === "string" && body.itemId
            ? body.itemId
            : null;
      const checkpoint = requestedCheckpointId
        ? await oneOrNull<{ id: string; day: string; starts_at: Date }>(client,
            `SELECT id,(starts_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day,starts_at
               FROM challenge_checkpoints WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL`,
            [requestedCheckpointId, challengeId])
        : requestedDay
          ? await oneOrNull<{ id: string; day: string; starts_at: Date }>(client,
              `SELECT id,(starts_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day,starts_at
                 FROM challenge_checkpoints
                WHERE challenge_id=$1 AND archived_at IS NULL
                  AND (starts_at AT TIME ZONE 'America/Sao_Paulo')::date=$2::date`,
              [challengeId, requestedDay])
          : await oneOrNull<{ id: string; day: string; starts_at: Date }>(client,
              `SELECT id,(starts_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day,starts_at
                 FROM challenge_checkpoints
                WHERE challenge_id=$1 AND archived_at IS NULL AND starts_at<=now()
                  AND (due_at IS NULL OR due_at>now()) ORDER BY starts_at DESC LIMIT 1`,
              [challengeId]);
      if (!checkpoint) throw new ApiError(400, "invalid_checkpoint", "Checkpoint diário inexistente ou indisponível.");
      if (checkpoint.starts_at.getTime() > Date.now()) {
        throw new ApiError(409, "checkpoint_scheduled", "Este checkpoint ainda não foi liberado.");
      }
      occurredOn = checkpoint.day;
      checkpointId = checkpoint.id;
      if (occurredOn < access.challenge.start_date! || occurredOn > access.challenge.end_date!) {
        throw new ApiError(400, "date_range", "A data está fora do período do desafio.");
      }
    }

    // Expectation is a pre-watch note; once the film is rated it stops moving.
    if (purposeOf(entryType) === "expectation" && itemId) {
      const rated = await oneOrNull<{ id: string }>(client,
        `SELECT e.id FROM entries e JOIN entry_types t ON t.id = e.entry_type_id
          WHERE e.item_id=$1 AND e.participant_user_id=$2 AND e.deleted_at IS NULL
            AND t.purpose = 'rating' LIMIT 1`,
        [itemId, participantId]);
      if (rated) {
        throw new ApiError(409, "expectation_locked", "A expectativa trava depois que você avalia o filme.");
      }
    }

    const fields = await storageFields(client, challengeId, entryType.id);
    const answerScope = entryType.answer_scope;
    // Shared: one row per (item, type) — no participant — with its own
    // permission and concurrency rules (Phase 4). Individual: unchanged.
    const existing = answerScope === "shared"
      ? await oneOrNull<{ id: string; updated_at: Date }>(client,
          `SELECT id, updated_at FROM entries
            WHERE item_id=$1 AND entry_type_id=$2 AND answer_scope='shared' AND deleted_at IS NULL FOR UPDATE`,
          [itemId, entryType.id])
      : cardinality === "once_per_item" && itemId
        ? await oneOrNull<{ id: string; updated_at: Date }>(client,
            "SELECT id, updated_at FROM entries WHERE item_id=$1 AND entry_type_id=$2 AND participant_user_id=$3 AND deleted_at IS NULL FOR UPDATE",
            [itemId, entryType.id, participantId])
        : cardinality === "once_per_item_day" && itemId
          ? await oneOrNull<{ id: string; updated_at: Date }>(client,
              `SELECT id, updated_at FROM entries WHERE item_id=$1 AND entry_type_id=$2
                AND participant_user_id=$3 AND occurred_on=$4 AND deleted_at IS NULL FOR UPDATE`,
              [itemId, entryType.id, participantId, occurredOn])
          : cardinality === "once_per_day"
            ? await oneOrNull<{ id: string; updated_at: Date }>(client,
                `SELECT id, updated_at FROM entries WHERE challenge_id=$1 AND entry_type_id=$2
                  AND participant_user_id=$3 AND occurred_on=$4 AND deleted_at IS NULL FOR UPDATE`,
                [challengeId, entryType.id, participantId, occurredOn])
            : null;

    if (answerScope === "shared" && existing) {
      if (entryType.shared_edit_policy === "members_fill_admin_corrects" && !access.canManage) {
        throw new ApiError(403, "shared_locked", "Essa resposta já foi preenchida — só um administrador pode corrigi-la.");
      }
      if (typeof body.expectedUpdatedAt === "string") {
        const expected = new Date(body.expectedUpdatedAt).getTime();
        if (Number.isNaN(expected) || expected !== existing.updated_at.getTime()) {
          throw new ApiError(
            409, "conflict",
            "Alguém já mudou essa resposta compartilhada. Veja o valor atual antes de salvar de novo.",
            { currentUpdatedAt: existing.updated_at.toISOString() },
          );
        }
      }
    }

    const entryId = existing?.id ?? publicId();
    if (existing) {
      await client.query(
        "UPDATE entries SET occurred_on=$2,item_id=$3,checkpoint_id=$4,last_edited_by_user_id=$5,updated_at=now(),submitted_at=now() WHERE id=$1",
        [entryId, occurredOn, itemId, checkpointId, session.user.id]);
    } else {
      await client.query(
        `INSERT INTO entries
          (id,challenge_id,entry_type_id,submission_mode,cardinality,item_id,checkpoint_id,participant_user_id,answer_scope,occurred_on,
           submitted_at,created_by_user_id,last_edited_by_user_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,$11,now(),now())`,
        [entryId, challengeId, entryType.id, entryType.submission_mode, cardinality, itemId, checkpointId,
          answerScope === "shared" ? null : participantId, answerScope, occurredOn, session.user.id],
      );
    }
    const normalized = await writeEntryValues(client, entryId, challengeId, entryType.id, fields, body.values);
    return {
      id: entryId, itemId, checkpointId, participantId, occurredOn, values: normalized,
      updated: Boolean(existing), answerScope,
    };
  });
}

export async function updateEntry(
  session: SessionContext,
  entryId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const entry = await oneOrNull<{
      id: string; challenge_id: string; entry_type_id: string; participant_user_id: string | null;
      item_id: string | null; purpose: string | null; answer_scope: "individual" | "shared";
      shared_edit_policy: "members_fill_admin_corrects" | "members_can_edit" | null;
      updated_at: Date; group_id: string; status: "draft" | "active" | "closed";
    }>(client,
      `SELECT e.id,e.challenge_id,e.entry_type_id,e.participant_user_id,e.item_id,t.purpose,
              e.answer_scope,t.shared_edit_policy,e.updated_at,c.group_id,c.status
         FROM entries e JOIN challenges c ON c.id=e.challenge_id
         JOIN entry_types t ON t.id=e.entry_type_id
        WHERE e.id=$1 AND e.deleted_at IS NULL AND c.deleted_at IS NULL FOR UPDATE`, [entryId]);
    if (!entry) throw new ApiError(404, "not_found", "Registro não encontrado.");
    const role = await requireGroupRole(session.user.id, entry.group_id, ["owner", "admin", "participant"], client);
    const canManage = role === "owner" || role === "admin";
    if (entry.answer_scope === "shared") {
      // Members_fill_admin_corrects: once filled, only an admin may change it.
      // Members_can_edit: any eligible member may — same participant check as
      // below, just without the "only the original author" restriction.
      if (entry.shared_edit_policy === "members_fill_admin_corrects" && !canManage) {
        throw new ApiError(403, "shared_locked", "Essa resposta já foi preenchida — só um administrador pode corrigi-la.");
      }
      if (!canManage) {
        const participant = await oneOrNull<{ user_id: string }>(client,
          "SELECT user_id FROM challenge_participants WHERE challenge_id=$1 AND user_id=$2 AND removed_at IS NULL",
          [entry.challenge_id, session.user.id]);
        if (!participant) throw new ApiError(404, "not_found", "Registro não encontrado.");
      }
      if (typeof body.expectedUpdatedAt === "string") {
        const expected = new Date(body.expectedUpdatedAt).getTime();
        if (Number.isNaN(expected) || expected !== entry.updated_at.getTime()) {
          throw new ApiError(
            409, "conflict",
            "Alguém já mudou essa resposta compartilhada. Veja o valor atual antes de salvar de novo.",
            { currentUpdatedAt: entry.updated_at.toISOString() },
          );
        }
      }
    } else {
      // Individual: only the author may edit their own entry — no admin correction path.
      if (entry.participant_user_id !== session.user.id) throw new ApiError(404, "not_found", "Registro não encontrado.");
    }
    if (entry.status !== "active") throw new ApiError(409, "challenge_not_active", "O desafio não aceita correções agora.");
    if (entry.purpose === "expectation" && entry.item_id && entry.participant_user_id) {
      const rated = await oneOrNull<{ id: string }>(client,
        `SELECT e.id FROM entries e JOIN entry_types t ON t.id = e.entry_type_id
          WHERE e.item_id=$1 AND e.participant_user_id=$2 AND e.deleted_at IS NULL
            AND t.purpose = 'rating' LIMIT 1`,
        [entry.item_id, entry.participant_user_id]);
      if (rated) {
        throw new ApiError(409, "expectation_locked", "A expectativa trava depois que você avalia o filme.");
      }
    }
    const fields = await storageFields(client, entry.challenge_id, entry.entry_type_id);
    const values = await writeEntryValues(client, entryId, entry.challenge_id, entry.entry_type_id, fields, body.values);
    await client.query("UPDATE entries SET last_edited_by_user_id=$2,updated_at=now() WHERE id=$1", [entryId, session.user.id]);
    return { id: entryId, values };
  });
}

export async function deleteEntry(
  session: SessionContext,
  entryId: string,
) {
  return inTransaction(async (client) => {
    const entry = await oneOrNull<{
      id: string; challenge_id: string; participant_user_id: string | null;
      answer_scope: "individual" | "shared";
      shared_edit_policy: "members_fill_admin_corrects" | "members_can_edit" | null;
      group_id: string; status: "draft" | "active" | "closed";
    }>(client,
      `SELECT e.id,e.challenge_id,e.participant_user_id,e.answer_scope,t.shared_edit_policy,c.group_id,c.status
         FROM entries e JOIN challenges c ON c.id=e.challenge_id
         JOIN entry_types t ON t.id=e.entry_type_id
        WHERE e.id=$1 AND e.deleted_at IS NULL AND c.deleted_at IS NULL FOR UPDATE`, [entryId]);
    if (!entry) throw new ApiError(404, "not_found", "Registro não encontrado.");
    const role = await requireGroupRole(session.user.id, entry.group_id, ["owner", "admin", "participant"], client);
    const canManage = role === "owner" || role === "admin";
    if (entry.answer_scope === "shared") {
      if (entry.shared_edit_policy === "members_fill_admin_corrects" && !canManage) {
        throw new ApiError(403, "shared_locked", "Essa resposta compartilhada só pode ser apagada por um administrador.");
      }
      if (!canManage) {
        const participant = await oneOrNull<{ user_id: string }>(client,
          "SELECT user_id FROM challenge_participants WHERE challenge_id=$1 AND user_id=$2 AND removed_at IS NULL",
          [entry.challenge_id, session.user.id]);
        if (!participant) throw new ApiError(404, "not_found", "Registro não encontrado.");
      }
    } else {
      // Individual: only the author may delete their own entry — no admin correction path.
      if (entry.participant_user_id !== session.user.id) throw new ApiError(404, "not_found", "Registro não encontrado.");
    }
    if (entry.status !== "active") {
      throw new ApiError(409, "challenge_not_active", "Registros só podem ser excluídos com o desafio ativo.");
    }
    // Moves the entry to the bin: `deleted_at` (so it leaves listings, metrics
    // and the showcase, and frees the partial unique indexes) plus the explicit
    // `trash_items` row. The participant restores it from the challenge screen.
    await moveToTrash(client, "entry", entryId, session.user.id, { skipMarker: false, reason: null });
    return { id: entryId, deleted: true };
  });
}

