import type { PoolClient } from "pg";

import {
  eraOf,
  historiesByPerson,
  lengthOf,
  scoreWithHistories,
  type NormalisedRating,
  type TargetRating,
  type TitleTraits,
} from "../../../app/goa/score";
import { ratingFieldsSql } from "./rating";
import { unsealedEntrySql } from "./reveal";

/**
 * The Goa score on the server (formula in `app/goa/score.ts`): reads every rating given in a group — each entry's
 * rating as its challenge defines it, normalised per field so /5 and /10 mix — and scores titles inside their
 * context. A context is one library (the catalogue item's group + kind; a personal space's libraries are the
 * person's own); an item with no catalogue entry only has its own challenge as context.
 */

interface ScoreRow extends NormalisedRating {
  challengeId: string;
  itemId: string;
  entryTypeId: string;
  catalogItemId: string | null;
  kind: string | null;
  nominated: boolean;
  /** Who may see this rating besides its author: its type's visibility policy, and whether the challenge closed. */
  visibility: string;
  closed: boolean;
  lo: number;
  hi: number;
  traits: TitleTraits;
}

async function groupRatingRows(client: Pick<PoolClient, "query">, groupId: string): Promise<ScoreRow[]> {
  const result = await client.query<{
    challenge_id: string; item_id: string; entry_type_id: string; catalog_item_id: string | null; kind: string | null; person_id: string;
    value: number; lo: number; hi: number; nominated: boolean; visibility: string; closed: boolean;
    genre: string | null; author: string | null; year: number | null; runtime: number | null; pages: number | null;
  }>(
    `SELECT c.id AS challenge_id, it.id AS item_id, e.entry_type_id, cat.id AS catalog_item_id, cat.kind, e.participant_user_id AS person_id,
            er.value, er.lo, er.hi, (it.recommended_by_user_id = e.participant_user_id) IS TRUE AS nominated,
            t.visibility_policy AS visibility, c.status = 'closed' AS closed,
            cat.main_genre AS genre, cat.author, cat.year, cat.runtime_minutes AS runtime, cat.page_count AS pages
       FROM challenges c
       JOIN challenge_items it ON it.challenge_id = c.id AND it.archived_at IS NULL
       LEFT JOIN catalog_items cat ON cat.id = it.catalog_item_id
       JOIN entries e ON e.item_id = it.id AND e.deleted_at IS NULL AND e.participant_user_id IS NOT NULL
        AND ${unsealedEntrySql("e")}
       JOIN entry_types t ON t.id = e.entry_type_id AND t.challenge_id = c.id
        AND t.purpose IN ('rating', 'completion') AND t.answer_scope = 'individual'
       CROSS JOIN LATERAL (
         SELECT avg((rev.number_scaled - rf.min_scaled)::float8 / (rf.max_scaled - rf.min_scaled)) AS value,
                avg(rf.min_scaled::float8 / (10 ^ rf.number_scale)) AS lo,
                avg(rf.max_scaled::float8 / (10 ^ rf.number_scale)) AS hi
           FROM entry_values rev
           JOIN challenge_fields rf ON rf.id = rev.field_id AND rf.kind = 'rating'
          WHERE rev.entry_id = e.id AND rev.number_scaled IS NOT NULL AND rf.max_scaled > rf.min_scaled
            AND (${ratingFieldsSql("c")} IS NULL OR rev.field_id = ANY((${ratingFieldsSql("c")})::text[]))
       ) er
      WHERE c.group_id = $1 AND c.deleted_at IS NULL AND c.status <> 'draft' AND er.value IS NOT NULL`,
    [groupId],
  );
  return result.rows.map((row) => ({
    challengeId: row.challenge_id,
    itemId: row.item_id,
    entryTypeId: row.entry_type_id,
    catalogItemId: row.catalog_item_id,
    kind: row.kind,
    personId: row.person_id,
    titleKey: row.catalog_item_id ?? row.item_id,
    value: Math.max(0, Math.min(1, row.value)),
    lo: row.lo,
    hi: row.hi,
    nominated: row.nominated,
    visibility: row.visibility,
    closed: row.closed,
    traits: { genre: row.genre, director: row.author, era: eraOf(row.year), length: lengthOf(row.runtime, row.pages) },
  }));
}

/** Everything rated in a group, split into contexts, ready to score any title in it. */
class GroupScores {
  private readonly traits = new Map<string, TitleTraits>();
  private readonly histories = new Map<string, Map<string, Map<string, number>>>();

  constructor(readonly rows: ScoreRow[]) {
    const contexts = new Map<string, ScoreRow[]>();
    for (const row of rows) {
      this.traits.set(row.titleKey, row.traits);
      const key = GroupScores.contextOf(row);
      contexts.set(key, [...(contexts.get(key) ?? []), row]);
    }
    for (const [key, list] of contexts) this.histories.set(key, historiesByPerson(list));
  }

  static contextOf(row: Pick<ScoreRow, "kind" | "challengeId">): string {
    return row.kind ? `library:${row.kind}` : `challenge:${row.challengeId}`;
  }

