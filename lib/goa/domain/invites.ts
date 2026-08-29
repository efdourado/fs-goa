import type { PoolClient } from "pg";
import { requireGroupRole, type SessionContext } from "../../auth";
import { inTransaction, oneOrNull, withClient } from "../../db";
import { ApiError } from "../../http";
import { generateOpaqueToken, hashToken } from "../../security";
import { writeAudit } from "./audit";
import { integerValue, publicId } from "./shared";

export async function createInvite(
  session: SessionContext,
  groupId: string,
  body: Record<string, unknown>,
) {
  const expiresInDays = integerValue(body.expiresInDays, 7, 1, 30);
  const maxUses = integerValue(body.maxUses, 1, 1, 100);
  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin"], client);
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
    await writeAudit(client, groupId, null, session.user.id, "invite.created", "group_invite", id, null, {
      expiresAt: expiresAt.toISOString(),
      maxUses,
    });
    return { id, token: rawToken, expiresAt: expiresAt.toISOString(), maxUses };
  });
}

interface InviteRow {
  id: string;
  group_id: string;
  group_name: string;
  invited_by: string;
  role: "participant" | "admin";
  max_uses: number;
  use_count: number;
  expires_at: Date;
  revoked_at: Date | null;
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
            gi.role, gi.max_uses, gi.use_count, gi.expires_at, gi.revoked_at
       FROM group_invites gi
       JOIN groups g ON g.id = gi.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
       JOIN users u ON u.id = gi.created_by_user_id
      WHERE gi.token_hash = $1${lock ? " FOR UPDATE OF gi" : ""}`,
    [tokenHash],
  );
}

function inviteStatus(invite: InviteRow): "valid" | "expired" | "revoked" | "exhausted" {
  if (invite.revoked_at) return "revoked";
  if (invite.expires_at.getTime() <= Date.now()) return "expired";
  if (invite.use_count >= invite.max_uses) return "exhausted";
  return "valid";
}

export async function previewInvite(token: string) {
  return withClient(async (client) => {
    const invite = await inviteByToken(token, client);
    if (!invite) throw new ApiError(404, "not_found", "Convite não encontrado.");
    return {
      groupId: invite.group_id,
      groupName: invite.group_name,
      invitedBy: invite.invited_by,
      expiresAt: invite.expires_at.toISOString(),
      status: inviteStatus(invite),
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
    if (prior) return { groupId: invite.group_id, accepted: true, idempotent: true };
    const status = inviteStatus(invite);
    if (status !== "valid") throw new ApiError(410, `invite_${status}`, "Este convite não está mais disponível.");

    await client.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at)
       VALUES ($1, $2, 'participant', now())
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         removed_at = NULL,
         joined_at = CASE WHEN group_members.removed_at IS NULL THEN group_members.joined_at ELSE now() END,
         role = CASE WHEN group_members.role IN ('owner', 'admin') THEN group_members.role ELSE 'participant' END`,
      [invite.group_id, session.user.id],
    );
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
    await writeAudit(client, invite.group_id, null, session.user.id, "invite.accepted", "group_invite", invite.id);
    return { groupId: invite.group_id, accepted: true, idempotent: false };
  });
}
