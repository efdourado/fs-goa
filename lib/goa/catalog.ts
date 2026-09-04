import type { PoolClient } from "pg";

import { requireGroupRole, type SessionContext } from "../auth";
import { inTransaction, oneOrNull, withClient } from "../db";
import { ApiError, stringValue } from "../http";
import { attributeValuesForItems, setCatalogItemAttributeValues } from "./catalog-attributes";
import { writeAudit } from "./domain/audit";
import { publicId } from "./domain/shared";

export type CatalogKind = "film" | "book" | "other";

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

/** Matches the database's book-identity expression without altering accents. */
function normalizeAuthor(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, " ").trim();
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
  author?: unknown;
  year?: unknown;
  mainGenre?: unknown;
  pageCount?: unknown;
}

function optionalText(value: unknown, max: number, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_text", `${name} precisa ser texto.`);
  }
  const clean = value.trim();
  if (!clean) return null;
  if (clean.length > max) {
    throw new ApiError(400, "invalid_text", `${name} pode ter no máximo ${max} caracteres.`);
  }
  return clean;
}

function readAttributes(input: CatalogAttributes) {
  return {
    author: optionalText(input.author, 200, "Autor"),
    year: optionalInt(input.year, 1870, 2200, "Ano"),
    mainGenre: optionalText(input.mainGenre, 80, "Gênero principal"),
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
  input: { kind: CatalogKind; title: string; attributes?: unknown } & CatalogAttributes,
): Promise<string> {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 300) {
    throw new ApiError(400, "invalid_catalog_title", "O título do item do acervo é inválido.");
  }
  const normalized = normalizeTitle(title);
  const attributes = readAttributes(input);

  // Film identity is title-only: `year` is the latest installment/season and may
  // advance over time. Books additionally use the author, so equal titles by
  // different people remain separate works. `other` keeps year as a legacy
  // disambiguator because it has no stronger domain identity.
  type Row = {
    id: string; author: string | null; year: number | null;
    main_genre: string | null; page_count: number | null;
  };
  const sameTitle = await client.query<Row>(
    `SELECT id, author, year, main_genre, page_count FROM catalog_items
      WHERE group_id = $1 AND kind = $2 AND normalized_title = $3 AND archived_at IS NULL
      ORDER BY created_at`,
    [groupId, input.kind, normalized],
  );
  const existing: Row | null = input.kind === "film"
    ? sameTitle.rows[0] ?? null
    : input.kind === "book"
      ? sameTitle.rows.find(
          (row) => normalizeAuthor(row.author ?? "") === normalizeAuthor(attributes.author ?? ""),
        ) ?? null
      : sameTitle.rows.find((row) => (row.year ?? -1) === (attributes.year ?? -1)) ?? null;
  if (existing) {
    const sets: string[] = [];
    const params: unknown[] = [existing.id];
    const enrich = (column: string, current: string | number | null, next: string | number | null) => {
      if (next !== null && current === null) {
        params.push(next);
        sets.push(`${column} = $${params.length}`);
      }
    };
    enrich("author", existing.author, attributes.author);
    // Re-adding a film/series with a new latest year updates its metadata instead
    // of creating a second catalog identity. Explicit PATCHes can still correct a
    // year downwards; normal upserts only advance it.
    if (
      input.kind === "film"
      && attributes.year !== null
      && (existing.year === null || attributes.year > existing.year)
    ) {
      params.push(attributes.year);
      sets.push(`year = $${params.length}`);
    } else {
      enrich("year", existing.year, attributes.year);
    }
    enrich("main_genre", existing.main_genre, attributes.mainGenre);
    enrich("page_count", existing.page_count, attributes.pageCount);
    if (sets.length) {
      await client.query(`UPDATE catalog_items SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
    }
    if (input.attributes) await setCatalogItemAttributeValues(client, existing.id, groupId, input.kind, input.attributes);
    return existing.id;
  }

  const id = publicId();
  await client.query(
    `INSERT INTO catalog_items
      (id, group_id, kind, title, normalized_title, author, year, main_genre, page_count, created_by_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())`,
    [id, groupId, input.kind, title, normalized, attributes.author, attributes.year, attributes.mainGenre, attributes.pageCount, userId],
  );
  if (input.attributes) await setCatalogItemAttributeValues(client, id, groupId, input.kind, input.attributes);
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

async function listCatalogWithClient(client: PoolClient, workspaceId: string) {
  const items = await client.query<{
    id: string;
    kind: string;
    title: string;
    author: string | null;
    year: number | null;
    main_genre: string | null;
    page_count: number | null;
    round_count: number;
    rating_avg: number | null;
    rating_count: number;
  }>(
    `SELECT ci.id, ci.kind, ci.title, ci.author, ci.year, ci.main_genre, ci.page_count,
              (SELECT count(DISTINCT it.challenge_id)::int FROM challenge_items it WHERE it.catalog_item_id = ci.id) AS round_count,
              agg.rating_avg, coalesce(agg.rating_count, 0)::int AS rating_count
         FROM catalog_items ci
         LEFT JOIN LATERAL (
           SELECT avg(ev.number_scaled::float8 / (10 ^ f.number_scale)) AS rating_avg,
                  count(ev.entry_id) AS rating_count
             FROM challenge_items it
             JOIN challenges c ON c.id = it.challenge_id AND c.deleted_at IS NULL AND c.status <> 'draft'
             JOIN entries e ON e.item_id = it.id AND e.deleted_at IS NULL
              AND e.entry_type_id IN (SELECT id FROM entry_types WHERE challenge_id = c.id AND purpose IN ('rating', 'completion'))
             JOIN entry_values ev ON ev.entry_id = e.id AND ev.number_scaled IS NOT NULL
             JOIN challenge_fields f ON f.id = ev.field_id AND f.kind = 'rating'
            WHERE it.catalog_item_id = ci.id AND it.archived_at IS NULL
         ) agg ON true
        WHERE ci.group_id = $1 AND ci.archived_at IS NULL
        ORDER BY ci.title`,
    [workspaceId],
  );
  const attributesByItem = await attributeValuesForItems(client, items.rows.map((item) => item.id));
  return {
    items: items.rows.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      author: item.author,
      year: item.year,
      mainGenre: item.main_genre,
      pageCount: item.page_count,
      roundCount: item.round_count,
      ratingAvg: item.rating_avg === null ? null : Number(item.rating_avg.toFixed(2)),
      ratingCount: item.rating_count,
      attributes: attributesByItem.get(item.id) ?? [],
    })),
  };
}

/**
 * One catalog item plus its history: the rounds it appeared in (with each
 * round's average rating and who recommended it), so the group can see how a
 * film or book has done across editions.
 */
async function catalogItemDetailWithClient(
  client: PoolClient,
  workspaceId: string,
  catalogItemId: string,
) {
  const item = await oneOrNull<{
    id: string; kind: string; title: string; author: string | null;
    year: number | null; main_genre: string | null; page_count: number | null;
  }>(
    client,
    `SELECT id, kind, title, author, year, main_genre, page_count
         FROM catalog_items WHERE id = $1 AND group_id = $2 AND archived_at IS NULL`,
    [catalogItemId, workspaceId],
  );
  if (!item) throw new ApiError(404, "not_found", "Item do acervo não encontrado.");

  const rounds = await client.query<{
    challenge_id: string; title: string; status: string;
    start_date: string | null; end_date: string | null;
    recommended_by: string | null; rating_avg: number | null; rating_count: number;
  }>(
    // Same rule as the challenge detail: a recommender who is no longer an
    // active member of this group loses the byline, not just their name.
    `SELECT c.id AS challenge_id, c.title, c.status,
              c.start_date::text AS start_date, c.end_date::text AS end_date,
              CASE WHEN active_recommender.user_id IS NOT NULL THEN ru.display_name END AS recommended_by,
              avg(ev.number_scaled::float8 / (10 ^ f.number_scale)) AS rating_avg,
              count(ev.entry_id)::int AS rating_count
         FROM challenge_items it
         JOIN challenges c ON c.id = it.challenge_id AND c.deleted_at IS NULL AND c.status <> 'draft'
         LEFT JOIN users ru ON ru.id = it.recommended_by_user_id
         LEFT JOIN group_members active_recommender
           ON active_recommender.group_id = $2
          AND active_recommender.user_id = it.recommended_by_user_id
          AND active_recommender.removed_at IS NULL
         LEFT JOIN entries e ON e.item_id = it.id AND e.deleted_at IS NULL
          AND e.entry_type_id IN (SELECT id FROM entry_types WHERE challenge_id = c.id AND purpose IN ('rating', 'completion'))
         LEFT JOIN entry_values ev ON ev.entry_id = e.id AND ev.number_scaled IS NOT NULL
         LEFT JOIN challenge_fields f ON f.id = ev.field_id AND f.kind = 'rating'
        WHERE it.catalog_item_id = $1 AND it.archived_at IS NULL
        GROUP BY c.id, c.title, c.status, c.start_date, c.end_date, active_recommender.user_id, ru.display_name, c.created_at
        ORDER BY c.start_date NULLS LAST, c.created_at`,
    [catalogItemId, workspaceId],
  );

  const attributes = (await attributeValuesForItems(client, [item.id])).get(item.id) ?? [];
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    author: item.author,
    year: item.year,
    mainGenre: item.main_genre,
    pageCount: item.page_count,
    attributes,
    rounds: rounds.rows.map((round) => ({
      challengeId: round.challenge_id,
      title: round.title,
      status: round.status,
      startsOn: round.start_date,
      endsOn: round.end_date,
      recommendedBy: round.recommended_by,
      ratingAvg: round.rating_avg === null ? null : Number(round.rating_avg.toFixed(2)),
      ratingCount: round.rating_count,
    })),
  };
}

async function requireStandardWorkspace(
  client: PoolClient,
  userId: string,
  groupId: string,
  roles: Array<"owner" | "admin" | "participant">,
): Promise<void> {
  await requireGroupRole(userId, groupId, roles, client);
  const group = await oneOrNull<{ kind: string }>(
    client,
    "SELECT kind FROM groups WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL",
    [groupId],
  );
  if (!group || group.kind !== "standard") {
    throw new ApiError(404, "not_found", "Grupo não encontrado.");
  }
}

async function personalWorkspaceId(client: PoolClient, userId: string): Promise<string | null> {
  const workspace = await oneOrNull<{ id: string }>(
    client,
    `SELECT id FROM groups
      WHERE kind = 'personal' AND owner_user_id = $1
        AND archived_at IS NULL AND deleted_at IS NULL`,
    [userId],
  );
  return workspace?.id ?? null;
}

export async function listGroupCatalog(session: SessionContext, groupId: string) {
  return withClient(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin", "participant"]);
    return listCatalogWithClient(client, groupId);
  });
}

export async function catalogItemDetail(session: SessionContext, groupId: string, catalogItemId: string) {
  return withClient(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin", "participant"]);
    return catalogItemDetailWithClient(client, groupId, catalogItemId);
  });
}

/** The owner's catalog, without exposing the hidden backing workspace as a group. */
export async function listPersonalCatalog(session: SessionContext) {
  return withClient(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    return workspaceId ? listCatalogWithClient(client, workspaceId) : { items: [] };
  });
}

export async function personalCatalogItemDetail(session: SessionContext, catalogItemId: string) {
  return withClient(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    if (!workspaceId) throw new ApiError(404, "not_found", "Item do acervo não encontrado.");
    return catalogItemDetailWithClient(client, workspaceId, catalogItemId);
  });
}

/**
 * Applies whichever of title/author/year/main genre/pages the body actually sets,
 * leaving the rest untouched. Shared by the catalog item's own PATCH route and
 * by editing a challenge item's linked catalog entry from inside a challenge.
 */
export async function applyCatalogItemUpdate(
  client: PoolClient,
  catalogItemId: string,
  groupId: string,
  body: Record<string, unknown>,
  kind?: CatalogKind,
): Promise<void> {
  const title = body.title === undefined ? undefined : stringValue(body, "title", { min: 1, max: 300 })!;
  const attributes = readAttributes(body as CatalogAttributes);
  const sets: string[] = [];
  const params: unknown[] = [catalogItemId, groupId];
  if (title !== undefined) {
    params.push(title, normalizeTitle(title));
    sets.push(`title = $${params.length - 1}`, `normalized_title = $${params.length}`);
  }
  for (const [column, value, key] of [
    ["author", attributes.author, "author"],
    ["year", attributes.year, "year"],
    ["main_genre", attributes.mainGenre, "mainGenre"],
    ["page_count", attributes.pageCount, "pageCount"],
  ] as const) {
    if (Object.hasOwn(body, key)) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length) {
    await client.query(
      `UPDATE catalog_items SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND group_id = $2`,
      params,
    );
  }
  if (kind && body.attributes) await setCatalogItemAttributeValues(client, catalogItemId, groupId, kind, body.attributes);
}

export async function updateCatalogItem(
  session: SessionContext,
  catalogItemId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const item = await oneOrNull<{
      group_id: string; kind: CatalogKind; group_kind: "standard" | "personal"; owner_user_id: string;
    }>(
      client,
      `SELECT ci.group_id, ci.kind, g.kind AS group_kind, g.owner_user_id
         FROM catalog_items ci JOIN groups g ON g.id = ci.group_id
        WHERE ci.id = $1 AND ci.archived_at IS NULL
          AND g.archived_at IS NULL AND g.deleted_at IS NULL
        FOR UPDATE OF ci`,
      [catalogItemId],
    );
    if (!item) throw new ApiError(404, "not_found", "Item do acervo não encontrado.");
    if (item.group_kind === "personal") {
      if (item.owner_user_id !== session.user.id) {
        throw new ApiError(403, "forbidden", "Este item não pertence ao seu acervo pessoal.");
      }
    } else {
      await requireGroupRole(session.user.id, item.group_id, ["owner", "admin"], client);
    }
    await applyCatalogItemUpdate(client, catalogItemId, item.group_id, body, item.kind);
    return { id: catalogItemId };
  });
}

export async function updatePersonalCatalogItem(
  session: SessionContext,
  catalogItemId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    if (!workspaceId) throw new ApiError(404, "not_found", "Item do acervo não encontrado.");
    const item = await oneOrNull<{ id: string; kind: CatalogKind }>(
      client,
      `SELECT id, kind FROM catalog_items
        WHERE id = $1 AND group_id = $2 AND archived_at IS NULL FOR UPDATE`,
      [catalogItemId, workspaceId],
    );
    if (!item) throw new ApiError(404, "not_found", "Item do acervo não encontrado.");
    await applyCatalogItemUpdate(client, catalogItemId, workspaceId, body, item.kind);
    return { id: catalogItemId };
  });
}

/**
 * Soft-removes a catalog item (sets `archived_at`) so it leaves the browsable
 * acervo and the "from catalog" picker. The row itself stays, so any round that
 * already links to it keeps rendering; a round in a draft/active challenge blocks
 * the removal so its live "from catalog" link never dangles.
 */
async function archiveCatalogItemWithClient(
  client: PoolClient,
  actorUserId: string,
  workspaceId: string,
  catalogItemId: string,
): Promise<{ id: string; archived: true }> {
  const item = await oneOrNull<{ id: string; title: string; kind: string }>(
    client,
    `SELECT id, title, kind FROM catalog_items
      WHERE id = $1 AND group_id = $2 AND archived_at IS NULL FOR UPDATE`,
    [catalogItemId, workspaceId],
  );
  if (!item) throw new ApiError(404, "not_found", "Item do acervo não encontrado.");
  const live = await oneOrNull<{ count: number }>(
    client,
    // A living list (personal, no dates) has no round to protect — its titles
    // are always prunable, so it never counts as "in use".
    `SELECT count(DISTINCT c.id)::int AS count
       FROM challenge_items it
       JOIN challenges c ON c.id = it.challenge_id
       JOIN groups g ON g.id = c.group_id
      WHERE it.catalog_item_id = $1 AND it.archived_at IS NULL
        AND c.deleted_at IS NULL AND c.status IN ('draft', 'active')
        AND NOT (g.kind = 'personal' AND c.start_date IS NULL AND c.end_date IS NULL)`,
    [catalogItemId],
  );
  if (live && live.count > 0) {
    throw new ApiError(
      409,
      "catalog_item_in_use",
      `"${item.title}" está em ${live.count} desafio(s) em andamento. Retire o item desses desafios antes de excluí-lo do acervo.`,
    );
  }
  await client.query(
    "UPDATE catalog_items SET archived_at = now(), updated_at = now() WHERE id = $1",
    [catalogItemId],
  );
  // In a living list the catalog identity and the list row are one and the same,
  // so pruning the catalogue also drops the row (and its entries) from the list.
  await client.query(
    `UPDATE entries e SET deleted_at = now(), last_edited_by_user_id = $2, updated_at = now()
       FROM challenge_items it
       JOIN challenges c ON c.id = it.challenge_id
       JOIN groups g ON g.id = c.group_id
      WHERE it.catalog_item_id = $1 AND e.item_id = it.id AND e.deleted_at IS NULL
        AND g.kind = 'personal' AND c.start_date IS NULL AND c.end_date IS NULL AND c.status <> 'closed'`,
    [catalogItemId, actorUserId],
  );
  await client.query(
    `UPDATE challenge_items it SET archived_at = now(), updated_at = now()
       FROM challenges c, groups g
      WHERE it.catalog_item_id = $1 AND it.archived_at IS NULL
        AND c.id = it.challenge_id AND g.id = c.group_id
        AND g.kind = 'personal' AND c.start_date IS NULL AND c.end_date IS NULL AND c.status <> 'closed'`,
    [catalogItemId],
  );
  await writeAudit(
    client, workspaceId, null, actorUserId,
    "catalog.item_archived", "catalog_item", catalogItemId, null, null,
    { title: item.title, kind: item.kind },
  );
  return { id: catalogItemId, archived: true };
}

export async function archiveCatalogItem(session: SessionContext, catalogItemId: string) {
  return inTransaction(async (client) => {
    const item = await oneOrNull<{
      group_id: string; group_kind: "standard" | "personal"; owner_user_id: string;
    }>(
      client,
      `SELECT ci.group_id, g.kind AS group_kind, g.owner_user_id
         FROM catalog_items ci JOIN groups g ON g.id = ci.group_id
        WHERE ci.id = $1 AND ci.archived_at IS NULL
          AND g.archived_at IS NULL AND g.deleted_at IS NULL`,
      [catalogItemId],
    );
    if (!item) throw new ApiError(404, "not_found", "Item do acervo não encontrado.");
    if (item.group_kind === "personal") {
      if (item.owner_user_id !== session.user.id) {
        throw new ApiError(403, "forbidden", "Este item não pertence ao seu acervo pessoal.");
      }
    } else {
      await requireGroupRole(session.user.id, item.group_id, ["owner", "admin"], client);
    }
    return archiveCatalogItemWithClient(client, session.user.id, item.group_id, catalogItemId);
  });
}

export async function archivePersonalCatalogItem(session: SessionContext, catalogItemId: string) {
  return inTransaction(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    if (!workspaceId) throw new ApiError(404, "not_found", "Item do acervo não encontrado.");
    return archiveCatalogItemWithClient(client, session.user.id, workspaceId, catalogItemId);
  });
}