  /** One title's score on 0–1 from its ratings `target` (all from one context). */
  score(target: ScoreRow[]): number | null {
    if (!target.length) return null;
    const history = this.histories.get(GroupScores.contextOf(target[0]));
    const rows: TargetRating[] = target.map((row) => ({ personId: row.personId, titleKey: row.titleKey, value: row.value, nominated: row.nominated }));
    return scoreWithHistories(rows, (personId) => history?.get(personId), (key) => this.traits.get(key) ?? {});
  }
}

/** Back from 0–1 to one challenge's scale (its rows share their fields, so their ranges agree). */
function onScale(score: number, rows: ScoreRow[]): number {
  const lo = rows.reduce((sum, row) => sum + row.lo, 0) / rows.length;
  const hi = rows.reduce((sum, row) => sum + row.hi, 0) / rows.length;
  return lo + score * (hi - lo);
}

function byKey<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return groups;
}

/**
 * The ratings `viewerId` may see (null: only what anyone may) — applied to everything, history included, before
 * any score is calculated: a hidden rating mustn't move a score through someone's usual or their taste either.
 */
export function visibleTo<T extends Pick<ScoreRow, "personId" | "itemId" | "entryTypeId" | "visibility" | "closed">>(rows: T[], viewerId: string | null): T[] {
  // after_own opens a rating once the viewer answered the same form on the same item — the rule the entries list uses.
  const answered = new Set(rows.filter((row) => row.personId === viewerId).map((row) => `${row.entryTypeId}:${row.itemId}`));
  return rows.filter((row) => row.personId === viewerId || (
    row.visibility === "after_own" ? answered.has(`${row.entryTypeId}:${row.itemId}`)
      : row.visibility === "after_close" ? row.closed
        : row.visibility !== "author_only"));
}

/** A score on the rating's scale, and how many ratings of this title went into it. */
export interface ItemScoreValue { value: number; count: number }

/**
 * Each item's score in one challenge, on the challenge's rating scale (unrounded) — what its ranking and podium are
 * ordered by — from the ratings `viewerId` may see. Items nobody rated are absent.
 */
export async function challengeItemScores(client: Pick<PoolClient, "query">, challengeId: string, viewerId: string | null): Promise<Record<string, ItemScoreValue>> {
  const groupId = (await client.query<{ group_id: string }>("SELECT group_id FROM challenges WHERE id = $1", [challengeId])).rows[0]?.group_id;
  if (!groupId) return {};
  const scores = new GroupScores(visibleTo(await groupRatingRows(client, groupId), viewerId));
  const result: Record<string, ItemScoreValue> = {};
  for (const [itemId, rows] of byKey(scores.rows.filter((row) => row.challengeId === challengeId), (row) => row.itemId)) {
    const score = scores.score(rows);
    if (score !== null) result[itemId] = { value: onScale(score, rows), count: rows.length };
  }
  return result;
}

/** The catalogue shows every rating out of five (its ring says so), whatever scale each challenge used. */
export const CATALOG_SCALE = 5;

/**
 * The catalogue's view, from the ratings `viewerId` may see: every library title's score over all its challenges,
 * out of `CATALOG_SCALE` — plus the score each challenge gave it (`byRound`, keyed by `roundKey`).
 */
export async function catalogScores(client: Pick<PoolClient, "query">, groupId: string, viewerId: string | null): Promise<{
  byCatalogItem: Map<string, { score: number; count: number }>;
  byRound: Map<string, { score: number; count: number }>;
}> {
  const rows = visibleTo(await groupRatingRows(client, groupId), viewerId);
  const scores = new GroupScores(rows);
  const collect = (list: ScoreRow[], keyOf: (row: ScoreRow) => string) => {
    const out = new Map<string, { score: number; count: number }>();
    for (const [key, group] of byKey(list, keyOf)) {
      const score = scores.score(group);
      if (score !== null) out.set(key, { score: score * CATALOG_SCALE, count: group.length });
    }
    return out;
  };
  const inLibrary = rows.filter((row) => row.catalogItemId);
  return {
    byCatalogItem: collect(inLibrary, (row) => row.catalogItemId!),
    byRound: collect(inLibrary, (row) => roundKey(row.challengeId, row.catalogItemId!)),
  };
}

export const roundKey = (challengeId: string, catalogItemId: string) => `${challengeId}:${catalogItemId}`;

/** The fields a challenge's scores read: its rating metric's, or every individual rating field. */
export async function scoreFieldIds(client: Pick<PoolClient, "query">, challengeId: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT f.id FROM challenge_fields f
       JOIN challenges c ON c.id = f.challenge_id
       JOIN entry_types t ON t.id = f.entry_type_id
      WHERE f.challenge_id = $1 AND f.archived_at IS NULL AND f.kind = 'rating'
        AND t.purpose IN ('rating', 'completion') AND t.answer_scope = 'individual'
        AND (${ratingFieldsSql("c")} IS NULL OR f.id = ANY((${ratingFieldsSql("c")})::text[]))`,
    [challengeId],
  );
  return result.rows.map((row) => row.id);
}
