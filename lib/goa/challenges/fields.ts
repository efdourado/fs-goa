import type { PoolClient } from "pg";
import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import {
  asRecord,
  challengeAccess,
  insertField,
  integerValue,
  publicId,
  semanticKey,
  writeAudit,
} from "../../goa-domain";
import { ApiError } from "../../http";
import { entryTypeById, primaryEntryType } from "./entry-types";
import type { FieldRow } from "./types";

/**
 * Which entry type a fields edit targets. The admin's Fields tab passes an
 * explicit `entryTypeId` for multi-type recipes (Cine Curadoria); everything else
 * falls back to the primary type.
 */
async function targetEntryType(
  client: PoolClient,
  challengeId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  if (typeof body.entryTypeId === "string" && body.entryTypeId) {
    const type = await entryTypeById(client, challengeId, body.entryTypeId);
    if (!type) throw new ApiError(400, "invalid_entry_type", "Tipo de registro inválido.");
    return type;
  }
  const primary = await primaryEntryType(client, challengeId);
  if (!primary) throw new ApiError(409, "missing_entry_type", "O desafio não possui tipo de registro.");
  return primary;
}

function unscale(value: number | null, scale: number | null): number | undefined {
  return value === null || scale === null ? undefined : value / 10 ** scale;
}

/**
 * A `(challenge_id, semantic_key)` unique index covers archived rows too, so a
 * field created after activation can collide with one that was removed earlier
 * in the draft. Resolve the clash here instead of letting Postgres 500.
 */
async function uniqueFieldKey(
  client: PoolClient,
  challengeId: string,
  desired: unknown,
  position: number,
): Promise<string> {
  const base = semanticKey(desired, `campo_${position + 1}`);
  const taken = new Set(
    (
      await client.query<{ semantic_key: string }>(
        "SELECT semantic_key FROM challenge_fields WHERE challenge_id=$1",
        [challengeId],
      )
    ).rows.map((row) => row.semantic_key),
  );
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}_${suffix}`.slice(0, 64);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${publicId().slice(0, 8)}`.slice(0, 64);
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

export async function fieldsForChallenge(
  client: PoolClient,
  challengeId: string,
): Promise<Array<Record<string, unknown>>> {
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

export async function addChallengeField(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem criar campos.");
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_locked", "Campos não podem ser criados depois do encerramento.");
    const entryType = await targetEntryType(client, challengeId, body);
    const positionRow = await oneOrNull<{ position: number }>(client,
      "SELECT coalesce(max(position),-1)::int + 1 AS position FROM challenge_fields WHERE challenge_id=$1", [challengeId]);
    const position = positionRow?.position ?? 0;
    const key = await uniqueFieldKey(client, challengeId, body.key ?? body.label, position);
    const inserted = await insertField(client, challengeId, entryType.id, { ...body, key }, position);
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
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_locked", "Campos não podem ser editados depois do encerramento.");
    const entryType = await targetEntryType(client, challengeId, body);
    const keptIds: string[] = [];
    for (let position = 0; position < requestedFields.length; position += 1) {
      const field = asRecord(requestedFields[position]);
      if (typeof field.id !== "string") {
        const key = await uniqueFieldKey(client, challengeId, field.key ?? field.label, position);
        const inserted = await insertField(client, challengeId, entryType.id, { ...field, key }, position);
        keptIds.push(inserted.id);
        continue;
      }
      const current = await oneOrNull<{
        id: string; kind: string; number_scale: number | null; min_scaled: number | null;
        max_scaled: number | null; step_scaled: number | null; max_length: number | null;
        settings: Record<string, unknown>;
      }>(client,
        `SELECT id,kind,number_scale,min_scaled,max_scaled,step_scaled,max_length,settings
           FROM challenge_fields WHERE id=$1 AND challenge_id=$2 AND entry_type_id=$3`,
        [field.id, challengeId, entryType.id]);
      if (!current) throw new ApiError(400, "invalid_field", "Campo não pertence a este tipo de registro.");
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
      if (access.challenge.status !== "draft") {
        const withData = await client.query<{ label: string }>(
          `SELECT f.label FROM challenge_fields f
            WHERE f.challenge_id=$1 AND f.entry_type_id=$2 AND f.archived_at IS NULL
              AND NOT (f.id=ANY($3::text[]))
              AND EXISTS (SELECT 1 FROM entry_values ev WHERE ev.field_id=f.id)`,
          [challengeId, entryType.id, keptIds],
        );
        if (withData.rows.length) {
          throw new ApiError(
            409,
            "field_has_data",
            `Estes campos já têm respostas e não podem ser removidos: ${withData.rows.map((row) => row.label).join(", ")}. Registros históricos ficam intactos.`,
          );
        }
      }
      await client.query(
        `UPDATE challenge_fields SET archived_at=now(),updated_at=now()
          WHERE challenge_id=$1 AND entry_type_id=$2 AND archived_at IS NULL AND NOT (id=ANY($3::text[]))`,
        [challengeId, entryType.id, keptIds],
      );
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "fields.updated", "challenge", challengeId, null, { fieldIds: keptIds });
    return { fieldIds: keptIds };
  });
}
