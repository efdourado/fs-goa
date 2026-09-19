import type { PoolClient } from "pg";

import { requireGroupRole, type SessionContext } from "../auth";
import { inTransaction, oneOrNull, withClient } from "../db";
import { ApiError, stringValue } from "../http";
import {
  attributeValuesForItems,
  listDefsWithClient,
  seedAttributeDefs,
  setCatalogItemAttributeValues,
  updateAttributeDef,
  type CatalogAttributeType,
} from "./catalog-attributes";
import { writeAudit } from "./domain/audit";
import { eventScheduleColumns, eventScheduleJson, parseEventSchedule, scheduleVisibleSql } from "./domain/event-schedule";
import { ensurePersonalWorkspace } from "./domain/challenges";
import { normalizeTitle, publicId } from "./domain/shared";
import { moveToTrash } from "./trash";

export type CatalogKind = "film" | "book" | "other";

export { normalizeTitle } from "./domain/shared";

function sourceForKind(kind: string): "screens" | "pages" | "custom" {
  return kind === "film" ? "screens" : kind === "book" ? "pages" : "custom";
}

/**
 * Every `catalog_items`/`catalog_attribute_defs` row needs a backing
 * `catalog_libraries` row (`catalog_items_library_fk`/
 * `catalog_attribute_defs_library_fk`). This lazily materializes one the
 * first time a group actually uses a kind, so an existing group's first
 * film/book/other item never has to know libraries exist as a separate step.
 * Idempotent (`ON CONFLICT DO NOTHING`); cheap enough to call before every
 * insert rather than branch on whether one might already exist. A no-op when
 * `kind` came from an already-resolved library id (`resolveItemKind`) since
 * that row already exists.
 */
export async function ensureCatalogLibrary(
  client: PoolClient,
  groupId: string,
  kind: string,
  actorUserId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO catalog_libraries (id, group_id, kind, source, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (group_id, kind) DO NOTHING`,
    [publicId(), groupId, kind, sourceForKind(kind), actorUserId],
  );
}

/**
 * Switches a library's "Scheduled date and time" property on — creating the row of a built-in
 * library nobody has used yet. Idempotent, and never touches a name or position someone gave the
 * property. A challenge that says "each item has its own date" does this for the libraries it draws from.
 */
export async function enableLibraryEventSchedule(
  client: PoolClient,
  groupId: string,
  userId: string,
  kind: string,
): Promise<void> {
  await ensureCatalogLibrary(client, groupId, kind, userId);
  await client.query(
    `INSERT INTO catalog_native_property_configs (id, library_id, property_key, label, hidden, position, created_at, updated_at)
     SELECT $3, l.id, 'scheduled_at', NULL, false, NULL, now(), now()
       FROM catalog_libraries l WHERE l.group_id = $1 AND l.kind = $2
     ON CONFLICT (library_id, property_key) DO UPDATE SET hidden = false, updated_at = now()`,
    [groupId, kind, publicId()],
  );
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
  runtimeMinutes?: unknown;
  /** The item's own scheduled date/time (a match's kickoff): `null` clears, absent leaves it alone. */
  scheduledAt?: unknown;
}

const DEFAULT_SCHEDULE_TIME_ZONE = "America/Sao_Paulo";

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
    runtimeMinutes: optionalInt(input.runtimeMinutes, 1, 2000, "Duração"),
    // `undefined` = not sent (keep whatever is stored); `null` = explicitly no schedule.
    scheduled: input.scheduledAt === undefined
      ? undefined
      : parseEventSchedule(input.scheduledAt, DEFAULT_SCHEDULE_TIME_ZONE),
  };
}

type ParsedAttributes = ReturnType<typeof readAttributes>;

/**
 * Find-or-create a film/book by normalized title within the group. When it
 * already exists, fills in any attribute that was still empty (so a later, richer
 * entry enriches the shared row) but never overwrites a set value.
 *
 * Film/book only, deliberately: their title(+author)-based identity and this
 * auto-match behavior are frozen exactly as they were before libraries
 * existed. Every other kind goes through `createCatalogItem`/`addCatalogItem`
 * instead, which never merge on a title match — only an explicit "use
 * existing" choice reuses a row (see `findPossibleCatalogItemMatches`).
 */
export async function upsertCatalogItem(
  client: PoolClient,
  groupId: string,
  userId: string,
  input: { kind: "film" | "book"; title: string; attributes?: unknown } & CatalogAttributes,
): Promise<string> {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 300) {
    throw new ApiError(400, "invalid_catalog_title", "O título do item do acervo é inválido.");
  }
  const normalized = normalizeTitle(title);
  const attributes = readAttributes(input);
  await ensureCatalogLibrary(client, groupId, input.kind, userId);

  // Film identity is title-only: `year` is the latest installment/season and
  // may advance over time. Books additionally use the author, so equal
  // titles by different people remain separate works.
  type Row = {
    id: string; author: string | null; year: number | null;
    main_genre: string | null; page_count: number | null; runtime_minutes: number | null;
    scheduled_at: Date | null;
  };
  const sameTitle = await client.query<Row>(
    `SELECT id, author, year, main_genre, page_count, runtime_minutes, scheduled_at FROM catalog_items
      WHERE group_id = $1 AND kind = $2 AND normalized_title = $3 AND archived_at IS NULL
      ORDER BY created_at`,
    [groupId, input.kind, normalized],
  );
  const existing: Row | null = input.kind === "film"
    ? sameTitle.rows[0] ?? null
    : sameTitle.rows.find(
        (row) => normalizeAuthor(row.author ?? "") === normalizeAuthor(attributes.author ?? ""),
      ) ?? null;
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
    enrich("runtime_minutes", existing.runtime_minutes, attributes.runtimeMinutes);
    // A film/book already scheduled keeps its date — the same "never overwrite" rule as every attribute.
    if (attributes.scheduled && !existing.scheduled_at) {
      const columns = eventScheduleColumns(attributes.scheduled);
      for (const [column, value] of Object.entries(columns)) {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (sets.length) {
      await client.query(`UPDATE catalog_items SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
    }
    if (input.attributes) await setCatalogItemAttributeValues(client, existing.id, groupId, input.kind, input.attributes);
    return existing.id;
  }

  const id = await insertCatalogItemRow(client, groupId, userId, input.kind, title, normalized, attributes);
  if (input.attributes) await setCatalogItemAttributeValues(client, id, groupId, input.kind, input.attributes);
  return id;
}

async function insertCatalogItemRow(
  client: PoolClient,
  groupId: string,
  userId: string,
  kind: string,
  title: string,
  normalized: string,
  attributes: ParsedAttributes,
): Promise<string> {
  const id = publicId();
  const schedule = eventScheduleColumns(attributes.scheduled ?? null);
  await client.query(
    `INSERT INTO catalog_items
      (id, group_id, kind, title, normalized_title, author, year, main_genre, page_count, runtime_minutes,
       scheduled_at, scheduled_end_at, scheduled_precision, scheduled_time_zone, created_by_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now())`,
    [
      id, groupId, kind, title, normalized, attributes.author, attributes.year, attributes.mainGenre, attributes.pageCount, attributes.runtimeMinutes,
      schedule.scheduled_at, schedule.scheduled_end_at, schedule.scheduled_precision, schedule.scheduled_time_zone, userId,
    ],
  );
  return id;
}

