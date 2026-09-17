import type { PoolClient } from "pg";

import { publicId } from "../domain/shared";
import { computeRankings } from "./rankings";
import { metricsForChallenge } from "./results";

/**
 * Builds the *derived* showcase blocks — every metric with data, personal
 * rankings, affinity, and a handful of the best comments — from whatever the
 * challenge holds right now. Called once, when a round closes, to give the
 * Vitrine a sensible starting shape instead of an empty one.
 *
 * The admin's own copy — any `text` block (headline, summary) — is carried
 * through untouched: a reopen followed by a re-close must never silently drop
 * words the admin wrote, because nothing tells them it happened. There is no
 * auto-generated summary sentence; the Vitrine tab is where that text comes from.
 *
 * `result_blocks.kind` stays `metric | entry_value | text`; a ranking or a
 * per-person profile is a `metric` block whose `value_snapshot` carries a
 * `series` — the renderer decides card vs. list.
 *
 * Metric, ranking, and affinity blocks all carry a null `value_snapshot` on
 * purpose — nothing here is ever frozen, so `resultForChallenge` recomputes
 * each one from current data on every read (see `curateResults`, which does
 * the same). A comment block's `body_snapshot` is required by the schema and
 * kept as a fallback, but `resultForChallenge` already prefers the live
 * `entry_values` text for the same (entry, field) pair — editing a picked
 * comment afterward shows up without rerunning this.
 */
export async function generateShowcase(
  client: PoolClient,
  challengeId: string,
  userId: string,
): Promise<void> {
  const kept = await client.query<{ heading: string | null; body_snapshot: string | null }>(
    "SELECT heading, body_snapshot FROM result_blocks WHERE challenge_id=$1 AND kind='text' ORDER BY position",
    [challengeId],
  );
  await client.query("DELETE FROM result_blocks WHERE challenge_id=$1", [challengeId]);

  const metrics = await metricsForChallenge(client, challengeId);

  let position = 0;
  const insertText = (heading: string, body: string) =>
    client.query(
      `INSERT INTO result_blocks
        (id,challenge_id,kind,heading,body_snapshot,position,visible,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,'text',$3,$4,$5,true,$6,now(),now())`,
      [publicId(), challengeId, heading, body, position++, userId],
    );

  for (const block of kept.rows) {
    if (block.body_snapshot && block.body_snapshot.trim()) {
      await insertText(block.heading ?? "summary", block.body_snapshot);
    }
  }

  for (const metric of metrics) {
    if (metric.visibleInResults === false) continue;
    if (!metricHasData(metric)) continue;
    await client.query(
      `INSERT INTO result_blocks
        (id,challenge_id,kind,metric_id,heading,value_snapshot,position,visible,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,'metric',$3,$4,NULL,$5,true,$6,now(),now())`,
      [publicId(), challengeId, metric.id as string, metric.label as string, position++, userId],
    );
  }

  // Personal rankings + affinity (V1 §9–11) — computed once here only to
  // decide whether there's anything worth a block (a solo round has no
  // ranking to show); the block itself carries no frozen value.
  const { personal, affinity } = await computeRankings(client, challengeId);
  if (personal.length > 1) {
    await client.query(
      `INSERT INTO result_blocks
        (id,challenge_id,kind,heading,value_snapshot,position,visible,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,'ranking',$3,NULL,$4,true,$5,now(),now())`,
      [publicId(), challengeId, "Rankings pessoais", position++, userId],
    );
  }
  if (affinity && affinity.pairs.length > 0) {
    await client.query(
      `INSERT INTO result_blocks
        (id,challenge_id,kind,heading,value_snapshot,position,visible,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,'affinity',$3,NULL,$4,true,$5,now(),now())`,
      [publicId(), challengeId, "Afinidades", position++, userId],
    );
  }

  for (const comment of await pickComments(client, challengeId)) {
    await client.query(
      `INSERT INTO result_blocks
        (id,challenge_id,kind,source_entry_id,source_field_id,heading,body_snapshot,
         position,visible,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,'entry_value',$3,$4,$5,$6,$7,true,$8,now(),now())`,
      [publicId(), challengeId, comment.entryId, comment.fieldId, comment.itemTitle, comment.text,
        position++, userId],
    );
  }
}

/**
 * Whether a computed metric has anything worth showing: a non-null scalar, or a
 * series with at least one non-null row. An all-"small sample" block is noise.
 */
function metricHasData(metric: Record<string, unknown>): boolean {
  const series = metric.series;
  if (Array.isArray(series)) {
    return series.some((row) => (row as { value: number | null }).value !== null);
  }
  return metric.value !== null && metric.value !== undefined;
}

interface PickedComment {
  entryId: string;
  fieldId: string;
  itemTitle: string | null;
  text: string;
}

/** Up to 6 comments, the longest one per item, longest overall first. */
async function pickComments(client: PoolClient, challengeId: string): Promise<PickedComment[]> {
  const rows = await client.query<{
    entry_id: string; field_id: string; item_title: string | null; text: string;
  }>(
    `SELECT DISTINCT ON (coalesce(e.item_id, e.id))
            ev.entry_id, ev.field_id, coalesce(ci.title, cc.title) AS item_title,
            btrim(ev.text_value) AS text
       FROM entry_values ev
       JOIN entries e ON e.id = ev.entry_id
       JOIN challenge_fields f ON f.id = ev.field_id AND f.kind = 'text'
       LEFT JOIN challenge_items ci ON ci.id = e.item_id
       LEFT JOIN challenge_checkpoints cc ON cc.challenge_id = e.challenge_id
        AND (cc.starts_at AT TIME ZONE 'America/Sao_Paulo')::date = e.occurred_on
        AND cc.archived_at IS NULL
      WHERE e.challenge_id = $1 AND e.deleted_at IS NULL
        AND ev.text_value IS NOT NULL AND char_length(btrim(ev.text_value)) >= 20
      ORDER BY coalesce(e.item_id, e.id), char_length(btrim(ev.text_value)) DESC`,
    [challengeId],
  );
  return rows.rows
    .map((row) => ({ entryId: row.entry_id, fieldId: row.field_id, itemTitle: row.item_title, text: row.text }))
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 6);
}
