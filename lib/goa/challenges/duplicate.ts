import { type SessionContext, requireGroupRole } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { challengeAccess, writeAudit } from "../../goa-domain";
import { ApiError, stringValue } from "../../http";
import { assertUnder, LIMITS } from "../../limits";
import { copyChallengeStructure } from "./copy";

export async function duplicateChallenge(
  session: SessionContext,
  sourceChallengeId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const sourceAccess = await challengeAccess(session.user.id, sourceChallengeId, client, true);
    await requireGroupRole(session.user.id, sourceAccess.challenge.group_id, ["owner", "admin"], client);
    const targetGroupId = stringValue(body, "targetGroupId", { min: 1, max: 100 })!;
    if (targetGroupId === sourceAccess.challenge.group_id) {
      throw new ApiError(400, "same_group_copy", "Escolha outro grupo para reutilizar este desafio.");
    }
    await requireGroupRole(session.user.id, targetGroupId, ["owner", "admin"], client);
    const targetGroup = await oneOrNull<{ id: string }>(
      client,
      `SELECT id FROM groups
        WHERE id=$1 AND archived_at IS NULL AND deleted_at IS NULL
        FOR UPDATE`,
      [targetGroupId],
    );
    if (!targetGroup) throw new ApiError(404, "not_found", "Grupo de destino não encontrado.");
    const targetCount = await oneOrNull<{ count: number }>(
      client,
      "SELECT count(*)::int AS count FROM challenges WHERE group_id=$1 AND deleted_at IS NULL",
      [targetGroupId],
    );
    assertUnder(
      targetCount?.count ?? 0,
      LIMITS.challengesPerGroup,
      "challenge_limit",
      `O grupo de destino atingiu o limite de ${LIMITS.challengesPerGroup} desafios.`,
    );
    const title = stringValue(body, "title", { max: 160, optional: true }) ?? `Cópia de ${sourceAccess.challenge.title}`;
    const targetId = await copyChallengeStructure(
      client,
      sourceChallengeId,
      targetGroupId,
      session.user.id,
      title,
    );

    await client.query(
      `INSERT INTO challenge_duplications
        (source_group_id,target_group_id,source_challenge_id,target_challenge_id,copied_by_user_id,created_at)
       VALUES ($1,$2,$3,$4,$5,now())`,
      [sourceAccess.challenge.group_id, targetGroupId, sourceChallengeId, targetId, session.user.id],
    );
    await writeAudit(client, targetGroupId, targetId, session.user.id,
      "challenge.duplicated", "challenge", targetId, null,
      { sourceChallengeId, sourceGroupId: sourceAccess.challenge.group_id, targetGroupId });
    return { id: targetId, challengeId: targetId, groupId: targetGroupId, status: "draft" };
  });
}
