import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { ApiError } from "../../http";
import { challengeAccess } from "../domain/access";
import { writeAudit } from "../domain/audit";

/**
 * SQL that is true when the entry aliased `e` is readable in group-wide numbers: its type is not
 * `until_reveal`, or its item has been revealed, or the round is closed. Every query that turns
 * other people's answers into averages, rankings or quotes adds it — a sealed rating must not leak
 * through a metric before the group reveals it together.
 */
export function unsealedEntrySql(e = "e"): string {
  return `NOT EXISTS (
    SELECT 1 FROM entry_types seal_t
      JOIN challenges seal_c ON seal_c.id = ${e}.challenge_id
      LEFT JOIN challenge_items seal_i ON seal_i.id = ${e}.item_id
     WHERE seal_t.id = ${e}.entry_type_id AND seal_t.visibility_policy = 'until_reveal'
       AND seal_c.status <> 'closed' AND seal_i.revealed_at IS NULL)`;
}

/**
 * Opens an item's sealed answers for the whole group. Any participant who has already answered it
 * may tap Reveal (so nobody peeks without committing first); an admin may too. Revealing twice is a
 * no-op that returns the first reveal.
 */
export async function revealItem(session: SessionContext, challengeId: string, itemId: string) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage && !access.challenge.is_participant) {
      throw new ApiError(403, "forbidden", "Você não participa deste desafio.");
    }
    if (access.challenge.status === "draft") {
      throw new ApiError(409, "challenge_not_active", "O desafio ainda não começou.");
    }
    const item = await oneOrNull<{ revealed_at: Date | null }>(
      client,
      "SELECT revealed_at FROM challenge_items WHERE id = $1 AND challenge_id = $2 AND archived_at IS NULL FOR UPDATE",
      [itemId, challengeId],
    );
    if (!item) throw new ApiError(404, "not_found", "Item não encontrado.");
    if (item.revealed_at) return { itemId, revealedAt: item.revealed_at.toISOString() };
    const answered = await oneOrNull<{ ok: boolean }>(
      client,
      `SELECT true AS ok FROM entries e JOIN entry_types t ON t.id = e.entry_type_id
        WHERE e.challenge_id = $1 AND e.item_id = $2 AND e.participant_user_id = $3
          AND e.deleted_at IS NULL AND t.visibility_policy = 'until_reveal' LIMIT 1`,
      [challengeId, itemId, session.user.id],
    );
    if (!answered && !access.canManage) {
      throw new ApiError(409, "reveal_needs_answer", "Dê a sua nota antes de revelar.");
    }
    const updated = await oneOrNull<{ revealed_at: Date }>(
      client,
      `UPDATE challenge_items SET revealed_at = now(), revealed_by_user_id = $3, updated_at = now()
        WHERE id = $1 AND challenge_id = $2 RETURNING revealed_at`,
      [itemId, challengeId, session.user.id],
    );
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id, "item.revealed", "challenge_item", itemId);
    return { itemId, revealedAt: updated!.revealed_at.toISOString() };
  });
}
