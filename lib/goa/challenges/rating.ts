import type { PoolClient } from "pg";

/**
 * "The rating" of a challenge — what Today, the catalogue and the per-person rankings mean by an item's rating.
 * A challenge can name one of its metrics as its rating (`settings.isRating`): an average over rating fields,
 * one field or several combined, and then every one of those places reads each entry's rating the way that
 * metric does — the average of its fields. With none named, each keeps its older default.
 */

/** Rating fields a metric may stand for "the rating" with — an average (plain or steadied) of rating fields only. */
export const RATING_METRIC_OPERATIONS = new Set(["average", "bayesian_average"]);

/** SQL: the text[] of fields the challenge's rating metric averages, or NULL when it has none. */
export function ratingFieldsSql(challengeAlias: string): string {
  return `(SELECT ARRAY(SELECT jsonb_array_elements_text(coalesce(m.settings->'fieldIds', jsonb_build_array(m.field_id))))
             FROM challenge_metrics m
            WHERE m.challenge_id = ${challengeAlias}.id AND m.archived_at IS NULL AND m.settings->>'isRating' = 'true'
            ORDER BY m.updated_at DESC LIMIT 1)`;
}

/**
 * SQL: one entry's rating — the average of the rating metric's fields, or, with no rating metric, of every rating
 * field it answered. NULL when it answered none of them.
 */
export function entryRatingSql(entryAlias: string, challengeAlias: string): string {
  return `(SELECT avg(rev.number_scaled::float8 / (10 ^ rf.number_scale))
             FROM entry_values rev
             JOIN challenge_fields rf ON rf.id = rev.field_id AND rf.kind = 'rating'
            WHERE rev.entry_id = ${entryAlias}.id AND rev.number_scaled IS NOT NULL
              AND (${ratingFieldsSql(challengeAlias)} IS NULL OR rev.field_id = ANY((${ratingFieldsSql(challengeAlias)})::text[])))`;
}

/** The fields the challenge's rating metric averages, or null when it names none. */
export async function challengeRatingFieldIds(client: Pick<PoolClient, "query">, challengeId: string): Promise<string[] | null> {
  const row = (await client.query<{ field_ids: string[] | null }>(
    `SELECT ${ratingFieldsSql("c")} AS field_ids FROM challenges c WHERE c.id = $1`,
    [challengeId],
  )).rows[0];
  return row?.field_ids?.length ? row.field_ids : null;
}
