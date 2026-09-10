import type { PoolClient } from "pg";

import { publicId } from "../domain/shared";
import { computeRankings } from "./rankings";
import { metricsForChallenge } from "./results";

/**
 * Rebuilds the *derived* showcase blocks — the analysis metrics (each with a
 * frozen snapshot), personal rankings, and a handful of the best comments — from
 * whatever the challenge holds now. Called when a round closes and whenever the
 * admin hits "regenerate".
 *
 * The admin's own copy — any `text` block (headline, summary) — is carried
 * through untouched: a reopen, a re-close, or a "regenerate" must never silently
 * drop words the admin wrote, because nothing tells them it happened. There is no
 * auto-generated summary sentence; the Vitrine tab is where that text comes from.
 *
 * `result_blocks.kind` stays `metric | entry_value | text`; a ranking or a
 * per-person profile is a `metric` block whose `value_snapshot` carries a
 * `series` — the renderer decides card vs. list.
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
       VALUES ($1,$2,'metric',$3,$4,$5::jsonb,$6,true,$7,now(),now())`,
      [publicId(), challengeId, metric.id as string, metric.label as string,
        JSON.stringify(metric), position++, userId],
    );
  }

  // Personal rankings + affinity (V1 §9–11). Frozen here like every other block;
  // an empty result (solo round, no shared items) simply isn't inserted.
  const { personal, affinity } = await computeRankings(client, challengeId);
  if (personal.length > 1) {
    await client.query(
      `INSERT INTO result_blocks
        (id,challenge_id,kind,heading,value_snapshot,position,visible,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,'ranking',$3,$4::jsonb,$5,true,$6,now(),now())`,
      [publicId(), challengeId, "Rankings pessoais", JSON.stringify({ personal }), position++, userId],
    );
  }
  if (affinity && affinity.pairs.length > 0) {
    await client.query(
      `INSERT INTO result_blocks
        (id,challenge_id,kind,heading,value_snapshot,position,visible,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,'affinity',$3,$4::jsonb,$5,true,$6,now(),now())`,
      [publicId(), challengeId, "Afinidades", JSON.stringify(affinity), position++, userId],
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
