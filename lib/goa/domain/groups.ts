import type { PoolClient } from "pg";

import { requireGroupRole, type GroupRole, type SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { ApiError, stringValue } from "../../http";
import { assertUnder, LIMITS } from "../../limits";
import { normalizeUsername } from "../../security";
import { regeneratePublishedShowcases } from "../challenges/results";
import { moveToTrash } from "../trash";
import { writeAudit } from "./audit";
import { publicId } from "./shared";

/**
 * Serializes member additions for a group and refuses the join once it is at
 * capacity. Someone already active does not count against the cap, so a role
 * change or a re-accept never gets stuck. The `groups` row lock makes the
 * count-then-insert safe under concurrent invites.
 *
 * `reservePending` also counts open `group_member_requests` toward the cap, so
 * a group cannot queue more directed invites than it has seats — used when the
 * request is created, not when it is accepted.
 */
export async function assertGroupHasCapacity(
  client: PoolClient,
  groupId: string,
  joiningUserId: string,
  options: { reservePending?: boolean } = {},
): Promise<void> {
  const group = await client.query(
    "SELECT id FROM groups WHERE id = $1 AND kind = 'standard' AND archived_at IS NULL AND deleted_at IS NULL FOR UPDATE",
    [groupId],
  );
  if (!group.rowCount) throw new ApiError(404, "not_found", "Grupo não encontrado.");
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
    `SELECT (
       (SELECT count(*) FROM group_members WHERE group_id = $1 AND removed_at IS NULL)
       + CASE WHEN $2 THEN
           (SELECT count(*) FROM group_member_requests WHERE group_id = $1 AND status = 'pending')
         ELSE 0 END
     )::int AS count`,
    [groupId, Boolean(options.reservePending)],
  );
  assertUnder(
    counted?.count ?? 0,
    LIMITS.membersPerGroup,
    "group_full",
    `Este grupo atingiu o limite de ${LIMITS.membersPerGroup} pessoas.`,
  );
}

/**
 * Caps how many groups one account belongs to (any role). Enforced on every
 * join path — accepting a link invite or a directed member request — so a
 * hostile flow cannot pile an account into unbounded groups.
 */
export async function assertUnderMembershipCap(
  client: PoolClient,
  userId: string,
): Promise<void> {
  const counted = await oneOrNull<{ count: number }>(
    client,
    // A group its owner binned is gone from every member's app — it must not
    // keep occupying their slot, since only the owner can restore or destroy it
    // and the member has no screen that lists it.
    `SELECT count(*)::int AS count FROM group_members gm
       JOIN groups g ON g.id = gm.group_id AND g.kind = 'standard' AND g.deleted_at IS NULL
      WHERE gm.user_id = $1 AND gm.removed_at IS NULL`,
    [userId],
  );
  assertUnder(
    counted?.count ?? 0,
    LIMITS.groupsPerMember,
    "group_membership_limit",
    `Você já participa de ${LIMITS.groupsPerMember} grupos, o máximo permitido.`,
  );
}

/** Bounds the pile of unanswered directed invites a single account can receive. */
export async function assertUnderPendingInviteCap(
  client: PoolClient,
  userId: string,
): Promise<void> {
  const counted = await oneOrNull<{ count: number }>(
    client,
    "SELECT count(*)::int AS count FROM group_member_requests WHERE user_id = $1 AND status = 'pending'",
    [userId],
  );
  assertUnder(
    counted?.count ?? 0,
    LIMITS.pendingInvitesPerUser,
    "invite_backlog",
    "Esta pessoa tem muitas solicitações pendentes no momento. Tente novamente mais tarde.",
  );
}

