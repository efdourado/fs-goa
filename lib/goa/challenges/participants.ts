import type { SessionContext } from "../../auth";
import { inTransaction } from "../../db";
import { challengeAccess, writeAudit } from "../../goa-domain";
import { ApiError } from "../../http";
import { assertArrayWithin, LIMITS } from "../../limits";

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
    const members = requestedIds.length
      ? await client.query<{ user_id: string }>(
          `SELECT user_id FROM group_members WHERE group_id=$1 AND user_id=ANY($2::text[]) AND removed_at IS NULL`,
          [access.challenge.group_id, requestedIds],
        )
      : { rows: [] as Array<{ user_id: string }> };
    if (members.rows.length !== requestedIds.length) {
      throw new ApiError(400, "invalid_participant", "Todos os participantes precisam ser membros ativos do grupo.");
    }
    if (body.replace === true) {
      await client.query(
        `UPDATE challenge_participants SET removed_at=now()
          WHERE challenge_id=$1 AND removed_at IS NULL
            AND NOT (user_id=ANY($2::text[]))`,
        [challengeId, requestedIds],
      );
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
