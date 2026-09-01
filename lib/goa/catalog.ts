import type { PoolClient } from "pg";

import { requireGroupRole, type SessionContext } from "../auth";
import { inTransaction, oneOrNull, withClient } from "../db";
import { ApiError, stringValue } from "../http";
import { publicId } from "./domain/shared";

export type CatalogKind = "film" | "book" | "other";
export type TagKind = "genre" | "decade" | "mood" | "other";

/** Human-insensitive match key: lowercase, no diacritics, collapsed whitespace. */
export function normalizeTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
}

export function normalizeLabel(value: string): string {
  return normalizeTitle(value).slice(0, 80);
}

function optionalInt(value: unknown, min: number, max: number, name: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ApiError(400, "invalid_number", `${name} precisa ser um inteiro entre ${min} e ${max}.`);
  }
  return number;
}

export interface CatalogAttributes {
  year?: unknown;
  runtimeMinutes?: unknown;
  pageCount?: unknown;
}

function readAttributes(input: CatalogAttributes) {
  return {
    year: optionalInt(input.year, 1870, 2200, "Ano"),
    runtimeMinutes: optionalInt(input.runtimeMinutes, 1, 100_000, "Duração"),
    pageCount: optionalInt(input.pageCount, 1, 1_000_000, "Páginas"),
  };
}

/**
 * Find-or-create a catalog item by normalized title within the group. When it
 * already exists, fills in any attribute that was still empty (so a later, richer
 * entry enriches the shared row) but never overwrites a set value.
 */
