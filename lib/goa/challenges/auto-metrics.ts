import type { PoolClient } from "pg";

import { publicId, semanticKey } from "../domain/shared";

/**
 * Metrics Goa builds by itself for the numbers people record. Whenever a challenge gains a number or
 * rating field that no metric reads yet — at creation, or when someone adds a field later — it gets the
 * obvious views: a rating's average, its ranking by title and by person (and by genre / year when the
 * titles carry them); a number's total, its per-person leaderboard and its record. They are ordinary
 * metrics (`settings.auto` marks where they came from), so the owner edits or deletes them like any other.
 *
 * A field is only ever seeded once (`challenge_fields.settings.autoMetrics`), so deleting an automatic
 * metric is final — it doesn't grow back on the next save.
 */
interface Plan { operation: "average" | "sum" | "max"; groupBy: "none" | "participant" | "item" | "catalog_genre" | "catalog_year"; label: string; suffix: string }

export async function seedFieldMetrics(client: PoolClient, challengeId: string, userId: string): Promise<number> {
  const fields = await client.query<{
    id: string; label: string; kind: string; semantic_key: string; entry_type_id: string; target_policy: string | null; purpose: string | null; is_record: boolean;
  }>(
    `SELECT f.id, f.label, f.kind, f.semantic_key, f.entry_type_id, t.target_policy, t.purpose,
            (t.parent_type_id IS NOT NULL) AS is_record
       FROM challenge_fields f JOIN entry_types t ON t.id = f.entry_type_id AND t.archived_at IS NULL
      WHERE f.challenge_id = $1 AND f.archived_at IS NULL AND f.kind IN ('number', 'rating')
        AND coalesce((f.settings->>'autoMetrics')::boolean, false) = false
        AND coalesce(t.purpose, '') <> 'expectation' AND t.answer_scope = 'individual'
        -- Already read by a metric (a recipe's, or one the owner made): nothing to add.
        AND NOT EXISTS (
          SELECT 1 FROM challenge_metrics m
           WHERE m.challenge_id = f.challenge_id AND m.archived_at IS NULL
             AND (m.field_id = f.id OR m.settings->'fieldIds' ? f.id))
      ORDER BY f.position`,
    [challengeId],
  );
  if (!fields.rows.length) return 0;
  const catalog = await client.query<{ genres: number; years: number }>(
    `SELECT count(DISTINCT ci.main_genre)::int AS genres, count(DISTINCT ci.year)::int AS years
       FROM challenge_items it JOIN catalog_items ci ON ci.id = it.catalog_item_id
      WHERE it.challenge_id = $1 AND it.archived_at IS NULL`,
    [challengeId],
  );
  const { genres, years } = catalog.rows[0] ?? { genres: 0, years: 0 };
  let position = (await client.query<{ next: number }>(
    "SELECT coalesce(max(position), -1)::int + 1 AS next FROM challenge_metrics WHERE challenge_id = $1", [challengeId],
  )).rows[0].next;

  let created = 0;
  for (const field of fields.rows) {
    const byItem = field.target_policy !== "none";
    const plans: Plan[] = field.kind === "rating"
      ? [
          { operation: "average", groupBy: "none", label: `${field.label} — média`, suffix: "media" },
          ...(byItem ? [{ operation: "average" as const, groupBy: "item" as const, label: `${field.label} — ranking`, suffix: "ranking" }] : []),
          { operation: "average", groupBy: "participant", label: `${field.label} — por pessoa`, suffix: "pessoa" },
          ...(byItem && genres >= 2 ? [{ operation: "average" as const, groupBy: "catalog_genre" as const, label: `${field.label} — por gênero`, suffix: "genero" }] : []),
          ...(byItem && years >= 2 ? [{ operation: "average" as const, groupBy: "catalog_year" as const, label: `${field.label} — por ano`, suffix: "ano" }] : []),
        ]
      : [
          // A workout's load isn't something to add up — its story is the best it reached, per exercise.
          ...(field.is_record ? [] : [
            { operation: "sum" as const, groupBy: "none" as const, label: `${field.label} — total`, suffix: "total" },
            { operation: "sum" as const, groupBy: "participant" as const, label: `${field.label} — por pessoa`, suffix: "pessoa" },
          ]),
          { operation: "max", groupBy: "none", label: `${field.label} — recorde`, suffix: "recorde" },
          ...(byItem ? [{ operation: "max" as const, groupBy: "item" as const, label: `${field.label} — recorde por item`, suffix: "recorde_item" }] : []),
          ...(field.is_record ? [{ operation: "max" as const, groupBy: "participant" as const, label: `${field.label} — recorde por pessoa`, suffix: "recorde_pessoa" }] : []),
        ];
    for (const plan of plans) {
      await client.query(
        `INSERT INTO challenge_metrics
          (id, challenge_id, entry_type_id, field_id, semantic_key, label, operation, group_by,
           decimal_places, visible_during_challenge, position, settings, created_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11::jsonb,$12,now(),now())`,
        [publicId(), challengeId, field.entry_type_id, field.id,
          await uniqueKey(client, challengeId, semanticKey(`auto_${field.semantic_key}_${plan.suffix}`, `auto_${position}`)),
          plan.label.slice(0, 120), plan.operation, plan.groupBy, field.kind === "rating" ? 1 : 2, position,
          JSON.stringify({ visibleInResults: true, auto: true }), userId],
      );
      position += 1;
      created += 1;
    }
    await client.query(
      "UPDATE challenge_fields SET settings = settings || '{\"autoMetrics\": true}'::jsonb WHERE id = $1",
      [field.id],
    );
  }
  return created;
}

async function uniqueKey(client: PoolClient, challengeId: string, base: string): Promise<string> {
  const key = base.slice(0, 60);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt ? `${key}_${attempt + 1}` : key;
    const taken = await client.query("SELECT 1 FROM challenge_metrics WHERE challenge_id = $1 AND semantic_key = $2", [challengeId, candidate]);
    if (!taken.rowCount) return candidate;
  }
  return `${key}_${Date.now().toString(36)}`.slice(0, 64);
}
