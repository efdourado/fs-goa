import type { PoolClient } from "pg";

import { requireGroupRole, type GroupRole, type SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { ApiError, stringValue } from "../../http";
import { assertUnder, LIMITS } from "../../limits";
import { normalizeUsername } from "../../security";
import { writeAudit } from "./audit";
import { publicId } from "./shared";

/**
 * Serializes member additions for a group and refuses the join once it is at
 * capacity. Someone already active does not count against the cap, so a role
 * change or a re-accept never gets stuck. The `groups` row lock makes the
 * count-then-insert safe under concurrent invites.
 */
export async function assertGroupHasCapacity(
  client: PoolClient,
  groupId: string,
  joiningUserId: string,
): Promise<void> {
  await client.query("SELECT id FROM groups WHERE id = $1 FOR UPDATE", [groupId]);
  const active = await oneOrNull<{ is_member: boolean }>(
    client,
    `SELECT EXISTS (
       SELECT 1 FROM group_members
        WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL
     ) AS is_member`,
    [groupId, joiningUserId],
  );
  if (active?.is_member) return;
  const counted = await oneOrNull<{ count: number }>(
    client,
    "SELECT count(*)::int AS count FROM group_members WHERE group_id = $1 AND removed_at IS NULL",
    [groupId],
  );
  assertUnder(
    counted?.count ?? 0,
    LIMITS.membersPerGroup,
    "group_full",
    `Este grupo atingiu o limite de ${LIMITS.membersPerGroup} pessoas.`,
  );
}

export async function createGroup(session: SessionContext, body: Record<string, unknown>) {
  const name = stringValue(body, "name", { min: 1, max: 120 })!;
  const description = stringValue(body, "description", { max: 1_000, optional: true }) ?? null;
  return inTransaction(async (client) => {
    const owned = await oneOrNull<{ count: number }>(
      client,
      `SELECT count(*)::int AS count FROM groups
        WHERE owner_user_id = $1 AND deleted_at IS NULL AND archived_at IS NULL`,
      [session.user.id],
    );
    assertUnder(
      owned?.count ?? 0,
      LIMITS.groupsPerOwner,
      "group_limit",
      `Você atingiu o limite de ${LIMITS.groupsPerOwner} grupos. Apague um grupo para criar outro.`,
    );

    const id = publicId();
    await client.query(
      `INSERT INTO groups (id, name, description, owner_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [id, name, description, session.user.id],
    );
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role, added_by_user_id, joined_at)
       VALUES ($1, $2, 'owner', $2, now())`,
      [id, session.user.id],
    );
    await writeAudit(client, id, null, session.user.id, "group.created", "group", id, null, { name });
    return { id, name, role: "owner" as const, memberCount: 1 };
  });
}

export async function addGroupMemberByUsername(
  session: SessionContext,
  groupId: string,
  body: Record<string, unknown>,
) {
  let usernameNormalized: string;
  try {
    usernameNormalized = normalizeUsername(body.username);
  } catch {
    throw new ApiError(400, "invalid_username", "Nome de usuário inválido.");
  }

  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin"], client);
    const group = await oneOrNull<{ id: string }>(
      client,
      `SELECT id FROM groups
        WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL`,
      [groupId],
    );
    if (!group) throw new ApiError(404, "not_found", "Grupo não encontrado.");

    const target = await oneOrNull<{
      id: string;
      display_name: string;
      username: string;
    }>(
      client,
      `SELECT id, display_name, username FROM users
        WHERE username_normalized = $1 AND disabled_at IS NULL
        FOR UPDATE`,
      [usernameNormalized],
    );
    if (!target) throw new ApiError(404, "not_found", "Conta não encontrada.");

    const existing = await oneOrNull<{ role: GroupRole; joined_at: Date; removed_at: Date | null }>(
      client,
      `SELECT role, joined_at, removed_at FROM group_members
        WHERE group_id = $1 AND user_id = $2
        FOR UPDATE`,
      [groupId, target.id],
    );
    if (existing && !existing.removed_at) {
      return {
        groupId,
        member: { id: target.id, name: target.display_name, username: target.username, role: existing.role },
        added: false,
        restored: false,
        idempotent: true,
      };
    }

    await assertGroupHasCapacity(client, groupId, target.id);
    const role: GroupRole = existing?.role === "admin" ? "admin" : "participant";
    await client.query(
      `INSERT INTO group_members
        (group_id, user_id, role, added_by_user_id, joined_at, removed_at)
       VALUES ($1, $2, $3, $4, now(), NULL)
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         role = $3,
         added_by_user_id = $4,
         joined_at = now(),
         removed_at = NULL`,
      [groupId, target.id, role, session.user.id],
    );
    const restored = Boolean(existing);
    await writeAudit(
      client,
      groupId,
      null,
      session.user.id,
      restored ? "group.member_restored" : "group.member_added",
      "group_member",
      target.id,
      existing ? { role: existing.role, removedAt: existing.removed_at?.toISOString() ?? null } : null,
      { role, removedAt: null },
      { source: "username", username: target.username },
    );
    return {
      groupId,
      member: { id: target.id, name: target.display_name, username: target.username, role },
      added: true,
      restored,
      idempotent: false,
    };
  });
}

export async function updateGroup(
  session: SessionContext,
  groupId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin"], client);
    const current = await oneOrNull<{ name: string; description: string | null }>(
      client,
      `SELECT name, description
         FROM groups
        WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL
        FOR UPDATE`,
      [groupId],
    );
    if (!current) throw new ApiError(404, "not_found", "Grupo não encontrado.");

    const name = body.name === undefined
      ? current.name
      : stringValue(body, "name", { min: 1, max: 120 })!;
    const description = body.description === undefined
      ? current.description
      : stringValue(body, "description", { max: 1_000, optional: true }) ?? null;

    await client.query(
      "UPDATE groups SET name = $2, description = $3, updated_at = now() WHERE id = $1",
      [groupId, name, description],
    );
    await writeAudit(
      client,
      groupId,
      null,
      session.user.id,
      "group.updated",
      "group",
      groupId,
      current,
      { name, description },
    );
    return { id: groupId, name, description };
  });
}

export async function softDeleteGroup(session: SessionContext, groupId: string) {
  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner"], client);
    const current = await oneOrNull<{ name: string }>(
      client,
      "SELECT name FROM groups WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [groupId],
    );
    if (!current) throw new ApiError(404, "not_found", "Grupo não encontrado.");
    await client.query(
      `UPDATE groups
          SET deleted_at = now(), deleted_by_user_id = $2, updated_at = now()
        WHERE id = $1`,
      [groupId, session.user.id],
    );
    await writeAudit(
      client,
      groupId,
      null,
      session.user.id,
      "group.deleted",
      "group",
      groupId,
      current,
      null,
    );
    return { id: groupId, deleted: true };
  });
}
