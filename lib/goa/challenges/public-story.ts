import type { PoolClient } from "pg";

import { storyFromChallenge, type StoryInput } from "../../../app/goa/story/model";
import type { ChallengeDetail, Entry } from "../../../app/goa/types";
import { dateKeyInSaoPaulo } from "../../../app/goa/utils";
import { buildChallengeDetail, type DetailChallengeRow } from "./detail";
import { entryValues } from "./entries";
import { unsealedEntrySql } from "./reveal";

/**
 * "The thread" for a PUBLIC page (a published results link, a template preview, the front page), built on
 * the server so nothing private ever reaches the browser:
 *
 *  · names follow the showcase's rules — anonymised publication, or no consent, or no longer in the
 *    challenge → "Participante N" (numbered by real name, so it's stable); real user ids never leave: each
 *    person is an opaque per-challenge key;
 *  · only answers the group could already see — never `author_only`, never a sealed rating before its
 *    reveal, never an `after_close` one while the round is still running;
 *  · no words at all — comments and notes are dropped. The old showcase only ever showed comments the
 *    owner picked one by one; with no picking step left, none go public by default.
 */
export async function publicStoryInput(client: PoolClient, row: DetailChallengeRow): Promise<StoryInput> {
  const detail = await buildChallengeDetail(client, row, { userId: null, role: null, isParticipant: false }, { participants: [], result: null });
  const participants = await client.query<{ id: string; display_name: string; name_consent: boolean }>(
    `SELECT u.id, u.display_name, cp.name_consent FROM challenge_participants cp JOIN users u ON u.id = cp.user_id
      WHERE cp.challenge_id = $1 AND cp.removed_at IS NULL ORDER BY u.display_name`,
    [row.id],
  );
  const closed = row.status === "closed";
  const entries = await client.query<{
    id: string; item_id: string | null; entry_type_id: string; parent_entry_id: string | null;
    participant_user_id: string | null; occurred_on: string | null; submitted_at: Date;
  }>(
    `SELECT e.id, e.item_id, e.entry_type_id, e.parent_entry_id, e.participant_user_id,
            e.occurred_on::text AS occurred_on, e.submitted_at
       FROM entries e JOIN entry_types t ON t.id = e.entry_type_id
      WHERE e.challenge_id = $1 AND e.deleted_at IS NULL AND e.participant_user_id IS NOT NULL
        AND t.visibility_policy <> 'author_only'
        AND (t.visibility_policy <> 'after_close' OR $2::boolean)
        AND ${unsealedEntrySql("e")}`,
    [row.id, closed],
  );

  // Everyone who answered, current roster first; anyone else (who left) is always masked.
  const roster = new Map(participants.rows.map((person) => [person.id, person]));
  const answered = [...new Set(entries.rows.map((entry) => entry.participant_user_id!))];
  const everyone = [...new Set([...participants.rows.map((person) => person.id), ...answered])];
  const masked = (id: string) => row.results_anon || !roster.get(id)?.name_consent;
  const extraNames = new Map<string, string>();
  const missing = everyone.filter((id) => !roster.has(id));
  if (missing.length) {
    const extra = await client.query<{ id: string; display_name: string }>("SELECT id, display_name FROM users WHERE id = ANY($1::text[])", [missing]);
    for (const person of extra.rows) extraNames.set(person.id, person.display_name);
  }
  const realName = (id: string) => roster.get(id)?.display_name ?? extraNames.get(id) ?? "";
  const labels = new Map(
    everyone.filter(masked).sort((a, b) => realName(a).localeCompare(realName(b), "pt-BR")).map((id, index) => [id, `Participante ${index + 1}`] as const),
  );
  const keys = new Map<string, string>();
  for (const id of everyone) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${row.id}:${id}`));
    keys.set(id, "p_" + Array.from(new Uint8Array(digest)).slice(0, 6).map((byte) => byte.toString(16).padStart(2, "0")).join(""));
  }
  const nameOf = (id: string) => labels.get(id) ?? realName(id);

  const values = await entryValues(client, entries.rows.map((entry) => entry.id));
  const publicEntries: Entry[] = entries.rows.map((entry) => ({
    id: entry.id,
    itemId: entry.item_id,
    entryTypeId: entry.entry_type_id,
    parentEntryId: entry.parent_entry_id,
    userId: keys.get(entry.participant_user_id!)!,
    participantName: nameOf(entry.participant_user_id!),
    occurredOn: entry.occurred_on,
    submittedAt: entry.submitted_at.toISOString(),
    updatedAt: entry.submitted_at.toISOString(),
    values: values.get(entry.id) ?? {},
  } as Entry));
  const people = everyone.filter((id) => answered.includes(id) || roster.has(id))
    .map((id) => ({ id: keys.get(id)!, userId: keys.get(id)!, name: nameOf(id) }));

  const input = storyFromChallenge({ ...(detail as unknown as ChallengeDetail), participants: people }, publicEntries, dateKeyInSaoPaulo(new Date()));
  // No words go public: drop every comment and note, and the entry ids they rode on.
  return {
    ...input,
    ratings: input.ratings.map((rating) => ({ ...rating, comment: null })),
    days: input.days.map((day) => ({ ...day, note: null })),
  };
}
