import type { PoolClient } from "pg";

import { oneOrNull } from "../../db";
import { ApiError } from "../../http";
import { LIMITS } from "../../limits";

/** Serialize changes that consume membership slots, even across different groups. */
export async function lockGroupMemberships(client: PoolClient, userIds: readonly string[]): Promise<void> {
  await client.query("SELECT id FROM users WHERE id = ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE", [userIds]);
}

/** Called after locking the affected accounts. An existing active membership needs no new slot. */
export async function assertUnderMembershipCap(
  client: PoolClient,
  userIds: readonly string[],
  { existingGroupId, restoring }: { existingGroupId?: string; restoring?: boolean } = {},
): Promise<void> {
  const limit = LIMITS.groupsPerMember;
  const full = await oneOrNull<{ user_id: string }>(
    client,
    `SELECT gm.user_id FROM group_members gm
       JOIN groups g ON g.id = gm.group_id AND g.kind = 'standard'
        AND g.deleted_at IS NULL AND g.archived_at IS NULL
      WHERE gm.user_id = ANY($1::text[]) AND gm.removed_at IS NULL
      GROUP BY gm.user_id
      HAVING count(*) >= $2 AND ($3::text IS NULL OR NOT bool_or(g.id = $3))
      LIMIT 1`,
    [userIds, limit, existingGroupId ?? null],
  );
  if (!full) return;
  const message = restoring
    ? `Uma pessoa deste grupo já atingiu o limite de ${limit} grupos. Libere uma vaga antes de restaurá-lo.`
    : `Você já participa de ${limit} grupos, o máximo permitido.`;
  throw new ApiError(403, "group_membership_limit", message);
}
