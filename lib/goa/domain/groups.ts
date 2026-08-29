import { requireGroupRole, type SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { ApiError, stringValue } from "../../http";
import { assertUnder, LIMITS } from "../../limits";
import { writeAudit } from "./audit";
import { publicId } from "./shared";

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