export async function createGroup(session: SessionContext, body: Record<string, unknown>) {
  const name = stringValue(body, "name", { min: 1, max: 120 })!;
  const description = stringValue(body, "description", { max: 1_000, optional: true }) ?? null;
  return inTransaction(async (client) => {
    const owned = await oneOrNull<{ count: number }>(
      client,
      // A binned group still occupies its slot (ROADMAP §13 — the bin has no
      // expiry, so it cannot be a free way around the cap). Restore it or delete
      // it for good to free the slot.
      `SELECT count(*)::int AS count FROM groups
        WHERE owner_user_id = $1 AND kind = 'standard' AND archived_at IS NULL`,
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

/**
 * A group admin invites an existing account by @username. This never adds the
 * person straight away: it opens a `pending` request that the invitee approves
 * (or declines) from their own session. Idempotent for an active member or an
 * already-open request.
 */
export async function requestGroupMember(
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
        WHERE id = $1 AND kind = 'standard'
          AND archived_at IS NULL AND deleted_at IS NULL`,
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

    const activeMember = await oneOrNull<{ role: GroupRole }>(
      client,
      `SELECT role FROM group_members
        WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, target.id],
    );
    if (activeMember) {
      return {
        groupId,
        member: { id: target.id, name: target.display_name, username: target.username, role: activeMember.role },
        status: "already_member" as const,
      };
    }

    const pending = await oneOrNull<{ id: string }>(
      client,
      `SELECT id FROM group_member_requests
        WHERE group_id = $1 AND user_id = $2 AND status = 'pending'
        FOR UPDATE`,
      [groupId, target.id],
    );
    if (pending) {
      return {
        groupId,
        member: { id: target.id, name: target.display_name, username: target.username, role: "participant" as const },
        status: "already_pending" as const,
      };
    }

    await assertGroupHasCapacity(client, groupId, target.id, { reservePending: true });
    await assertUnderPendingInviteCap(client, target.id);

    const requestId = publicId();
    await client.query(
      `INSERT INTO group_member_requests
        (id, group_id, user_id, invited_by_user_id, role, status, created_at)
       VALUES ($1, $2, $3, $4, 'participant', 'pending', now())`,
      [requestId, groupId, target.id, session.user.id],
    );
    await writeAudit(
      client,
      groupId,
      null,
      session.user.id,
      "group.member_requested",
      "group_member_request",
      requestId,
      null,
      { role: "participant" },
      { source: "username", username: target.username },
    );
    return {
      groupId,
      member: { id: target.id, name: target.display_name, username: target.username, role: "participant" as const },
      status: "requested" as const,
    };
  });
}

interface MemberRequestRow {
  id: string;
  group_id: string;
  group_name: string;
  user_id: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
}

/** The invitee accepts or declines a directed group invitation aimed at them. */
export async function respondToMemberRequest(
  session: SessionContext,
  requestId: string,
  action: "accept" | "decline",
) {
  return inTransaction(async (client) => {
    const request = await oneOrNull<MemberRequestRow>(
      client,
      `SELECT r.id, r.group_id, g.name AS group_name, r.user_id, r.status
         FROM group_member_requests r
         JOIN groups g ON g.id = r.group_id AND g.kind = 'standard'
          AND g.archived_at IS NULL AND g.deleted_at IS NULL
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [requestId],
    );
    if (!request || request.user_id !== session.user.id) {
      throw new ApiError(404, "not_found", "Solicitação não encontrada.");
    }
    if (request.status !== "pending") {
      if (request.status === "accepted") {
        return { status: "accepted" as const, groupId: request.group_id, groupName: request.group_name, idempotent: true };
      }
      throw new ApiError(409, "request_settled", "Esta solicitação já foi respondida.");
    }

    if (action === "decline") {
      await client.query(
        "UPDATE group_member_requests SET status = 'declined', responded_at = now() WHERE id = $1",
        [requestId],
      );
      await writeAudit(
        client,
        request.group_id,
        null,
        session.user.id,
        "group.member_request_declined",
        "group_member_request",
        requestId,
        { status: "pending" },
        { status: "declined" },
      );
      return { status: "declined" as const, groupId: request.group_id, groupName: request.group_name };
    }

    await assertUnderMembershipCap(client, session.user.id);
    await assertGroupHasCapacity(client, request.group_id, session.user.id);

    const prior = await oneOrNull<{ role: GroupRole; removed_at: Date | null }>(
      client,
      "SELECT role, removed_at FROM group_members WHERE group_id = $1 AND user_id = $2 FOR UPDATE",
      [request.group_id, session.user.id],
    );
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role, added_by_user_id, joined_at)
       VALUES ($1, $2, 'participant', $3, now())
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         removed_at = NULL,
         joined_at = CASE WHEN group_members.removed_at IS NULL THEN group_members.joined_at ELSE now() END,
         role = CASE WHEN group_members.role IN ('owner', 'admin') THEN group_members.role ELSE 'participant' END`,
      [request.group_id, session.user.id, session.user.id],
    );
    await client.query(
      "UPDATE group_member_requests SET status = 'accepted', responded_at = now() WHERE id = $1",
      [requestId],
    );
    const restored = Boolean(prior && prior.removed_at);
    await writeAudit(
      client,
      request.group_id,
      null,
      session.user.id,
      restored ? "group.member_restored" : "group.member_added",
      "group_member",
      session.user.id,
      prior ? { role: prior.role, removedAt: prior.removed_at?.toISOString() ?? null } : null,
      { role: prior?.role === "admin" ? "admin" : "participant", removedAt: null },
      { source: "request", requestId },
    );
    return {
      status: "accepted" as const,
      groupId: request.group_id,
      groupName: request.group_name,
      idempotent: false,
    };
  });
}

