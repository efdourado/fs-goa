import type { PoolClient } from "pg";

/**
 * Physical deletion of a challenge / group subtree, in FK-dependency order (the
 * schema uses `RESTRICT` almost everywhere, so `ON DELETE CASCADE` cannot be
 * relied on). Shared by the user-facing bin (`lib/goa/trash.ts`) and permanent
 * account removal (`lib/auth.ts`) — kept in its own leaf module so neither of
 * those has to import the other.
 */

export async function purgeChallengeRows(client: PoolClient, challengeId: string): Promise<void> {
  await client.query(
    `DELETE FROM group_invites WHERE id IN (SELECT invite_id FROM invite_challenge_targets WHERE challenge_id=$1)`,
    [challengeId],
  );
  await client.query("DELETE FROM result_blocks WHERE challenge_id=$1", [challengeId]);
  await client.query("DELETE FROM entry_values WHERE challenge_id=$1", [challengeId]);
  await client.query(
    "DELETE FROM trash_items WHERE entity_kind='entry' AND entity_id IN (SELECT id FROM entries WHERE challenge_id=$1)",
    [challengeId],
  );
  await client.query("DELETE FROM entries WHERE challenge_id=$1", [challengeId]);
  // Metrics reference fields and entry types (RESTRICT), so they must go first.
  await client.query("DELETE FROM challenge_metrics WHERE challenge_id=$1", [challengeId]);
  await client.query("DELETE FROM challenge_items WHERE challenge_id=$1", [challengeId]);
  await client.query(
    "DELETE FROM field_options WHERE field_id IN (SELECT id FROM challenge_fields WHERE challenge_id=$1)",
    [challengeId],
  );
  await client.query("DELETE FROM challenge_fields WHERE challenge_id=$1", [challengeId]);
  await client.query("DELETE FROM challenge_participants WHERE challenge_id=$1", [challengeId]);
  await client.query("DELETE FROM challenge_checkpoints WHERE challenge_id=$1", [challengeId]);
  await client.query("DELETE FROM entry_types WHERE challenge_id=$1", [challengeId]);
  await client.query(
    "DELETE FROM challenge_duplications WHERE source_challenge_id=$1 OR target_challenge_id=$1",
    [challengeId],
  );
  await client.query("DELETE FROM audit_events WHERE challenge_id=$1", [challengeId]);
  await client.query("DELETE FROM trash_items WHERE entity_kind='challenge' AND entity_id=$1", [challengeId]);
  await client.query("DELETE FROM challenges WHERE id=$1", [challengeId]);
}

export async function purgeGroupRows(client: PoolClient, groupId: string): Promise<void> {
  const challenges = await client.query<{ id: string }>("SELECT id FROM challenges WHERE group_id=$1", [groupId]);
  for (const c of challenges.rows) await purgeChallengeRows(client, c.id);
  await client.query(
    "DELETE FROM invite_redemptions WHERE invite_id IN (SELECT id FROM group_invites WHERE group_id=$1)",
    [groupId],
  );
  await client.query("DELETE FROM group_invites WHERE group_id=$1", [groupId]);
  await client.query("DELETE FROM catalog_attribute_values WHERE group_id=$1", [groupId]);
  await client.query("DELETE FROM catalog_attribute_defs WHERE group_id=$1", [groupId]);
  await client.query(
    "DELETE FROM trash_items WHERE entity_kind='catalog_item' AND entity_id IN (SELECT id FROM catalog_items WHERE group_id=$1)",
    [groupId],
  );
  await client.query("DELETE FROM catalog_items WHERE group_id=$1", [groupId]);
  await client.query("DELETE FROM group_member_requests WHERE group_id=$1", [groupId]);
  await client.query("DELETE FROM audit_events WHERE group_id=$1", [groupId]);
  await client.query("DELETE FROM group_members WHERE group_id=$1", [groupId]);
  await client.query(
    "DELETE FROM trash_items WHERE (entity_kind='group' AND entity_id=$1) OR (scope_type='group' AND scope_id=$1)",
    [groupId],
  );
  await client.query("DELETE FROM groups WHERE id=$1", [groupId]);
}
