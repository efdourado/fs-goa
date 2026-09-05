import type { SessionContext } from "../../auth";
import { withClient } from "../../db";
import { challengeAccess } from "../../goa-domain";
import { ApiError } from "../../http";
import { normalizeTitle } from "../catalog";
import { entryTypesForChallenge, recipeCatalogKind, usesRoundItems } from "./entry-types";

/** The item fields a pasted JSON row is allowed to fill. Everything else is "unknown". */
export type MappableField =
  | "title"
  | "year"
  | "author"
  | "pageCount"
  | "runtimeMinutes"
  | "mainGenre"
  | "recommendedBy"
  | "origin";

const FIELD_ALIASES: Record<MappableField, string[]> = {
  title: ["title", "name", "titulo", "título"],
  year: ["year", "ano", "release_year", "releaseYear"],
  author: ["author", "authors", "autor", "by", "writer"],
  pageCount: ["pageCount", "page_count", "pages", "paginas", "páginas"],
  runtimeMinutes: ["runtimeMinutes", "runtime_minutes", "runtime", "duration", "durationMinutes", "duracao", "duração"],
  mainGenre: ["mainGenre", "main_genre", "genre", "genres", "genero", "gênero"],
  recommendedBy: ["recommendedBy", "recommended_by", "indicadoPor", "indicado_por", "suggestion", "pick"],
  origin: ["origin", "source", "origem", "fonte", "list", "lista"],
};

const KNOWN_KEYS = new Set(Object.values(FIELD_ALIASES).flat().map((key) => key.toLowerCase()));

export const LIST_IMPORT_LIMIT = 200;

function firstString(value: unknown): string {
  if (Array.isArray(value)) {
    const found = value.find((entry): entry is string => typeof entry === "string");
    return found ? found.trim() : "";
  }
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function joinStrings(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).join(", ");
  }
  return firstString(value);
}

function intOrNull(value: unknown, min: number, max: number): number | null {
  const number = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : NaN;
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

interface RowExtraction {
  index: number;
  title: string;
  author: string | null;
  year: number | null;
  pageCount: number | null;
  runtimeMinutes: number | null;
  mainGenre: string | null;
  recommendedByRaw: string | null;
  originNote: string | null;
  unknownKeys: string[];
  errors: string[];
}

function keyForField(
  raw: Record<string, unknown>,
  field: MappableField,
  mapping: Record<string, MappableField>,
): unknown {
  // An explicit mapping (unknown JSON key → known field) wins.
  for (const [jsonKey, target] of Object.entries(mapping)) {
    if (target === field && raw[jsonKey] !== undefined) return raw[jsonKey];
  }
  for (const alias of FIELD_ALIASES[field]) {
    for (const jsonKey of Object.keys(raw)) {
      if (jsonKey.toLowerCase() === alias.toLowerCase() && raw[jsonKey] !== undefined && raw[jsonKey] !== null) {
        return raw[jsonKey];
      }
    }
  }
  return undefined;
}

function extractRow(
  raw: unknown,
  index: number,
  kind: "film" | "book",
  mapping: Record<string, MappableField>,
): RowExtraction {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      index, title: "", author: null, year: null, pageCount: null, runtimeMinutes: null,
      mainGenre: null, recommendedByRaw: null, originNote: null, unknownKeys: [],
      errors: ["A linha precisa ser um objeto JSON."],
    };
  }
  const record = raw as Record<string, unknown>;
  const mappedKeys = new Set(Object.keys(mapping).map((key) => key.toLowerCase()));
  const unknownKeys = Object.keys(record).filter(
    (key) => !KNOWN_KEYS.has(key.toLowerCase()) && !mappedKeys.has(key.toLowerCase()),
  );

  const title = firstString(keyForField(record, "title", mapping)).slice(0, 200);
  if (!title) errors.push("Sem título.");

  const author = joinStrings(keyForField(record, "author", mapping)).slice(0, 200) || null;
  if (kind === "book" && !author) errors.push("Livro sem autor.");

  const year = intOrNull(keyForField(record, "year", mapping), 1870, 2200);
  const pageCount = intOrNull(keyForField(record, "pageCount", mapping), 1, 1_000_000);
  const runtimeMinutes = intOrNull(keyForField(record, "runtimeMinutes", mapping), 1, 2000);
  const mainGenre = firstString(keyForField(record, "mainGenre", mapping)).slice(0, 80) || null;
  const recommendedByRaw = firstString(keyForField(record, "recommendedBy", mapping)).slice(0, 120) || null;
  const originNote = firstString(keyForField(record, "origin", mapping)).slice(0, 200) || null;

  return {
    index, title, author, year, pageCount, runtimeMinutes, mainGenre,
    recommendedByRaw, originNote, unknownKeys, errors,
  };
}