/**
 * Possible existing items for a title someone just typed, before they add a
 * new one. Only meaningful for kinds without a title-based identity — every
 * kind except film/book, whose existing single-step auto-match this does not
 * change. Basic normalized-title substring match; fuzzy matching is not a
 * requirement here, only an honest "here's what's close" suggestion list the
 * person explicitly accepts or ignores. `kind` is a plain string, not just
 * `CatalogKind`: it may be an opaque, user-created library's kind too.
 */
export async function findPossibleCatalogItemMatches(
  client: PoolClient,
  groupId: string,
  kind: string,
  title: string,
): Promise<Array<{ id: string; title: string; year: number | null; author: string | null }>> {
  const normalized = normalizeTitle(title);
  if (!normalized) return [];
  const rows = await client.query<{ id: string; title: string; year: number | null; author: string | null }>(
    `SELECT id, title, year, author FROM catalog_items
      WHERE group_id = $1 AND kind = $2 AND archived_at IS NULL AND strpos(normalized_title, $3) > 0
      ORDER BY title LIMIT 10`,
    [groupId, kind, normalized],
  );
  return rows.rows;
}

/**
 * Always inserts a new catalog item — no find-or-create, no merge. A title
 * matching an existing item is never identity here (see
 * `findPossibleCatalogItemMatches`): only an explicit "use existing" choice
 * reuses a row. film/book never call this — see `upsertCatalogItem`.
 */
export async function createCatalogItem(
  client: PoolClient,
  groupId: string,
  userId: string,
  input: {
    kind: string; title: string; attributes?: unknown;
    catalogRecommendedByUserId?: unknown; catalogRecommendedByExternalId?: unknown; catalogOriginNote?: unknown;
  } & CatalogAttributes,
): Promise<string> {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 300) {
    throw new ApiError(400, "invalid_catalog_title", "O título do item do acervo é inválido.");
  }
  const normalized = normalizeTitle(title);
  const attributes = readAttributes(input);
  await ensureCatalogLibrary(client, groupId, input.kind, userId);
  const id = await insertCatalogItemRow(client, groupId, userId, input.kind, title, normalized, attributes);
  if (input.attributes) await setCatalogItemAttributeValues(client, id, groupId, input.kind, input.attributes);
  if (input.catalogRecommendedByUserId !== undefined || input.catalogRecommendedByExternalId !== undefined || input.catalogOriginNote !== undefined) {
    await applyCatalogItemUpdate(client, id, groupId, {
      catalogRecommendedByUserId: input.catalogRecommendedByUserId,
      catalogRecommendedByExternalId: input.catalogRecommendedByExternalId,
      catalogOriginNote: input.catalogOriginNote,
    });
  }
  return id;
}

