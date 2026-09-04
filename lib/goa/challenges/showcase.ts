import type { PoolClient } from "pg";

import { oneOrNull } from "../../db";
import { publicId } from "../domain/shared";
import { metricsForChallenge } from "./results";

/**
 * Builds the opinionated default showcase — a hero, the analysis metrics as
 * blocks (each with a frozen snapshot), and a handful of the best comments — from
 * whatever the challenge already holds. Called when a round closes and whenever
 * the admin hits "regenerate"; `curateResults` is the manual override on top.
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
  await client.query("DELETE FROM result_blocks WHERE challenge_id=$1", [challengeId]);

  const metrics = await metricsForChallenge(client, challengeId);
  const summary = await buildSummary(client, challengeId, metrics);

  let position = 0;
  const insertText = (heading: string, body: string) =>
    client.query(
      `INSERT INTO result_blocks
        (id,challenge_id,kind,heading,body_snapshot,position,visible,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,'text',$3,$4,$5,true,$6,now(),now())`,
      [publicId(), challengeId, heading, body, position++, userId],
    );

  // Deliberately no title-based headline: the cover above the showcase already
  // shows the challenge title in full, and regenerating used to silently
  // overwrite a headline the admin had cleared on purpose. The admin types one
  // if they want one; the summary line still generates on its own.
  if (summary) await insertText("summary", summary);

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

async function buildSummary(
  client: PoolClient,
  challengeId: string,
  metrics: Array<Record<string, unknown>>,
): Promise<string | null> {
  const counts = await oneOrNull<{ participants: number; items: number; kind: string | null }>(
    client,
    `SELECT
       (SELECT count(*)::int FROM challenge_participants WHERE challenge_id=$1 AND removed_at IS NULL) AS participants,
       (SELECT count(*)::int FROM challenge_items WHERE challenge_id=$1 AND archived_at IS NULL) AS items,
       (SELECT ci.kind FROM catalog_items ci
          JOIN challenge_items it ON it.catalog_item_id = ci.id
         WHERE it.challenge_id=$1 LIMIT 1) AS kind`,
    [challengeId],
  );
  if (!counts) return null;
  const noun = counts.items === 0 ? null : counts.kind === "book" ? "livros" : counts.kind === "film" ? "filmes" : "itens";
  const parts: string[] = [];
  if (noun) {
    parts.push(`${counts.participants} pessoa(s) registraram ${counts.items} ${noun}.`);
  } else {
    parts.push(`${counts.participants} pessoa(s) participaram.`);
  }

  const average = metrics.find((m) => m.operation === "average" && !m.series && m.value !== null);
  if (average) parts.push(`Nota média ${average.formattedValue}.`);

  const ranking = metrics.find((m) => m.operation === "bayesian_average" && Array.isArray(m.series));
  const top = (ranking?.series as Array<{ label: string; value: number | null }> | undefined)?.find((s) => s.value !== null);
  if (top) parts.push(`No topo: ${top.label} (${top.value}).`);

  const polar = metrics.find((m) => m.operation === "spread" && Array.isArray(m.series));
  const mostDivisive = (polar?.series as Array<{ label: string; value: number | null }> | undefined)?.find((s) => s.value !== null);
  if (mostDivisive) parts.push(`Mais dividiu o grupo: ${mostDivisive.label}.`);

  return parts.join(" ");
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