export interface ImportPreviewRow {
  index: number;
  title: string;
  valid: boolean;
  errors: string[];
  mapped: {
    author: string | null;
    year: number | null;
    pageCount: number | null;
    runtimeMinutes: number | null;
    mainGenre: string | null;
  };
  recommendation:
    | { kind: "participant"; userId: string; name: string }
    | { kind: "origin"; text: string }
    | null;
  /** A catalog item in this group with the same identity, if any. */
  existingCatalogItemId: string | null;
  /** True when an active item in this same challenge already has this title. */
  duplicateInChallenge: boolean;
  unknownKeys: string[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  summary: {
    total: number;
    importable: number;
    invalid: number;
    duplicatesInCatalog: number;
    duplicatesInChallenge: number;
    unknownKeys: string[];
  };
  limit: number;
  catalogKind: "film" | "book";
}

/**
 * Parses a pasted JSON list without writing anything: validates each row, maps
 * known fields, flags unknown keys, resolves a recommender to a participant (or
 * keeps it as an origin note), and detects items that already exist in the
 * group's catalog or in this challenge. The client shows this, lets the user fix
 * or drop rows, then commits through `saveChallengeItems`.
 */
export async function previewListImport(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
): Promise<ImportPreview> {
  let parsed: unknown;
  try {
    parsed = typeof body.json === "string" ? JSON.parse(body.json) : body.json;
  } catch {
    throw new ApiError(400, "invalid_json", "O texto colado não é um JSON válido.");
  }
  if (!Array.isArray(parsed)) {
    throw new ApiError(400, "json_not_array", "Cole uma lista JSON — um array de objetos.");
  }
  if (parsed.length === 0) {
    throw new ApiError(400, "json_empty", "A lista está vazia.");
  }
  if (parsed.length > LIST_IMPORT_LIMIT) {
    throw new ApiError(400, "json_too_large", `Importe no máximo ${LIST_IMPORT_LIMIT} itens por vez.`);
  }
  const mapping: Record<string, MappableField> = {};
  if (body.mapping && typeof body.mapping === "object" && !Array.isArray(body.mapping)) {
    for (const [jsonKey, target] of Object.entries(body.mapping as Record<string, unknown>)) {
      if (typeof target === "string" && (Object.keys(FIELD_ALIASES) as string[]).includes(target)) {
        mapping[jsonKey] = target as MappableField;
      }
    }
  }

  return withClient(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, false);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores importam listas.");
    const types = await entryTypesForChallenge(client, challengeId);
    if (!usesRoundItems(types)) throw new ApiError(409, "invalid_mode", "Este desafio não usa itens.");
    const catalogKind = recipeCatalogKind(access.challenge.recipe_key) ?? "film";

    const participants = (
      await client.query<{ id: string; display_name: string; username: string }>(
        `SELECT u.id, u.display_name, u.username
           FROM challenge_participants cp JOIN users u ON u.id = cp.user_id
          WHERE cp.challenge_id = $1 AND cp.removed_at IS NULL`,
        [challengeId],
      )
    ).rows;
    const participantByName = new Map<string, { id: string; name: string }>();
    for (const person of participants) {
      participantByName.set(normalizeTitle(person.display_name), { id: person.id, name: person.display_name });
      participantByName.set(person.username.toLowerCase(), { id: person.id, name: person.display_name });
    }

    const existingItemTitles = new Set(
      (
        await client.query<{ title: string }>(
          "SELECT title FROM challenge_items WHERE challenge_id = $1 AND archived_at IS NULL",
          [challengeId],
        )
      ).rows.map((row) => normalizeTitle(row.title)),
    );
    const catalogRows = (
      await client.query<{ id: string; title: string; author: string | null }>(
        "SELECT id, title, author FROM catalog_items WHERE group_id = $1 AND kind = $2 AND archived_at IS NULL",
        [access.challenge.group_id, catalogKind],
      )
    ).rows;
    const catalogByTitle = new Map<string, Array<{ id: string; author: string | null }>>();
    for (const row of catalogRows) {
      const key = normalizeTitle(row.title);
      const bucket = catalogByTitle.get(key);
      if (bucket) bucket.push({ id: row.id, author: row.author });
      else catalogByTitle.set(key, [{ id: row.id, author: row.author }]);
    }

    const seenTitles = new Set<string>();
    const rows: ImportPreviewRow[] = parsed.map((raw, index) => {
      const extraction = extractRow(raw, index, catalogKind, mapping);
      const normalized = normalizeTitle(extraction.title);
      const errors = [...extraction.errors];

      if (normalized && seenTitles.has(normalized)) errors.push("Repetido na lista colada.");
      if (normalized) seenTitles.add(normalized);

      let recommendation: ImportPreviewRow["recommendation"] = null;
      if (extraction.recommendedByRaw) {
        const match = participantByName.get(normalizeTitle(extraction.recommendedByRaw))
          ?? participantByName.get(extraction.recommendedByRaw.toLowerCase());
        recommendation = match
          ? { kind: "participant", userId: match.id, name: match.name }
          : { kind: "origin", text: extraction.recommendedByRaw };
      }
      if (!recommendation && extraction.originNote) {
        recommendation = { kind: "origin", text: extraction.originNote };
      }

      const catalogMatches = catalogByTitle.get(normalized) ?? [];
      const existing = catalogKind === "book"
        ? catalogMatches.find(
            (candidate) =>
              (candidate.author ?? "").toLowerCase().replace(/\s+/gu, " ").trim() ===
              (extraction.author ?? "").toLowerCase().replace(/\s+/gu, " ").trim(),
          ) ?? catalogMatches[0]
        : catalogMatches[0];

      return {
        index,
        title: extraction.title,
        valid: errors.length === 0,
        errors,
        mapped: {
          author: extraction.author,
          year: extraction.year,
          pageCount: extraction.pageCount,
          runtimeMinutes: extraction.runtimeMinutes,
          mainGenre: extraction.mainGenre,
        },
        recommendation,
        existingCatalogItemId: normalized ? existing?.id ?? null : null,
        duplicateInChallenge: normalized ? existingItemTitles.has(normalized) : false,
        unknownKeys: extraction.unknownKeys,
      };
    });

    const unknownKeys = [...new Set(rows.flatMap((row) => row.unknownKeys))].sort();
    return {
      rows,
      summary: {
        total: rows.length,
        importable: rows.filter((row) => row.valid && !row.duplicateInChallenge).length,
        invalid: rows.filter((row) => !row.valid).length,
        duplicatesInCatalog: rows.filter((row) => row.existingCatalogItemId).length,
        duplicatesInChallenge: rows.filter((row) => row.duplicateInChallenge).length,
        unknownKeys,
      },
      limit: LIST_IMPORT_LIMIT,
      catalogKind,
    };
  });
}
