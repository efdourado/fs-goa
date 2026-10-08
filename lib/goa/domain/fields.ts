import type { PoolClient } from "pg";
import { ApiError } from "../../http";
import { asRecord, integerValue, publicId, semanticKey } from "./shared";

const FIELD_KINDS = new Set(["text", "number", "rating", "choice", "boolean", "date"]);

export interface ClientField {
  key?: unknown;
  label?: unknown;
  type?: unknown;
  required?: unknown;
  position?: unknown;
  config?: unknown;
}

function scaled(value: unknown, scale: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ApiError(400, "invalid_field_config", "Limite numérico inválido.");
  const result = Math.round(number * 10 ** scale);
  if (!Number.isSafeInteger(result)) throw new ApiError(400, "invalid_field_config", "Limite numérico fora da faixa.");
  return result;
}

/** A number field's unit ("kg", "km", "min") — short free text, blank for none. */
export function fieldUnit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const unit = value.trim();
  if (!unit) return null;
  if (Array.from(unit).length > 12) throw new ApiError(400, "invalid_field_config", "A unidade tem no máximo 12 caracteres.");
  return unit;
}

/**
 * "Contagem": a number field counted along a road to a goal (pages of a book, steps, km).
 * `goal` is where the road ends — the item's page count, a fixed number, or none; `entry` is how it's typed
 * (the amount done, or where you are now); `showDates` false keeps the days out of sight (still saved).
 */
export interface FieldCount {
  goal: { from: "page_count" } | { value: number } | null;
  entry: "amount" | "position";
  showDates: boolean;
}

/** Checks a number field's count settings; `null` when it isn't counted. */
export function fieldCount(value: unknown): FieldCount | null {
  if (value === undefined || value === null || value === false) return null;
  const raw = asRecord(value);
  const goalRaw = raw.goal === null || raw.goal === undefined ? null : asRecord(raw.goal);
  let goal: FieldCount["goal"] = null;
  if (goalRaw?.from === "page_count") goal = { from: "page_count" };
  else if (goalRaw && goalRaw.value !== undefined) {
    const target = Number(goalRaw.value);
    if (!Number.isFinite(target) || target <= 0 || target > 1e9) throw new ApiError(400, "invalid_field_config", "A meta precisa ser um número positivo.");
    goal = { value: target };
  } else if (goalRaw) throw new ApiError(400, "invalid_field_config", "Meta da contagem inválida.");
  return { goal, entry: raw.entry === "position" ? "position" : "amount", showDates: raw.showDates !== false };
}

/** A number field's stored settings: its unit and, when it's counted, the count. */
function numberSettings(config: Record<string, unknown>): Record<string, unknown> {
  const unit = fieldUnit(config.unit);
  const count = fieldCount(config.count);
  return { ...(unit ? { unit } : {}), ...(count ? { count } : {}) };
}

export async function insertField(
  client: PoolClient,
  challengeId: string,
  entryTypeId: string,
  field: ClientField,
  position: number,
): Promise<{ id: string; kind: string; semanticKey: string }> {
  const label = typeof field.label === "string" ? field.label.trim() : "";
  if (!label || Array.from(label).length > 120) throw new ApiError(400, "invalid_field", "Campo sem rótulo válido.");
  const clientKind = field.type === "select" ? "choice" : field.type;
  if (typeof clientKind !== "string" || !FIELD_KINDS.has(clientKind)) {
    throw new ApiError(400, "invalid_field", "Tipo de campo não suportado.");
  }
  const config = asRecord(field.config);
  const scale = clientKind === "rating" ? 1 : clientKind === "number" ? 3 : null;
  const id = publicId();
  // `(challenge_id, semantic_key)` is unique across archived fields too, so a
  // field re-added after one with the same name was removed needs a fresh key
  // instead of failing on the constraint.
  const base = semanticKey(field.key, `campo_${position + 1}`);
  const taken = new Set(
    (await client.query<{ semantic_key: string }>(
      "SELECT semantic_key FROM challenge_fields WHERE challenge_id = $1", [challengeId],
    )).rows.map((row) => row.semantic_key),
  );
  let key = base;
  for (let suffix = 2; taken.has(key); suffix += 1) key = `${base}_${suffix}`.slice(0, 64);
  const min = clientKind === "rating" ? 0 : scale === null ? null : scaled(config.min, scale);
  const max = clientKind === "rating" ? 50 : scale === null ? null : scaled(config.max, scale);
  const step = clientKind === "rating" ? 5 : scale === null ? null : scaled(config.step, scale);
  const maxLength = clientKind === "text" ? integerValue(config.maxLength, 5_000, 1, 20_000) : null;
  await client.query(
    `INSERT INTO challenge_fields
      (id, challenge_id, entry_type_id, semantic_key, label, kind, required, position,
       number_scale, min_scaled, max_scaled, step_scaled, max_length, settings, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now(),now())`,
    [id, challengeId, entryTypeId, key, label, clientKind, field.required === true, position,
      scale, min, max, step, maxLength, JSON.stringify(
        clientKind === "text" ? { multiline: config.multiline === true }
          : clientKind === "number" ? numberSettings(config)
            // A rating counts toward the ranking only when asked to (a recipe's own ratings are; see createChallenge).
            : clientKind === "rating" ? { inRanking: config.inRanking === true }
              : {},
      )],
  );
  if (clientKind === "choice") {
    const options = Array.isArray(config.options) ? config.options : [];
    if (!options.length) throw new ApiError(400, "invalid_field", "Campos de opção precisam de alternativas.");
    for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      const option = asRecord(options[optionIndex]);
      const optionLabel = typeof option.label === "string" ? option.label.trim() : "";
      if (!optionLabel) throw new ApiError(400, "invalid_field", "Opção sem rótulo.");
      await client.query(
        `INSERT INTO field_options (id, field_id, semantic_key, label, position, created_at)
         VALUES ($1,$2,$3,$4,$5,now())`,
        [publicId(), id, semanticKey(option.value ?? option.label, `opcao_${optionIndex + 1}`), optionLabel, optionIndex],
      );
    }
  }
  return { id, kind: clientKind, semanticKey: key };
}