/**
 * A member walks away from a group they were added to. Soft-removes the
 * membership and every challenge participation in that group — no question
 * asked, because there is nothing to choose: their entries stay (the round's
 * history stays intact) but every place that names them (recommended-by,
 * per-participant metrics) shows a neutral "left the group" label instead, the
 * same way a deleted account already shows "Conta removida". Any published
 * showcase in the group is pulled offline and regenerated without them (V1 §12);
 * the admin republishes when ready. The owner cannot leave (no ownership
 * transfer yet — delete the group instead).
 */
export async function leaveGroup(session: SessionContext, groupId: string) {
  return inTransaction(async (client) => {
    // A binned group must still be leavable — otherwise its members stay stuck in
    // it (and it keeps counting toward their group cap) with no way out.
    const group = await oneOrNull<{ id: string; name: string }>(
      client,
      `SELECT id, name FROM groups
        WHERE id = $1 AND kind = 'standard' AND archived_at IS NULL
        FOR UPDATE`,
      [groupId],
    );
    if (!group) throw new ApiError(404, "not_found", "Grupo não encontrado.");

    const membership = await oneOrNull<{ role: GroupRole }>(
      client,
      `SELECT role FROM group_members
        WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL
        FOR UPDATE`,
      [groupId, session.user.id],
    );
    if (!membership) throw new ApiError(404, "not_found", "Você não participa deste grupo.");
    if (membership.role === "owner") {
      throw new ApiError(
        409,
        "owner_cannot_leave",
        "Você é o responsável por este grupo. Transfira ou apague o grupo antes de sair.",
      );
    }

    await client.query(
      "UPDATE group_members SET removed_at = now() WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL",
      [groupId, session.user.id],
    );
    await client.query(
      `UPDATE challenge_participants SET removed_at = now(), name_consent = false
        WHERE user_id = $2 AND removed_at IS NULL
          AND challenge_id IN (SELECT id FROM challenges WHERE group_id = $1)`,
      [groupId, session.user.id],
    );
    // Any published showcase in the group goes offline and is regenerated
    // without the departed member; the admin republishes when ready (V1 §12).
    await regeneratePublishedShowcases(client, groupId, session.user.id);

    await writeAudit(
      client,
      groupId,
      null,
      session.user.id,
      "group.member_left",
      "group_member",
      session.user.id,
      { role: membership.role },
      { removedAt: new Date().toISOString() },
    );
    return { groupId, left: true as const };
  });
}

