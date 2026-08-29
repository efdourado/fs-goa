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

export function defaultFields(template: unknown): ClientField[] {
  if (template === "reading") {
    return [
      { key: "livro_atual", label: "Livro atual", type: "text", required: true },
      { key: "paginas", label: "Páginas lidas hoje", type: "number", required: true, config: { min: 0, step: 1 } },
      { key: "livro_concluido", label: "Livro concluído?", type: "boolean", required: true },
      { key: "nota", label: "Nota do livro", type: "rating", required: false },
      { key: "comentario", label: "Comentário", type: "text", required: false, config: { multiline: true, maxLength: 500 } },
    ];
  }
  return [
    { key: "nota", label: "Nota", type: "rating", required: true },
    { key: "comentario", label: "Comentário", type: "text", required: false, config: { multiline: true, maxLength: 280 } },
  ];
}

function scaled(value: unknown, scale: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ApiError(400, "invalid_field_config", "Limite numérico inválido.");
  const result = Math.round(number * 10 ** scale);
  if (!Number.isSafeInteger(result)) throw new ApiError(400, "invalid_field_config", "Limite numérico fora da faixa.");
  return result;
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
  const key = semanticKey(field.key, `campo_${position + 1}`);
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
      scale, min, max, step, maxLength, JSON.stringify(clientKind === "text" ? { multiline: config.multiline === true } : {})],
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