export async function upsertCatalogItem(
  client: PoolClient,
  groupId: string,
  userId: string,
  input: { kind: CatalogKind; title: string } & CatalogAttributes,
): Promise<string> {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 300) {
    throw new ApiError(400, "invalid_catalog_title", "O título do item do acervo é inválido.");
  }
  const normalized = normalizeTitle(title);
  const attributes = readAttributes(input);

  // Year participates in the identity so "Dune (1984)" and "Dune (2021)" stay
  // apart. But a bare title still matches a single dated row of the same name
  // (and adopts its year), so "Aftersun" folds into "Aftersun (2022)".
  type Row = { id: string; year: number | null; runtime_minutes: number | null; page_count: number | null };
  const sameTitle = await client.query<Row>(
    `SELECT id, year, runtime_minutes, page_count FROM catalog_items
      WHERE group_id = $1 AND kind = $2 AND normalized_title = $3 AND archived_at IS NULL
      ORDER BY created_at`,
    [groupId, input.kind, normalized],
  );
  const existing: Row | null =
    sameTitle.rows.find((row) => (row.year ?? -1) === (attributes.year ?? -1))
    ?? (attributes.year === null && sameTitle.rows.length === 1 ? sameTitle.rows[0] : null);
  if (existing) {
    const sets: string[] = [];
    const params: unknown[] = [existing.id];
    const enrich = (column: string, current: number | null, next: number | null) => {
      if (next !== null && current === null) {
        params.push(next);
        sets.push(`${column} = $${params.length}`);
      }
    };
    enrich("year", existing.year, attributes.year);
    enrich("runtime_minutes", existing.runtime_minutes, attributes.runtimeMinutes);
    enrich("page_count", existing.page_count, attributes.pageCount);
    if (sets.length) {
      await client.query(`UPDATE catalog_items SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
    }
    return existing.id;
  }

  const id = publicId();
  await client.query(
    `INSERT INTO catalog_items
      (id, group_id, kind, title, normalized_title, year, runtime_minutes, page_count, created_by_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())`,
    [id, groupId, input.kind, title, normalized, attributes.year, attributes.runtimeMinutes, attributes.pageCount, userId],
  );
  return id;
}

/** Ensures a catalog item belongs to the given group. */
export async function assertCatalogItemInGroup(
  client: PoolClient,
  catalogItemId: string,
  groupId: string,
  kind?: CatalogKind,
): Promise<void> {
  const row = await oneOrNull<{ kind: string }>(
    client,
    "SELECT kind FROM catalog_items WHERE id = $1 AND group_id = $2 AND archived_at IS NULL",
    [catalogItemId, groupId],
  );
  if (!row || (kind && row.kind !== kind)) {
    throw new ApiError(400, "invalid_catalog_item", "Item do acervo não pertence a este grupo.");
  }
}

export async function resolveTags(
  client: PoolClient,
  groupId: string,
  kind: TagKind,
  labels: unknown,
): Promise<string[]> {
  if (!Array.isArray(labels)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of labels.slice(0, 30)) {
    if (typeof raw !== "string") continue;
    const label = raw.trim();
    if (!label || label.length > 80) continue;
    const normalized = normalizeLabel(label);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const existing = await oneOrNull<{ id: string }>(
      client,
      "SELECT id FROM catalog_tags WHERE group_id = $1 AND kind = $2 AND normalized_label = $3",
      [groupId, kind, normalized],
    );
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const id = publicId();
    await client.query(
      `INSERT INTO catalog_tags (id, group_id, kind, label, normalized_label, created_at)
       VALUES ($1,$2,$3,$4,$5,now())`,
      [id, groupId, kind, label, normalized],
    );
    ids.push(id);
  }
  return ids;
}

export async function setCatalogItemTags(
  client: PoolClient,
  catalogItemId: string,
  tagIds: string[],
): Promise<void> {
  await client.query("DELETE FROM catalog_item_tags WHERE catalog_item_id = $1", [catalogItemId]);
  for (const tagId of tagIds) {
    await client.query(
      "INSERT INTO catalog_item_tags (catalog_item_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [catalogItemId, tagId],
    );
  }
}

export async function listGroupCatalog(session: SessionContext, groupId: string) {
  return withClient(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin", "participant"], client);
    const items = await client.query<{
      id: string;
      kind: string;
      title: string;
      year: number | null;
      runtime_minutes: number | null;
      page_count: number | null;
      round_count: number;
    }>(
      `SELECT ci.id, ci.kind, ci.title, ci.year, ci.runtime_minutes, ci.page_count,
              (SELECT count(DISTINCT it.challenge_id)::int FROM challenge_items it WHERE it.catalog_item_id = ci.id) AS round_count
         FROM catalog_items ci
        WHERE ci.group_id = $1 AND ci.archived_at IS NULL
        ORDER BY ci.title`,
      [groupId],
    );
    const tags = await client.query<{ catalog_item_id: string; kind: string; label: string }>(
      `SELECT cit.catalog_item_id, ct.kind, ct.label
         FROM catalog_item_tags cit
         JOIN catalog_tags ct ON ct.id = cit.tag_id
        WHERE ct.group_id = $1
        ORDER BY ct.label`,
      [groupId],
    );
    const genresByItem = new Map<string, string[]>();
    for (const row of tags.rows) {
      if (row.kind !== "genre") continue;
      const list = genresByItem.get(row.catalog_item_id) ?? [];
      list.push(row.label);
      genresByItem.set(row.catalog_item_id, list);
    }
    return {
      items: items.rows.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        year: item.year,
        runtimeMinutes: item.runtime_minutes,
        pageCount: item.page_count,
        genres: genresByItem.get(item.id) ?? [],
        roundCount: item.round_count,
      })),
    };
  });
}

export async function updateCatalogItem(
  session: SessionContext,
  catalogItemId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const item = await oneOrNull<{ group_id: string; kind: CatalogKind }>(
      client,
      "SELECT group_id, kind FROM catalog_items WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [catalogItemId],
    );
    if (!item) throw new ApiError(404, "not_found", "Item do acervo não encontrado.");
    await requireGroupRole(session.user.id, item.group_id, ["owner", "admin"], client);

    const title = body.title === undefined ? undefined : stringValue(body, "title", { min: 1, max: 300 })!;
    const attributes = readAttributes(body as CatalogAttributes);
    const sets: string[] = [];
    const params: unknown[] = [catalogItemId];
    if (title !== undefined) {
      params.push(title, normalizeTitle(title));
      sets.push(`title = $${params.length - 1}`, `normalized_title = $${params.length}`);
    }
    for (const [column, value] of [
      ["year", attributes.year],
      ["runtime_minutes", attributes.runtimeMinutes],
      ["page_count", attributes.pageCount],
    ] as const) {
      if (Object.hasOwn(body, column) || (column === "runtime_minutes" && Object.hasOwn(body, "runtimeMinutes")) || (column === "page_count" && Object.hasOwn(body, "pageCount"))) {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (sets.length) {
      await client.query(`UPDATE catalog_items SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
    }
    if (Object.hasOwn(body, "genres")) {
      const tagIds = await resolveTags(client, item.group_id, "genre", body.genres);
      await setCatalogItemTags(client, catalogItemId, tagIds);
    }
    return { id: catalogItemId };
  });
}