/**
 * Owner-only: promotes an existing participant to admin, or demotes an admin
 * back to participant. A group can have any number of admins — the schema
 * only ever enforced a single active *owner*. The owner's own role and the
 * departed-member "removed" state are both off-limits here; use `leaveGroup`
 * or account deletion for those.
 */
export async function setGroupMemberRole(
  session: SessionContext,
  groupId: string,
  memberUserId: string,
  body: Record<string, unknown>,
) {
  const role = body.role === "admin" ? "admin" : body.role === "participant" ? "participant" : null;
  if (!role) throw new ApiError(400, "invalid_role", "Escolha admin ou participante.");
  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner"], client);
    if (memberUserId === session.user.id) {
      throw new ApiError(400, "cannot_change_self", "Você não pode mudar seu próprio papel por aqui.");
    }
    const member = await oneOrNull<{ role: GroupRole }>(
      client,
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL FOR UPDATE`,
      [groupId, memberUserId],
    );
    if (!member) throw new ApiError(404, "not_found", "Pessoa não encontrada no grupo.");
    if (member.role === "owner") {
      throw new ApiError(400, "cannot_change_owner", "O responsável não muda de papel por aqui.");
    }
    if (member.role !== role) {
      await client.query(
        "UPDATE group_members SET role = $3 WHERE group_id = $1 AND user_id = $2",
        [groupId, memberUserId, role],
      );
      await writeAudit(
        client,
        groupId,
        null,
        session.user.id,
        "group.member_role_changed",
        "group_member",
        memberUserId,
        { role: member.role },
        { role },
      );
    }
    return { groupId, userId: memberUserId, role };
  });
}

/** A group admin withdraws a directed invitation before the invitee answers. */
export async function cancelMemberRequest(session: SessionContext, requestId: string) {
  return inTransaction(async (client) => {
    const request = await oneOrNull<MemberRequestRow>(
      client,
      `SELECT r.id, r.group_id, g.name AS group_name, r.user_id, r.status
         FROM group_member_requests r
         JOIN groups g ON g.id = r.group_id AND g.kind = 'standard'
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [requestId],
    );
    if (!request) throw new ApiError(404, "not_found", "Solicitação não encontrada.");
    await requireGroupRole(session.user.id, request.group_id, ["owner", "admin"], client);
    if (request.status !== "pending") {
      throw new ApiError(409, "request_settled", "Esta solicitação já foi respondida.");
    }
    await client.query(
      "UPDATE group_member_requests SET status = 'cancelled', responded_at = now() WHERE id = $1",
      [requestId],
    );
    await writeAudit(
      client,
      request.group_id,
      null,
      session.user.id,
      "group.member_request_cancelled",
      "group_member_request",
      requestId,
      { status: "pending" },
      { status: "cancelled" },
    );
    return { status: "cancelled" as const, groupId: request.group_id };
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
        WHERE id = $1 AND kind = 'standard'
          AND archived_at IS NULL AND deleted_at IS NULL
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
      "SELECT name FROM groups WHERE id = $1 AND kind = 'standard' AND deleted_at IS NULL FOR UPDATE",
      [groupId],
    );
    if (!current) throw new ApiError(404, "not_found", "Grupo não encontrado.");
    // Sets `deleted_at` + records the explicit bin row (or 409s on a published
    // template). Restore and permanent deletion go through `lib/goa/trash.ts`.
    await moveToTrash(client, "group", groupId, session.user.id);
    // Every public showcase in the group goes offline with it — the snapshot may
    // still name people; the admin republishes after a restore.
    await client.query(
      `UPDATE challenges SET results_published_at = NULL, result_share_token_hash = NULL,
          results_published_snapshot = NULL, updated_at = now()
        WHERE group_id = $1 AND results_published_at IS NOT NULL`,
      [groupId],
    );
    await writeAudit(client, groupId, null, session.user.id, "group.deleted", "group", groupId, current, null);
    return { id: groupId, deleted: true };
  });
}
