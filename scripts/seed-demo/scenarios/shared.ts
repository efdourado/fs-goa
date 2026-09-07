import { withClient } from "../../../lib/db";

export const ROLES = ["owner", "admin", "participant"] as const;
export type Role = (typeof ROLES)[number];

/** `n` days after (or before, if negative) an ISO date, back to `YYYY-MM-DD`. */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A finished window of `days` that ends `endGap` days before today (inclusive count). */
export function pastWindow(days: number, endGap = 3): { startsOn: string; endsOn: string } {
  const endsOn = addDays(new Date().toISOString().slice(0, 10), -endGap);
  return { startsOn: addDays(endsOn, -(days - 1)), endsOn };
}

export interface ChallengeShape {
  /** entry type id by `purpose` (rating / expectation / progress / completion / checkin). */
  typeByPurpose: Map<string, string>;
  /** field id by `<purpose>.<semantic_key>` and, for the primary type, by bare key. */
  fieldId: (key: string, purpose?: string) => string;
  /** item id by title. */
  itemId: (title: string) => string;
}

/**
 * Backdates a challenge's `activated_at` / `closed_at` so a run that took seconds
 * looks like it spanned its period — needed for day-based completion rate and any
 * "closed N days ago" copy. Timestamps only; every content row still went through
 * the real services.
 */
export async function backdateLifecycle(challengeId: string, activatedOn: string, closedOn: string): Promise<void> {
  await withClient((client) =>
    client.query(
      `UPDATE challenges
          SET activated_at = ($2::date + time '09:00') AT TIME ZONE time_zone,
              closed_at    = ($3::date + time '21:00') AT TIME ZONE time_zone,
              updated_at   = now()
        WHERE id = $1`,
      [challengeId, activatedOn, closedOn],
    ),
  );
}

/** Reads back the ids the domain generated for a freshly created challenge. */
export async function readShape(challengeId: string): Promise<ChallengeShape> {
  return withClient(async (client) => {
    const items = await client.query<{ id: string; title: string }>(
      "SELECT id, title FROM challenge_items WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position",
      [challengeId],
    );
    const rows = await client.query<{
      type_id: string; purpose: string; is_primary: boolean; field_id: string | null; field_key: string | null;
    }>(
      `SELECT et.id AS type_id, et.purpose, et.is_primary,
              cf.id AS field_id, cf.semantic_key AS field_key
         FROM entry_types et
         LEFT JOIN challenge_fields cf ON cf.entry_type_id = et.id AND cf.archived_at IS NULL
        WHERE et.challenge_id = $1 AND et.archived_at IS NULL`,
      [challengeId],
    );
    const typeByPurpose = new Map<string, string>();
    const byQualified = new Map<string, string>();
    const byBareKey = new Map<string, string>();
    for (const row of rows.rows) {
      typeByPurpose.set(row.purpose, row.type_id);
      if (row.field_id && row.field_key) {
        byQualified.set(`${row.purpose}.${row.field_key}`, row.field_id);
        if (row.is_primary) byBareKey.set(row.field_key, row.field_id);
      }
    }
    const itemsByTitle = new Map(items.rows.map((row) => [row.title, row.id]));
    return {
      typeByPurpose,
      fieldId: (key, purpose) => {
        const id = purpose ? byQualified.get(`${purpose}.${key}`) : byBareKey.get(key) ?? byQualified.get(key);
        if (!id) throw new Error(`campo "${purpose ? `${purpose}.` : ""}${key}" não encontrado no desafio`);
        return id;
      },
      itemId: (title) => {
        const id = itemsByTitle.get(title);
        if (!id) throw new Error(`item "${title}" não encontrado no desafio`);
        return id;
      },
    };
  });
}
