import type { PoolClient } from "pg";
import { requireGroupRole, type SessionContext } from "../../auth";
import { inTransaction, oneOrNull, withClient } from "../../db";
import { ApiError, stringValue } from "../../http";
import { generateOpaqueToken, hashToken } from "../../security";
import { writeAudit } from "./audit";
import { assertGroupHasCapacity } from "./groups";
import { integerValue, publicId } from "./shared";

type InviteKind = "group" | "challenge";
type InviteStatus = "valid" | "expired" | "revoked" | "exhausted";
type ChallengeStatus = "draft" | "active" | "closed";

interface ChallengeTarget {
  id: string;
  title: string;
  status: ChallengeStatus;
}

export async function createInvite(
  session: SessionContext,
  groupId: string,
  body: Record<string, unknown>,
) {
  const expiresInDays = integerValue(body.expiresInDays, 7, 1, 30);
  const maxUses = integerValue(body.maxUses, 1, 1, 100);
  const challengeId = body.challengeId === undefined || body.challengeId === null || body.challengeId === ""
    ? null
    : stringValue(body, "challengeId", { max: 100 })!;
  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin"], client);
    const group = await oneOrNull<{ id: string; name: string }>(
      client,
      `SELECT id, name FROM groups
        WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL`,
      [groupId],
    );
    if (!group) throw new ApiError(404, "not_found", "Grupo não encontrado.");

    const challenge = challengeId
      ? await oneOrNull<ChallengeTarget>(
          client,
          `SELECT id, title, status FROM challenges
            WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL
            FOR UPDATE`,
          [challengeId, groupId],
        )
      : null;
    if (challengeId && !challenge) throw new ApiError(404, "not_found", "Desafio não encontrado.");
    if (challenge && challenge.status !== "active") {
      throw new ApiError(
        409,
        "challenge_not_active",
        challenge.status === "closed"
          ? "Não é possível convidar participantes para um desafio encerrado."
          : "Ative o desafio antes de convidar participantes para ele.",
      );
    }

    const rawToken = generateOpaqueToken();
    const tokenHash = await hashToken(rawToken);
    const id = publicId();
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
    await client.query(
      `INSERT INTO group_invites
        (id, group_id, token_hash, role, created_by_user_id, max_uses, use_count, expires_at, created_at)
       VALUES ($1, $2, $3, 'participant', $4, $5, 0, $6, now())`,
      [id, groupId, tokenHash, session.user.id, maxUses, expiresAt],
    );
    if (challenge) {
      await client.query(
        `INSERT INTO invite_challenge_targets (invite_id, group_id, challenge_id, created_at)
         VALUES ($1, $2, $3, now())`,
        [id, groupId, challenge.id],
      );
    }
    const kind: InviteKind = challenge ? "challenge" : "group";
    await writeAudit(client, groupId, challenge?.id ?? null, session.user.id, "invite.created", "group_invite", id, null, {
      kind,
      expiresAt: expiresAt.toISOString(),
      maxUses,
    });
    return {
      id,
      token: rawToken,
      kind,
      groupId: group.id,
      groupName: group.name,
      challengeId: challenge?.id ?? null,
      challengeTitle: challenge?.title ?? null,
      expiresAt: expiresAt.toISOString(),
      maxUses,
    };
  });
}

interface InviteRow {
  id: string;
  group_id: string;
  group_name: string;
  invited_by: string;
  created_by_user_id: string;
  role: "participant" | "admin";
  max_uses: number;
  use_count: number;
  expires_at: Date;
  revoked_at: Date | null;
  challenge_id: string | null;
  challenge_title: string | null;
  challenge_status: ChallengeStatus | null;
}

async function inviteByToken(token: string, client: PoolClient, lock = false): Promise<InviteRow | null> {
  let tokenHash: string;
  try {
    tokenHash = await hashToken(token);
  } catch {
    return null;
  }
  return oneOrNull<InviteRow>(
    client,
    `SELECT gi.id, gi.group_id, g.name AS group_name, u.display_name AS invited_by,
            gi.created_by_user_id, gi.role, gi.max_uses, gi.use_count, gi.expires_at,
            gi.revoked_at, ict.challenge_id, c.title AS challenge_title,
            c.status AS challenge_status
       FROM group_invites gi
       JOIN groups g ON g.id = gi.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
       JOIN users u ON u.id = gi.created_by_user_id
       LEFT JOIN invite_challenge_targets ict ON ict.invite_id = gi.id AND ict.group_id = gi.group_id
       LEFT JOIN challenges c ON c.id = ict.challenge_id AND c.group_id = ict.group_id
        AND c.deleted_at IS NULL
      WHERE gi.token_hash = $1${lock ? " FOR UPDATE OF gi" : ""}`,
    [tokenHash],
  );
}

