import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { challengeAccess } from "../domain/access";
import { writeAudit } from "../domain/audit";
import { ApiError } from "../../http";
import { assertArrayWithin, LIMITS } from "../../limits";
import { regeneratePublishedShowcases } from "./results";

export async function setChallengeParticipants(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  assertArrayWithin(body.participantIds, LIMITS.membersPerGroup, "Participantes demais para um único desafio.");
  const requestedIds = Array.isArray(body.participantIds)
    ? [...new Set(body.participantIds.filter((id): id is string => typeof id === "string"))]
    : typeof body.userId === "string" ? [body.userId] : [];
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem definir participantes.");
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_closed", "O desafio está encerrado.");
    const scope = await client.query<{ kind: "standard" | "personal"; owner_user_id: string }>(
      "SELECT kind, owner_user_id FROM groups WHERE id = $1",
      [access.challenge.group_id],
    );
    if (scope.rows[0]?.kind === "personal") {
      if (requestedIds.length !== 1 || requestedIds[0] !== scope.rows[0].owner_user_id) {
        throw new ApiError(400, "personal_participant", "Desafios pessoais têm somente o proprietário como participante.");
      }
    }
    const members = requestedIds.length
      ? await client.query<{ user_id: string }>(
          `SELECT user_id FROM group_members WHERE group_id=$1 AND user_id=ANY($2::text[]) AND removed_at IS NULL`,
          [access.challenge.group_id, requestedIds],
        )
      : { rows: [] as Array<{ user_id: string }> };
    if (members.rows.length !== requestedIds.length) {
      throw new ApiError(400, "invalid_participant", "Todos os participantes precisam ser membros ativos do grupo.");
    }
    let removed = 0;
    if (body.replace === true) {
      const result = await client.query(
        `UPDATE challenge_participants SET removed_at=now()
          WHERE challenge_id=$1 AND removed_at IS NULL
            AND NOT (user_id=ANY($2::text[]))`,
        [challengeId, requestedIds],
      );
      removed = result.rowCount ?? 0;
    }
    // Someone dropped from a challenge with a live showcase — pull it offline and
    // regenerate without them (V1 §12).
    if (removed > 0) {
      await regeneratePublishedShowcases(client, access.challenge.group_id, session.user.id, { challengeId });
    }
    for (const member of members.rows) {
      await client.query(
        `INSERT INTO challenge_participants
          (challenge_id, group_id, user_id, added_by_user_id, joined_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (challenge_id,user_id) DO UPDATE SET removed_at=NULL, joined_at=now(), added_by_user_id=$4`,
        [challengeId, access.challenge.group_id, member.user_id, session.user.id],
      );
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "challenge.participants_updated", "challenge", challengeId, null, { participantIds: requestedIds });
    return { participantIds: requestedIds };
  });
}

/**
 * A participant authorises (or revokes) their real name appearing in an external
 * publication of this challenge (V1 §12). Self-service — the admin never sets it
 * for someone else. Starts false; safe to flip at any point in the round.
 */
export async function setParticipantNameConsent(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  if (typeof body.nameConsent !== "boolean") {
    throw new ApiError(400, "invalid_request", "Informe se você autoriza ou não o seu nome.");
  }
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    const row = await oneOrNull<{ name_consent: boolean }>(
      client,
      "SELECT name_consent FROM challenge_participants WHERE challenge_id = $1 AND user_id = $2 AND removed_at IS NULL FOR UPDATE",
      [challengeId, session.user.id],
    );
    if (!row) throw new ApiError(403, "forbidden", "Você não participa deste desafio.");
    if (row.name_consent !== body.nameConsent) {
      await client.query(
        "UPDATE challenge_participants SET name_consent = $3 WHERE challenge_id = $1 AND user_id = $2",
        [challengeId, session.user.id, body.nameConsent],
      );
      // Metadata only — no content, and the actor is the participant themselves.
      await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
        "participant.name_consent_changed", "challenge_participant", session.user.id,
        null, null, { nameConsent: body.nameConsent });
    }
    return { challengeId, nameConsent: body.nameConsent };
  });
}