/** Ensures a catalog item belongs to the given group. */
export async function assertCatalogItemInGroup(
  client: PoolClient,
  catalogItemId: string,
  groupId: string,
  kind?: string,
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

/**
 * The catalog page's own "add an item" flow, independent of any challenge.
 * film/book keep their existing single-step auto-match unchanged. Every
 * other kind requires an explicit choice: pass `useExistingId` (an id from
 * `findPossibleCatalogItemMatches`) to reuse that row as-is, or omit it to
 * always create a new one — a matching title is never a silent merge here.
 */
export async function addCatalogItem(
  client: PoolClient,
  groupId: string,
  userId: string,
  input: {
    kind: string; title: string; useExistingId?: string; attributes?: unknown;
    catalogRecommendedByUserId?: unknown; catalogRecommendedByExternalId?: unknown; catalogOriginNote?: unknown;
  } & CatalogAttributes,
): Promise<{ id: string }> {
  if (input.kind === "film" || input.kind === "book") {
    const id = await upsertCatalogItem(client, groupId, userId, { ...input, kind: input.kind });
    const named = input.catalogRecommendedByUserId !== undefined || input.catalogRecommendedByExternalId !== undefined
      || input.catalogOriginNote !== undefined;
    if (named) {
      // Same "never overwrite what's already set" rule the auto-match applies to
      // every other attribute: a title that already has a recommender keeps it.
      const current = await oneOrNull<{ set: boolean }>(
        client,
        `SELECT (recommended_by_user_id IS NOT NULL OR recommended_by_external_id IS NOT NULL OR origin_note IS NOT NULL) AS set
           FROM catalog_items WHERE id = $1`,
        [id],
      );
      if (!current?.set) {
        await applyCatalogItemUpdate(client, id, groupId, {
          catalogRecommendedByUserId: input.catalogRecommendedByUserId,
          catalogRecommendedByExternalId: input.catalogRecommendedByExternalId,
          catalogOriginNote: input.catalogOriginNote,
        });
      }
    }
    return { id };
  }
  if (input.useExistingId) {
    await assertCatalogItemInGroup(client, input.useExistingId, groupId, input.kind);
    return { id: input.useExistingId };
  }
  return { id: await createCatalogItem(client, groupId, userId, input) };
}

function readCatalogKind(value: unknown): CatalogKind {
  if (value !== "film" && value !== "book" && value !== "other") {
    throw new ApiError(400, "invalid_kind", "Escolha um tipo de item válido.");
  }
  return value;
}

/**
 * A caller picks a library by id (any workspace library, built-in or
 * user-created) rather than typing a raw kind string — this is the only place
 * an opaque library kind is trusted, and only after confirming the library is
 * actually this workspace's own. `kind` alone still works for the frozen
 * film/book/other vocabulary (existing clients, existing behavior).
 */
export async function resolveItemKind(
  client: PoolClient,
  groupId: string,
  input: { kind?: unknown; libraryId?: unknown },
): Promise<string> {
  if (typeof input.libraryId === "string" && input.libraryId) {
    const row = await oneOrNull<{ kind: string }>(
      client,
      "SELECT kind FROM catalog_libraries WHERE id = $1 AND group_id = $2 AND archived_at IS NULL",
      [input.libraryId, groupId],
    );
    if (!row) throw new ApiError(400, "invalid_library", "Biblioteca não encontrada.");
    return row.kind;
  }
  return readCatalogKind(input.kind);
}

/**
 * Whether a book needs its author to be told apart. The author is half of a
 * book's identity (two works can share a title), so it is asked for — unless the
 * library hid the Author property, in which case people were told they don't
 * need to fill it in and the requirement goes with it.
 */
export async function authorRequired(client: PoolClient, groupId: string, kind: string): Promise<boolean> {
  if (kind !== "book") return false;
  const hidden = await oneOrNull<{ hidden: boolean }>(
    client,
    `SELECT n.hidden FROM catalog_native_property_configs n
       JOIN catalog_libraries l ON l.id = n.library_id
      WHERE l.group_id = $1 AND l.kind = 'book' AND n.property_key = 'author'`,
    [groupId],
  );
  return hidden?.hidden !== true;
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
    runtime_minutes: number | null;
    scheduled_at: Date | null;
    scheduled_end_at: Date | null;
    scheduled_precision: "date" | "datetime";
    scheduled_time_zone: string | null;
    round_count: number;
    challenge_count: number;
    rating_avg: number | null;
    rating_count: number;
    recommended_by_user_id: string | null;
    recommended_by_user_name: string | null;
    recommended_by_external_id: string | null;
    recommended_by_external_name: string | null;
    origin_note: string | null;
  }>(
    `SELECT ci.id, ci.kind, ci.title, ci.author, ci.year, ci.main_genre, ci.page_count, ci.runtime_minutes,
              CASE WHEN ${scheduleVisibleSql("ci")} THEN ci.scheduled_at END AS scheduled_at,
              CASE WHEN ${scheduleVisibleSql("ci")} THEN ci.scheduled_end_at END AS scheduled_end_at,
              ci.scheduled_precision, ci.scheduled_time_zone,
              (SELECT count(DISTINCT it.challenge_id)::int FROM challenge_items it WHERE it.catalog_item_id = ci.id) AS round_count,
              -- Challenges that still hold it: a removed item or a deleted challenge no longer counts.
              (SELECT count(DISTINCT it.challenge_id)::int
                 FROM challenge_items it JOIN challenges c ON c.id = it.challenge_id AND c.deleted_at IS NULL
                WHERE it.catalog_item_id = ci.id AND it.archived_at IS NULL) AS challenge_count,
              agg.rating_avg, coalesce(agg.rating_count, 0)::int AS rating_count,
              CASE WHEN active_rec.user_id IS NOT NULL THEN ci.recommended_by_user_id END AS recommended_by_user_id,
              CASE WHEN active_rec.user_id IS NOT NULL THEN ru.display_name END AS recommended_by_user_name,
              ci.recommended_by_external_id, cr.display_name AS recommended_by_external_name,
              ci.origin_note
         FROM catalog_items ci
         LEFT JOIN users ru ON ru.id = ci.recommended_by_user_id
         LEFT JOIN group_members active_rec ON active_rec.group_id = ci.group_id
          AND active_rec.user_id = ci.recommended_by_user_id AND active_rec.removed_at IS NULL
         LEFT JOIN catalog_recommenders cr ON cr.id = ci.recommended_by_external_id
         LEFT JOIN LATERAL (
           SELECT avg(ev.number_scaled::float8 / (10 ^ f.number_scale)) AS rating_avg,
                  count(ev.entry_id) AS rating_count
             FROM challenge_items it
             JOIN challenges c ON c.id = it.challenge_id AND c.deleted_at IS NULL AND c.status <> 'draft'
             JOIN entries e ON e.item_id = it.id AND e.deleted_at IS NULL
              AND e.entry_type_id IN (SELECT id FROM entry_types WHERE challenge_id = c.id AND purpose IN ('rating', 'completion') AND answer_scope = 'individual')
             JOIN entry_values ev ON ev.entry_id = e.id AND ev.number_scaled IS NOT NULL
             JOIN challenge_fields f ON f.id = ev.field_id AND f.kind = 'rating'
            WHERE it.catalog_item_id = ci.id AND it.archived_at IS NULL
         ) agg ON true
        WHERE ci.group_id = $1 AND ci.archived_at IS NULL
        ORDER BY ci.title`,
    [workspaceId],
  );
  const attributesByItem = await attributeValuesForItems(client, items.rows.map((item) => item.id));
  const showRecommenders = await recommendationsVisible(client, workspaceId);
  return {
    items: items.rows.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      author: item.author,
      year: item.year,
      mainGenre: item.main_genre,
      pageCount: item.page_count,
      runtimeMinutes: item.runtime_minutes,
      scheduledAt: eventScheduleJson(item),
      roundCount: item.round_count,
      challengeCount: item.challenge_count,
      recommendedBy: !showRecommenders ? null : item.recommended_by_user_id
        ? { kind: "member" as const, id: item.recommended_by_user_id, name: item.recommended_by_user_name ?? "" }
        : item.recommended_by_external_id
          ? { kind: "external" as const, id: item.recommended_by_external_id, name: item.recommended_by_external_name ?? "" }
          : null,
      originNote: showRecommenders ? item.origin_note : null,
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
    year: number | null; main_genre: string | null; page_count: number | null; runtime_minutes: number | null;
    scheduled_at: Date | null; scheduled_end_at: Date | null;
    scheduled_precision: "date" | "datetime"; scheduled_time_zone: string | null;
    recommended_by_user_id: string | null; recommended_by_user_name: string | null;
    recommended_by_external_id: string | null; recommended_by_external_name: string | null; origin_note: string | null;
  }>(
    client,
    `SELECT ci.id, ci.kind, ci.title, ci.author, ci.year, ci.main_genre, ci.page_count, ci.runtime_minutes,
            CASE WHEN ${scheduleVisibleSql("ci")} THEN ci.scheduled_at END AS scheduled_at,
            CASE WHEN ${scheduleVisibleSql("ci")} THEN ci.scheduled_end_at END AS scheduled_end_at,
            ci.scheduled_precision, ci.scheduled_time_zone,
            CASE WHEN active_rec.user_id IS NOT NULL THEN ci.recommended_by_user_id END AS recommended_by_user_id,
            CASE WHEN active_rec.user_id IS NOT NULL THEN ru.display_name END AS recommended_by_user_name,
            ci.recommended_by_external_id, cr.display_name AS recommended_by_external_name, ci.origin_note
         FROM catalog_items ci
         LEFT JOIN users ru ON ru.id = ci.recommended_by_user_id
         LEFT JOIN group_members active_rec ON active_rec.group_id = ci.group_id
          AND active_rec.user_id = ci.recommended_by_user_id AND active_rec.removed_at IS NULL
         LEFT JOIN catalog_recommenders cr ON cr.id = ci.recommended_by_external_id
        WHERE ci.id = $1 AND ci.group_id = $2 AND ci.archived_at IS NULL`,
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
          AND e.entry_type_id IN (SELECT id FROM entry_types WHERE challenge_id = c.id AND purpose IN ('rating', 'completion') AND answer_scope = 'individual')
         LEFT JOIN entry_values ev ON ev.entry_id = e.id AND ev.number_scaled IS NOT NULL
         LEFT JOIN challenge_fields f ON f.id = ev.field_id AND f.kind = 'rating'
        WHERE it.catalog_item_id = $1 AND it.archived_at IS NULL
        GROUP BY c.id, c.title, c.status, c.start_date, c.end_date, active_recommender.user_id, ru.display_name, c.created_at
        ORDER BY c.start_date NULLS LAST, c.created_at`,
    [catalogItemId, workspaceId],
  );

  const attributes = (await attributeValuesForItems(client, [item.id])).get(item.id) ?? [];
  const showRecommenders = await recommendationsVisible(client, workspaceId);
  // The group's overall rating for this item, across every round — a true
  // weighted average (avg*count sums back to each round's total, so summing
  // those and dividing by the total count is exact, not an average of averages).
  const ratedRounds = rounds.rows.filter((round) => round.rating_count > 0);
  const totalRatings = ratedRounds.reduce((sum, round) => sum + round.rating_count, 0);
  const ratingAvg = totalRatings > 0
    ? Number((ratedRounds.reduce((sum, round) => sum + (round.rating_avg ?? 0) * round.rating_count, 0) / totalRatings).toFixed(2))
    : null;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    author: item.author,
    year: item.year,
    mainGenre: item.main_genre,
    pageCount: item.page_count,
    runtimeMinutes: item.runtime_minutes,
    scheduledAt: eventScheduleJson(item),
    recommendedBy: !showRecommenders ? null : item.recommended_by_user_id
      ? { kind: "member" as const, id: item.recommended_by_user_id, name: item.recommended_by_user_name ?? "" }
      : item.recommended_by_external_id
        ? { kind: "external" as const, id: item.recommended_by_external_id, name: item.recommended_by_external_name ?? "" }
        : null,
    originNote: showRecommenders ? item.origin_note : null,
    ratingAvg,
    ratingCount: totalRatings,
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

async function catalogItemInput(client: PoolClient, groupId: string, body: Record<string, unknown>) {
  return {
    kind: await resolveItemKind(client, groupId, body),
    title: stringValue(body, "title", { min: 1, max: 300 })!,
    useExistingId: typeof body.useExistingId === "string" ? body.useExistingId : undefined,
    author: body.author,
    year: body.year,
    mainGenre: body.mainGenre,
    pageCount: body.pageCount,
    runtimeMinutes: body.runtimeMinutes,
    scheduledAt: body.scheduledAt,
    attributes: body.attributes,
    catalogRecommendedByUserId: body.catalogRecommendedByUserId,
    catalogRecommendedByExternalId: body.catalogRecommendedByExternalId,
    catalogOriginNote: body.catalogOriginNote,
  };
}

/**
 * Adds an item straight to the group's catalog — no challenge involved. The
 * catalog page's own "add an item" action; see `addCatalogItem` for the
 * film/book-vs-everything-else behavior. `body.libraryId` picks any workspace
 * library (including a user-created one); `body.kind` still works for the
 * frozen film/book/other vocabulary.
 */
export async function addGroupCatalogItem(session: SessionContext, groupId: string, body: Record<string, unknown>) {
  return inTransaction(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin"]);
    return addCatalogItem(client, groupId, session.user.id, await catalogItemInput(client, groupId, body));
  });
}

export async function addPersonalCatalogItem(session: SessionContext, body: Record<string, unknown>) {
  const workspaceId = await ensurePersonalWorkspace(session.user.id);
  return inTransaction(async (client) => addCatalogItem(client, workspaceId, session.user.id, await catalogItemInput(client, workspaceId, body)));
}

/** Suggestions for the add-item flow's explicit "use existing?" step; see `findPossibleCatalogItemMatches`. */
export async function searchGroupCatalogItems(
  session: SessionContext,
  groupId: string,
  kindOrLibrary: { kind?: unknown; libraryId?: unknown },
  title: unknown,
) {
  return withClient(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin", "participant"]);
    const kind = await resolveItemKind(client, groupId, kindOrLibrary);
    return { items: await findPossibleCatalogItemMatches(client, groupId, kind, typeof title === "string" ? title : "") };
  });
}

export async function searchPersonalCatalogItems(
  session: SessionContext,
  kindOrLibrary: { kind?: unknown; libraryId?: unknown },
  title: unknown,
) {
  return withClient(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    if (!workspaceId) return { items: [] };
    const kind = await resolveItemKind(client, workspaceId, kindOrLibrary);
    return { items: await findPossibleCatalogItemMatches(client, workspaceId, kind, typeof title === "string" ? title : "") };
  });
}

// --- Libraries ---------------------------------------------------------

export interface CatalogLibrary {
  id: string;
  kind: string;
  source: "screens" | "pages" | "tables" | "custom";
  label: string | null;
  position: number;
}

function mapLibrary(row: { id: string; kind: string; source: string; label: string | null; position: number }): CatalogLibrary {
  return { id: row.id, kind: row.kind, source: row.source as CatalogLibrary["source"], label: row.label, position: row.position };
}

async function listLibrariesWithClient(client: PoolClient, groupId: string): Promise<CatalogLibrary[]> {
  const rows = await client.query<{ id: string; kind: string; source: string; label: string | null; position: number }>(
    `SELECT id, kind, source, label, position FROM catalog_libraries
      WHERE group_id = $1 AND archived_at IS NULL ORDER BY position, created_at`,
    [groupId],
  );
  return rows.rows.map(mapLibrary);
}

/**
 * What a Tables library starts with — optional catalog facts about a place,
 * not challenge answers (no rating, price or "would return"). Ordinary
 * attribute definitions: rename, hide or archive any of them.
 */
const TABLES_STARTER_PROPERTIES: Array<{ key: string; label: string; type: CatalogAttributeType }> = [
  { key: "cozinha", label: "Tipo de cozinha", type: "text" },
  { key: "bairro", label: "Bairro", type: "text" },
  { key: "endereco", label: "Endereço", type: "text" },
];

// Sources a person can pick when creating a new library. `screens`/`pages`
// only ever come from the film/book evolution (`ensureCatalogLibrary`),
// never from this endpoint.
const CREATABLE_LIBRARY_SOURCES = new Set(["tables", "custom"]);

async function insertLibrary(
  client: PoolClient,
  groupId: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<CatalogLibrary> {
  const source = typeof body.source === "string" && CREATABLE_LIBRARY_SOURCES.has(body.source) ? body.source : "custom";
  // A Tables library can go without a stored name — it then shows the locale-aware
  // default until someone renames it, like the ones a challenge creates itself.
  const label = source === "tables" && (body.label === undefined || body.label === null || body.label === "")
    ? null
    : stringValue(body, "label", { min: 1, max: 80 })!;
  // Opaque and stable: never derived from `label`, so a rename never touches
  // it, and it never collides with another workspace's library of the same
  // starting kind (each gets its own generated key, not a shared literal).
  const kind = `lib_${crypto.randomUUID().replace(/-/g, "")}`;
  const positionRow = await oneOrNull<{ position: number }>(
    client,
    "SELECT coalesce(max(position), -1)::int + 1 AS position FROM catalog_libraries WHERE group_id = $1",
    [groupId],
  );
  const position = positionRow?.position ?? 0;
  const id = publicId();
  await client.query(
    `INSERT INTO catalog_libraries (id, group_id, kind, source, label, position, created_by_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now())`,
    [id, groupId, kind, source, label, position, userId],
  );
  if (source === "tables") await seedAttributeDefs(client, groupId, kind, userId, TABLES_STARTER_PROPERTIES);
  await writeAudit(client, groupId, null, userId, "catalog.library_created", "catalog_library", id, null, { label, source });
  return { id, kind, source: source as CatalogLibrary["source"], label, position };
}

/**
 * The workspace's library of a given starting config, created on first use — so
 * a preset (Tables) works from a blank workspace without a separate "create the
 * library" step. Returns its opaque `kind`. Never touches an existing library's
 * name or properties.
 */
export async function findOrCreateLibraryBySource(
  client: PoolClient,
  groupId: string,
  userId: string,
  source: "tables",
): Promise<string> {
  const existing = await oneOrNull<{ kind: string }>(
    client,
    `SELECT kind FROM catalog_libraries
      WHERE group_id = $1 AND source = $2 AND archived_at IS NULL
      ORDER BY position, created_at LIMIT 1`,
    [groupId, source],
  );
  if (existing) return existing.kind;
  // No stored label: the app shows the locale-aware default for `source` until
  // someone renames it (same as the migrated Screens/Pages libraries).
  const kind = `lib_${crypto.randomUUID().replace(/-/g, "")}`;
  const positionRow = await oneOrNull<{ position: number }>(
    client,
    "SELECT coalesce(max(position), -1)::int + 1 AS position FROM catalog_libraries WHERE group_id = $1",
    [groupId],
  );
  const id = publicId();
  await client.query(
    `INSERT INTO catalog_libraries (id, group_id, kind, source, label, position, created_by_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,NULL,$5,$6,now(),now())`,
    [id, groupId, kind, source, positionRow?.position ?? 0, userId],
  );
  if (source === "tables") await seedAttributeDefs(client, groupId, kind, userId, TABLES_STARTER_PROPERTIES);
  await writeAudit(client, groupId, null, userId, "catalog.library_created", "catalog_library", id, null, { label: null, source });
  return kind;
}

async function renameLibraryWithClient(
  client: PoolClient,
  actorUserId: string,
  groupId: string,
  libraryId: string,
  label: string,
): Promise<void> {
  const result = await client.query(
    "UPDATE catalog_libraries SET label = $1, updated_at = now() WHERE id = $2 AND group_id = $3 AND archived_at IS NULL",
    [label, libraryId, groupId],
  );
  if (result.rowCount === 0) throw new ApiError(404, "not_found", "Biblioteca não encontrada.");
  await writeAudit(client, groupId, null, actorUserId, "catalog.library_renamed", "catalog_library", libraryId, null, { label });
}

export async function listGroupLibraries(session: SessionContext, groupId: string) {
  return withClient(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin", "participant"]);
    return { libraries: await listLibrariesWithClient(client, groupId) };
  });
}

export async function createGroupLibrary(session: SessionContext, groupId: string, body: Record<string, unknown>) {
  return inTransaction(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin"]);
    return insertLibrary(client, groupId, session.user.id, body);
  });
}

export async function listPersonalLibraries(session: SessionContext) {
  return withClient(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    return { libraries: workspaceId ? await listLibrariesWithClient(client, workspaceId) : [] };
  });
}

export async function createPersonalLibrary(session: SessionContext, body: Record<string, unknown>) {
  const workspaceId = await ensurePersonalWorkspace(session.user.id);
  return inTransaction((client) => insertLibrary(client, workspaceId, session.user.id, body));
}

/** Renames any of the caller's libraries (built-in or user-created) by id — mirrors `updateCatalogItem`'s group-agnostic shape. */
export async function renameCatalogLibrary(session: SessionContext, libraryId: string, body: Record<string, unknown>) {
  return inTransaction(async (client) => {
    const library = await oneOrNull<{ group_id: string; group_kind: "standard" | "personal"; owner_user_id: string }>(
      client,
      `SELECT cl.group_id, g.kind AS group_kind, g.owner_user_id
         FROM catalog_libraries cl JOIN groups g ON g.id = cl.group_id
        WHERE cl.id = $1 AND cl.archived_at IS NULL AND g.archived_at IS NULL AND g.deleted_at IS NULL`,
      [libraryId],
    );
    if (!library) throw new ApiError(404, "not_found", "Biblioteca não encontrada.");
    if (library.group_kind === "personal") {
      if (library.owner_user_id !== session.user.id) {
        throw new ApiError(403, "forbidden", "Esta biblioteca não pertence ao seu acervo pessoal.");
      }
    } else {
      await requireGroupRole(session.user.id, library.group_id, ["owner", "admin"], client);
    }
    const label = stringValue(body, "label", { min: 1, max: 80 })!;
    await renameLibraryWithClient(client, session.user.id, library.group_id, libraryId, label);
    return { id: libraryId, label };
  });
}

/**
 * Deletes a library someone made: it is archived (gone from every list) and the items in it go to the
 * bin like any other removal, so nothing is lost for good. Screens and Pages come with the app and stay.
 * A library with items only goes once the caller says so, and never while a running challenge holds one
 * of them; links from other challenges are simply dropped.
 */
export async function deleteCatalogLibrary(session: SessionContext, libraryId: string, options: { deleteItems: boolean }) {
  return inTransaction(async (client) => {
    const library = await oneOrNull<{ group_id: string; kind: string; source: string; label: string | null; group_kind: "standard" | "personal"; owner_user_id: string }>(
      client,
      `SELECT cl.group_id, cl.kind, cl.source, cl.label, g.kind AS group_kind, g.owner_user_id
         FROM catalog_libraries cl JOIN groups g ON g.id = cl.group_id
        WHERE cl.id = $1 AND cl.archived_at IS NULL AND g.archived_at IS NULL AND g.deleted_at IS NULL`,
      [libraryId],
    );
    if (!library) throw new ApiError(404, "not_found", "Biblioteca não encontrada.");
    if (library.group_kind === "personal") {
      if (library.owner_user_id !== session.user.id) {
        throw new ApiError(403, "forbidden", "Esta biblioteca não pertence ao seu acervo pessoal.");
      }
    } else {
      await requireGroupRole(session.user.id, library.group_id, ["owner", "admin"], client);
    }
    if (library.source === "screens" || library.source === "pages") {
      throw new ApiError(409, "library_builtin", "Screens e Pages vêm com o app e não podem ser excluídas.");
    }

    const items = await client.query<{ id: string }>(
      "SELECT id FROM catalog_items WHERE group_id = $1 AND kind = $2 AND archived_at IS NULL ORDER BY title",
      [library.group_id, library.kind],
    );
    if (items.rows.length && !options.deleteItems) {
      throw new ApiError(
        409, "library_has_items",
        `Esta biblioteca tem ${items.rows.length} item(ns). Confirme para excluí-la junto com eles.`,
        { count: items.rows.length },
      );
    }
    // Same rule as removing one item: a running challenge holds its items.
    const busy = await client.query<{ title: string }>(
      `SELECT DISTINCT c.title
         FROM challenge_items it
         JOIN catalog_items ci ON ci.id = it.catalog_item_id
         JOIN challenges c ON c.id = it.challenge_id
         JOIN groups g ON g.id = c.group_id
        WHERE ci.group_id = $1 AND ci.kind = $2 AND ci.archived_at IS NULL AND it.archived_at IS NULL
          AND c.deleted_at IS NULL AND c.status IN ('draft', 'active')
          AND NOT (g.kind = 'personal' AND c.start_date IS NULL AND c.end_date IS NULL)
        ORDER BY c.title`,
      [library.group_id, library.kind],
    );
    if (busy.rows.length) {
      const titles = busy.rows.map((row) => row.title);
      throw new ApiError(
        409, "library_busy",
        `Há itens desta biblioteca em desafios em andamento: ${titles.join(", ")}. Tire-os de lá antes de excluí-la.`,
        { challenges: titles },
      );
    }

    for (const item of items.rows) await archiveCatalogItemWithClient(client, session.user.id, library.group_id, item.id);
    await client.query("DELETE FROM challenge_libraries WHERE group_id = $1 AND kind = $2", [library.group_id, library.kind]);
    await client.query("UPDATE catalog_libraries SET archived_at = now(), updated_at = now() WHERE id = $1", [libraryId]);
    await writeAudit(client, library.group_id, null, session.user.id, "catalog.library_deleted", "catalog_library", libraryId, null,
      { label: library.label, source: library.source, items: items.rows.length });
    return { id: libraryId, deleted: true, items: items.rows.length };
  });
}

// --- Library properties: one editor for native columns and attribute defs --

/**
 * The built-in properties a library can customize. film/book keep their
 * existing columns (no data moves); every other library's only built-in is
 * the title — the rest of its properties are attribute definitions. Keys are
 * stable: metrics and storage key off these, never off a label.
 */
type NativePropertyType = CatalogAttributeType | "schedule";
const SCHEDULE_PROPERTY = { key: "scheduled_at", type: "schedule" as NativePropertyType };
const NATIVE_PROPERTIES: Record<string, Array<{ key: string; type: NativePropertyType }>> = {
  film: [
    { key: "title", type: "text" }, { key: "year", type: "number" },
    { key: "main_genre", type: "text" }, { key: "runtime_minutes", type: "number" }, SCHEDULE_PROPERTY,
  ],
  book: [
    { key: "title", type: "text" }, { key: "author", type: "text" }, { key: "year", type: "number" },
    { key: "main_genre", type: "text" }, { key: "page_count", type: "number" }, SCHEDULE_PROPERTY,
  ],
};
const TITLE_ONLY: Array<{ key: string; type: NativePropertyType }> = [{ key: "title", type: "text" }, SCHEDULE_PROPERTY];
function nativePropertiesFor(kind: string) {
  return NATIVE_PROPERTIES[kind] ?? TITLE_ONLY;
}
/** Off until someone turns it on: most libraries (films, books, restaurants) have no date of their own. */
const DEFAULT_HIDDEN_NATIVE = new Set(["scheduled_at"]);

export interface LibraryProperty {
  /** The native key (`year`, `title`…) or the attribute definition's id — never a label. */
  key: string;
  storage: "native" | "attribute";
  /** `null` on a native property means "use the locale-aware default name". */
  label: string | null;
  type: NativePropertyType;
  hidden: boolean;
  position: number;
  canHide: boolean;
  /** Custom properties only: the stable key an item's saved value is stored under. */
  attributeKey?: string;
}

async function listLibraryPropertiesWithClient(
  client: PoolClient,
  groupId: string,
  library: { id: string; kind: string },
): Promise<LibraryProperty[]> {
  const configs = await client.query<{ property_key: string; label: string | null; hidden: boolean; position: number | null }>(
    "SELECT property_key, label, hidden, position FROM catalog_native_property_configs WHERE library_id = $1",
    [library.id],
  );
  const byKey = new Map(configs.rows.map((row) => [row.property_key, row]));
  const defs = await listDefsWithClient(client, groupId, library.kind, true);
  // Natives default to their built-in order; attribute defs follow them
  // (their own `position` offset past the natives) unless someone gives a
  // native an explicit position to interleave.
  const properties: Array<LibraryProperty & { sort: number }> = [
    ...nativePropertiesFor(library.kind).map((native, index) => {
      const config = byKey.get(native.key);
      const position = config?.position ?? index;
      return {
        key: native.key, storage: "native" as const, label: config?.label ?? null, type: native.type,
        hidden: config?.hidden ?? DEFAULT_HIDDEN_NATIVE.has(native.key), position, canHide: native.key !== "title", sort: position,
      };
    }),
    ...defs.map((def) => ({
      key: def.id, storage: "attribute" as const, label: def.label, type: def.type,
      hidden: def.hidden, position: def.position + 10, canHide: true, sort: def.position + 10, attributeKey: def.key,
    })),
  ];
  return properties.sort((a, b) => a.sort - b.sort).map(({ sort, ...property }) => { void sort; return property; });
}

async function libraryAccess(
  client: PoolClient,
  session: SessionContext,
  libraryId: string,
  roles: Array<"owner" | "admin" | "participant">,
) {
  const library = await oneOrNull<{ id: string; kind: string; group_id: string; group_kind: "standard" | "personal"; owner_user_id: string }>(
    client,
    `SELECT cl.id, cl.kind, cl.group_id, g.kind AS group_kind, g.owner_user_id
       FROM catalog_libraries cl JOIN groups g ON g.id = cl.group_id
      WHERE cl.id = $1 AND cl.archived_at IS NULL AND g.archived_at IS NULL AND g.deleted_at IS NULL`,
    [libraryId],
  );
  if (!library) throw new ApiError(404, "not_found", "Biblioteca não encontrada.");
  if (library.group_kind === "personal") {
    if (library.owner_user_id !== session.user.id) {
      throw new ApiError(403, "forbidden", "Esta biblioteca não pertence ao seu acervo pessoal.");
    }
  } else {
    await requireGroupRole(session.user.id, library.group_id, roles, client);
  }
  return library;
}

/** Every property of one library — built-in and custom in one merged, ordered list. */
export async function listCatalogLibraryProperties(session: SessionContext, libraryId: string) {
  return withClient(async (client) => {
    const library = await libraryAccess(client, session, libraryId, ["owner", "admin", "participant"]);
    return { properties: await listLibraryPropertiesWithClient(client, library.group_id, library) };
  });
}

/**
 * Renames, hides/shows, or reorders one property — the same call whether it
 * lives in a native column or an attribute definition, so no one has to know
 * which. Nothing here moves or deletes a value, and metrics keep reading the
 * same storage. The title can be renamed but never hidden: every item needs a
 * name.
 */
export async function updateCatalogLibraryProperty(
  session: SessionContext,
  libraryId: string,
  propertyKey: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const library = await libraryAccess(client, session, libraryId, ["owner", "admin"]);
    const isNative = nativePropertiesFor(library.kind).some((native) => native.key === propertyKey);

    let label: string | null | undefined;
    if (Object.hasOwn(body, "label")) {
      if (body.label === null) label = null;
      else label = stringValue(body, "label", { min: 1, max: 80 })!;
    }
    const hidden = Object.hasOwn(body, "hidden")
      ? body.hidden === true || (body.hidden === false ? false : (() => { throw new ApiError(400, "invalid_property", "Informe se a propriedade fica oculta."); })())
      : undefined;
    let position: number | null | undefined;
    if (Object.hasOwn(body, "position")) {
      if (body.position === null) position = null;
      else if (Number.isInteger(body.position) && (body.position as number) >= 0) position = body.position as number;
      else throw new ApiError(400, "invalid_property", "A posição precisa ser um inteiro a partir de zero.");
    }

    if (isNative) {
      if (propertyKey === "title" && hidden === true) {
        throw new ApiError(400, "title_required", "O nome do item não pode ser ocultado — todo item precisa de um nome.");
      }
      const current = await oneOrNull<{ label: string | null; hidden: boolean; position: number | null }>(
        client,
        "SELECT label, hidden, position FROM catalog_native_property_configs WHERE library_id = $1 AND property_key = $2 FOR UPDATE",
        [library.id, propertyKey],
      );
      const next = {
        label: label === undefined ? current?.label ?? null : label,
        hidden: hidden === undefined ? current?.hidden ?? DEFAULT_HIDDEN_NATIVE.has(propertyKey) : hidden,
        position: position === undefined ? current?.position ?? null : position,
      };
      if (next.label === null && next.hidden === DEFAULT_HIDDEN_NATIVE.has(propertyKey) && next.position === null) {
        // Back to the defaults: no override to keep.
        await client.query("DELETE FROM catalog_native_property_configs WHERE library_id = $1 AND property_key = $2", [library.id, propertyKey]);
      } else {
        await client.query(
          `INSERT INTO catalog_native_property_configs (id, library_id, property_key, label, hidden, position, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now(),now())
           ON CONFLICT (library_id, property_key) DO UPDATE SET
             label = excluded.label, hidden = excluded.hidden, position = excluded.position, updated_at = now()`,
          [publicId(), library.id, propertyKey, next.label, next.hidden, next.position],
        );
      }
      await writeAudit(client, library.group_id, null, session.user.id, "catalog.property_updated", "catalog_library", library.id, null, { propertyKey, ...next });
    } else {
      // An attribute definition, addressed by its id.
      if (label === null || position === null) {
        throw new ApiError(400, "invalid_property", "Uma propriedade personalizada precisa de um nome e de uma posição.");
      }
      await updateAttributeDef(client, session.user.id, library.group_id, propertyKey, { label, hidden, position: position === undefined ? undefined : position });
    }

    const properties = await listLibraryPropertiesWithClient(client, library.group_id, library);
    const property = properties.find((entry) => entry.key === propertyKey);
    if (!property) throw new ApiError(404, "not_found", "Propriedade não encontrada.");
    return { property };
  });
}

// --- External recommenders ----------------------------------------------

export interface CatalogRecommender {
  id: string;
  displayName: string;
}

function mapRecommender(row: { id: string; display_name: string }): CatalogRecommender {
  return { id: row.id, displayName: row.display_name };
}

async function listRecommendersWithClient(client: PoolClient, groupId: string): Promise<CatalogRecommender[]> {
  const rows = await client.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM catalog_recommenders WHERE group_id = $1 AND archived_at IS NULL ORDER BY display_name",
    [groupId],
  );
  return rows.rows.map(mapRecommender);
}

async function insertRecommender(
  client: PoolClient,
  groupId: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<CatalogRecommender> {
  const displayName = stringValue(body, "displayName", { min: 1, max: 80 })!;
  const id = publicId();
  await client.query(
    `INSERT INTO catalog_recommenders (id, group_id, display_name, created_by_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,now(),now())`,
    [id, groupId, displayName, userId],
  );
  await writeAudit(client, groupId, null, userId, "catalog.recommender_created", "catalog_recommender", id, null, { displayName });
  return { id, displayName };
}

async function renameRecommenderWithClient(
  client: PoolClient,
  actorUserId: string,
  groupId: string,
  recommenderId: string,
  displayName: string,
): Promise<void> {
  const result = await client.query(
    "UPDATE catalog_recommenders SET display_name = $1, updated_at = now() WHERE id = $2 AND group_id = $3 AND archived_at IS NULL",
    [displayName, recommenderId, groupId],
  );
  if (result.rowCount === 0) throw new ApiError(404, "not_found", "Pessoa indicadora não encontrada.");
  await writeAudit(client, groupId, null, actorUserId, "catalog.recommender_renamed", "catalog_recommender", recommenderId, null, { displayName });
}

export async function listGroupRecommenders(session: SessionContext, groupId: string) {
  return withClient(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin", "participant"]);
    return { recommenders: await listRecommendersWithClient(client, groupId) };
  });
}

export async function createGroupRecommender(session: SessionContext, groupId: string, body: Record<string, unknown>) {
  return inTransaction(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin"]);
    return insertRecommender(client, groupId, session.user.id, body);
  });
}

export async function listPersonalRecommenders(session: SessionContext) {
  return withClient(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    return { recommenders: workspaceId ? await listRecommendersWithClient(client, workspaceId) : [] };
  });
}

export async function createPersonalRecommender(session: SessionContext, body: Record<string, unknown>) {
  const workspaceId = await ensurePersonalWorkspace(session.user.id);
  return inTransaction((client) => insertRecommender(client, workspaceId, session.user.id, body));
}

/** Renames any of the caller's saved external names by id — same group-agnostic shape as `renameCatalogLibrary`. */
export async function renameCatalogRecommender(session: SessionContext, recommenderId: string, body: Record<string, unknown>) {
  return inTransaction(async (client) => {
    const recommender = await oneOrNull<{ group_id: string; group_kind: "standard" | "personal"; owner_user_id: string }>(
      client,
      `SELECT cr.group_id, g.kind AS group_kind, g.owner_user_id
         FROM catalog_recommenders cr JOIN groups g ON g.id = cr.group_id
        WHERE cr.id = $1 AND cr.archived_at IS NULL AND g.archived_at IS NULL AND g.deleted_at IS NULL`,
      [recommenderId],
    );
    if (!recommender) throw new ApiError(404, "not_found", "Pessoa indicadora não encontrada.");
    if (recommender.group_kind === "personal") {
      if (recommender.owner_user_id !== session.user.id) {
        throw new ApiError(403, "forbidden", "Este nome não pertence ao seu acervo pessoal.");
      }
    } else {
      await requireGroupRole(session.user.id, recommender.group_id, ["owner", "admin"], client);
    }
    const displayName = stringValue(body, "displayName", { min: 1, max: 80 })!;
    await renameRecommenderWithClient(client, session.user.id, recommender.group_id, recommenderId, displayName);
    return { id: recommenderId, displayName };
  });
}

/**
 * Validates an external recommender id against the workspace — the same
 * scoping guarantee `resolveItemRecommender` (challenges/recommender.ts) gives a member id, so a
 * challenge item or catalog item can never point at another workspace's
 * saved name.
 */
/** Whether "who recommended it" may be shown for this workspace — false once its group switched recommendations off. */
async function recommendationsVisible(client: PoolClient, workspaceId: string): Promise<boolean> {
  const group = await oneOrNull<{ recommendations_enabled: boolean }>(
    client, "SELECT recommendations_enabled FROM groups WHERE id = $1", [workspaceId],
  );
  return group?.recommendations_enabled ?? true;
}

/**
 * A group can switch recommendations off ("who suggested this?" is then never
 * asked or shown). Turning an existing recommender back to "nobody" is always
 * allowed; only *setting* one is refused while the switch is off.
 */
export async function assertRecommendationsAllowed(client: PoolClient, groupId: string): Promise<void> {
  const group = await oneOrNull<{ recommendations_enabled: boolean }>(
    client, "SELECT recommendations_enabled FROM groups WHERE id = $1", [groupId],
  );
  if (group && !group.recommendations_enabled) {
    throw new ApiError(409, "recommendations_disabled", "Este grupo desativou as indicações — ative-as nas configurações do grupo para registrar quem indicou.");
  }
}

export async function assertRecommenderInGroup(client: PoolClient, recommenderId: string, groupId: string): Promise<void> {
  const row = await oneOrNull<{ id: string }>(
    client,
    "SELECT id FROM catalog_recommenders WHERE id = $1 AND group_id = $2 AND archived_at IS NULL",
    [recommenderId, groupId],
  );
  if (!row) throw new ApiError(400, "invalid_recommender", "Pessoa indicadora não encontrada neste espaço.");
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
  kind?: string,
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
    ["runtime_minutes", attributes.runtimeMinutes, "runtimeMinutes"],
  ] as const) {
    if (Object.hasOwn(body, key)) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  // The event schedule is replaced as a whole: the four columns move together, and `null` clears them.
  if (Object.hasOwn(body, "scheduledAt")) {
    for (const [column, value] of Object.entries(eventScheduleColumns(attributes.scheduled ?? null))) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  // Catalog-level provenance — "how this item entered the library" — is a
  // separate assignment from any one challenge round's own recommender
  // (`challenge_items.recommended_by_*`, set through items.ts). Distinct body
  // keys on purpose: an edit that touches a round's recommender must never
  // fall through and silently overwrite this one (Phase 6).
  const touchesCatalogRecommender = Object.hasOwn(body, "catalogRecommendedByUserId")
    || Object.hasOwn(body, "catalogRecommendedByExternalId")
    || Object.hasOwn(body, "catalogOriginNote");
  if (touchesCatalogRecommender) {
    const wantedUser = typeof body.catalogRecommendedByUserId === "string" ? body.catalogRecommendedByUserId : "";
    const wantedExternal = typeof body.catalogRecommendedByExternalId === "string" ? body.catalogRecommendedByExternalId : "";
    const wantedNote = typeof body.catalogOriginNote === "string" ? body.catalogOriginNote.trim() : "";
    if ([wantedUser, wantedExternal, wantedNote].filter(Boolean).length > 1) {
      throw new ApiError(400, "invalid_recommender", "Escolha apenas uma origem: membro, nome salvo ou nota — não mais de uma.");
    }
    if (wantedUser || wantedExternal || wantedNote) await assertRecommendationsAllowed(client, groupId);
    let recommendedByUserId: string | null = null;
    let recommendedByExternalId: string | null = null;
    let originNote: string | null = null;
    if (wantedUser) {
      const member = await oneOrNull<{ user_id: string }>(client,
        "SELECT user_id FROM group_members WHERE group_id=$1 AND user_id=$2 AND removed_at IS NULL",
        [groupId, wantedUser]);
      if (!member) throw new ApiError(400, "invalid_recommender", "Quem indicou precisa ser um membro do espaço.");
      recommendedByUserId = wantedUser;
    } else if (wantedExternal) {
      await assertRecommenderInGroup(client, wantedExternal, groupId);
      recommendedByExternalId = wantedExternal;
    } else if (wantedNote) {
      if (wantedNote.length > 200) throw new ApiError(400, "invalid_text", "Nota de origem pode ter no máximo 200 caracteres.");
      originNote = wantedNote;
    }
    params.push(recommendedByUserId, recommendedByExternalId, originNote);
    sets.push(
      `recommended_by_user_id = $${params.length - 2}`,
      `recommended_by_external_id = $${params.length - 1}`,
      `origin_note = $${params.length}`,
    );
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
  // A catalogue item is an independent unit: "remover do catálogo" moves it to
  // the bin (restore / permanent delete via lib/goa/trash.ts), it does not just
  // archive it. The `archived_at` above is its hiding marker.
  await moveToTrash(client, "catalog_item", catalogItemId, actorUserId, { skipMarker: true });
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

/**
 * Removes many catalogue items in one go — how a workspace gets tidied. Each goes to the bin like a
 * single removal (restorable). One that a running challenge still holds is skipped and reported, never
 * an error for the rest; an id that isn't in this catalogue is simply reported too.
 */
async function archiveManyCatalogItems(
  client: PoolClient,
  actorUserId: string,
  workspaceId: string,
  body: Record<string, unknown>,
) {
  const requested = Array.isArray(body.itemIds) ? body.itemIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  const ids = [...new Set(requested)];
  if (!ids.length) throw new ApiError(400, "invalid_body", "Escolha ao menos um item.");
  if (ids.length > 500) throw new ApiError(400, "item_limit", "Remova no máximo 500 itens por vez.");
  const removed: string[] = [];
  const skipped: Array<{ id: string; title: string | null; reason: "in_use" | "not_found" }> = [];
  for (const id of ids) {
    try {
      await archiveCatalogItemWithClient(client, actorUserId, workspaceId, id);
      removed.push(id);
    } catch (error) {
      if (!(error instanceof ApiError) || (error.code !== "catalog_item_in_use" && error.code !== "not_found")) throw error;
      // Both refusals happen before anything is written, so the transaction is still clean.
      const row = await oneOrNull<{ title: string }>(client, "SELECT title FROM catalog_items WHERE id = $1 AND group_id = $2", [id, workspaceId]);
      skipped.push({ id, title: row?.title ?? null, reason: error.code === "catalog_item_in_use" ? "in_use" : "not_found" });
    }
  }
  return { removed: removed.length, removedIds: removed, skipped };
}

export async function archiveManyGroupCatalogItems(session: SessionContext, groupId: string, body: Record<string, unknown>) {
  return inTransaction(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin"]);
    return archiveManyCatalogItems(client, session.user.id, groupId, body);
  });
}

export async function archiveManyPersonalCatalogItems(session: SessionContext, body: Record<string, unknown>) {
  return inTransaction(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    if (!workspaceId) throw new ApiError(404, "not_found", "Acervo não encontrado.");
    return archiveManyCatalogItems(client, session.user.id, workspaceId, body);
  });
}

export async function archivePersonalCatalogItem(session: SessionContext, catalogItemId: string) {
  return inTransaction(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    if (!workspaceId) throw new ApiError(404, "not_found", "Item do acervo não encontrado.");
    return archiveCatalogItemWithClient(client, session.user.id, workspaceId, catalogItemId);
  });
}

/**
 * Called right after a challenge is deleted: archives every catalog item that
 * challenge touched and that no *other* surviving challenge still links to.
 * An item with history in another round (any status — draft, active, or
 * closed) is left alone, since that's exactly the cross-round memory the
 * acervo exists to keep. Best-effort: never blocks the deletion itself.
 */
export async function archiveOrphanedCatalogItemsForChallenge(
  client: PoolClient,
  actorUserId: string,
  groupId: string,
  challengeId: string,
): Promise<void> {
  const orphans = await client.query<{ id: string; title: string; kind: string }>(
    `SELECT DISTINCT ci.id, ci.title, ci.kind
       FROM catalog_items ci
       JOIN challenge_items it ON it.catalog_item_id = ci.id
      WHERE it.challenge_id = $1 AND ci.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM challenge_items other
            JOIN challenges c ON c.id = other.challenge_id
           WHERE other.catalog_item_id = ci.id
             AND other.challenge_id <> $1
             AND other.archived_at IS NULL
             AND c.deleted_at IS NULL
        )`,
    [challengeId],
  );
  for (const item of orphans.rows) {
    await client.query("UPDATE catalog_items SET archived_at = now(), updated_at = now() WHERE id = $1", [item.id]);
    await writeAudit(
      client, groupId, null, actorUserId,
      "catalog.item_archived", "catalog_item", item.id, null, null,
      { title: item.title, kind: item.kind, reason: "challenge_deleted" },
    );
  }
}