function inviteStatus(invite: InviteRow): InviteStatus {
  if (invite.revoked_at) return "revoked";
  // A challenge invite is only good while its target is live: a deleted or
  // closed challenge (or one somehow back in draft) retires the invite.
  if (invite.challenge_id && (!invite.challenge_title || invite.challenge_status !== "active")) return "revoked";
  if (invite.expires_at.getTime() <= Date.now()) return "expired";
  if (invite.use_count >= invite.max_uses) return "exhausted";
  return "valid";
}

function invitePayload(invite: InviteRow) {
  const kind: InviteKind = invite.challenge_id ? "challenge" : "group";
  return {
    kind,
    groupId: invite.group_id,
    groupName: invite.group_name,
    challengeId: invite.challenge_id,
    challengeTitle: invite.challenge_title,
  };
}

export async function previewInvite(token: string, session: SessionContext | null = null) {
  return withClient(async (client) => {
    const invite = await inviteByToken(token, client);
    if (!invite) throw new ApiError(404, "not_found", "Convite não encontrado.");
    const accepted = session
      ? Boolean(await oneOrNull<{ invite_id: string }>(
          client,
          "SELECT invite_id FROM invite_redemptions WHERE invite_id = $1 AND user_id = $2",
          [invite.id, session.user.id],
        ))
      : false;
    return {
      ...invitePayload(invite),
      invitedBy: invite.invited_by,
      expiresAt: invite.expires_at.toISOString(),
      accepted,
      status: accepted ? "accepted" as const : inviteStatus(invite),
    };
  });
}

export async function acceptInvite(session: SessionContext, token: string) {
  return inTransaction(async (client) => {
    const invite = await inviteByToken(token, client, true);
    if (!invite) throw new ApiError(404, "not_found", "Convite não encontrado.");
    const prior = await oneOrNull<{ invite_id: string }>(
      client,
      "SELECT invite_id FROM invite_redemptions WHERE invite_id = $1 AND user_id = $2",
      [invite.id, session.user.id],
    );
    if (prior) return { ...invitePayload(invite), accepted: true, idempotent: true };

    if (invite.challenge_id) {
      const challenge = await oneOrNull<ChallengeTarget>(
        client,
        `SELECT id, title, status FROM challenges
          WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [invite.challenge_id, invite.group_id],
      );
      invite.challenge_title = challenge?.title ?? null;
      invite.challenge_status = challenge?.status ?? null;
    }
    const status = inviteStatus(invite);
    if (status !== "valid") throw new ApiError(410, `invite_${status}`, "Este convite não está mais disponível.");

    await assertGroupHasCapacity(client, invite.group_id, session.user.id);
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role, added_by_user_id, joined_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         removed_at = NULL,
         joined_at = CASE WHEN group_members.removed_at IS NULL THEN group_members.joined_at ELSE now() END,
         role = CASE WHEN group_members.role IN ('owner', 'admin') THEN group_members.role ELSE 'participant' END`,
      [invite.group_id, session.user.id, invite.role, invite.created_by_user_id],
    );
    if (invite.challenge_id) {
      await client.query(
        `INSERT INTO challenge_participants
          (challenge_id, group_id, user_id, added_by_user_id, joined_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (challenge_id, user_id) DO UPDATE SET
           removed_at = NULL,
           joined_at = CASE
             WHEN challenge_participants.removed_at IS NULL THEN challenge_participants.joined_at
             ELSE now()
           END,
           added_by_user_id = $4`,
        [invite.challenge_id, invite.group_id, session.user.id, invite.created_by_user_id],
      );
    }
    await client.query(
      "INSERT INTO invite_redemptions (invite_id, user_id, redeemed_at) VALUES ($1, $2, now())",
      [invite.id, session.user.id],
    );
    const consumed = await client.query(
      `UPDATE group_invites SET use_count = use_count + 1
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > now() AND use_count < max_uses
        RETURNING id`,
      [invite.id],
    );
    if (!consumed.rowCount) throw new ApiError(409, "invite_consumed", "O convite acabou de atingir seu limite.");
    await writeAudit(
      client,
      invite.group_id,
      invite.challenge_id,
      session.user.id,
      "invite.accepted",
      "group_invite",
      invite.id,
      null,
      null,
      { kind: invite.challenge_id ? "challenge" : "group" },
    );
    return { ...invitePayload(invite), accepted: true, idempotent: false };
  });
}
