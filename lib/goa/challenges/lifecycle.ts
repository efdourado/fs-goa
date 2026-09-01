import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { challengeAccess, publicId, writeAudit } from "../../goa-domain";
import { ApiError } from "../../http";
import { entryTypesForChallenge, usesCheckpoints, usesRoundItems } from "./entry-types";
import { calculateMetricRow } from "./results";
import type { MetricRow } from "./types";

export async function transitionChallenge(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const target = body.status;
  if (target !== "active" && target !== "closed") throw new ApiError(400, "invalid_status", "Transição inválida.");
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem mudar o estado.");
    const valid = (access.challenge.status === "draft" && target === "active") ||
      (access.challenge.status === "active" && target === "closed");
    if (!valid) throw new ApiError(409, "invalid_transition", "A transição de estado não é permitida.");
    if (target === "active") {
      const types = await entryTypesForChallenge(client, challengeId);
      const challengeHasPeriod =
        access.challenge.start_date !== null && access.challenge.end_date !== null;
      const readiness = await oneOrNull<{
        fields: number; participants: number; items: number; checkpoints: number;
      }>(client,
        `SELECT
           (SELECT count(*)::int FROM challenge_fields WHERE challenge_id=$1 AND archived_at IS NULL) AS fields,
           (SELECT count(*)::int FROM challenge_participants WHERE challenge_id=$1 AND removed_at IS NULL) AS participants,
           (SELECT count(*)::int FROM challenge_items WHERE challenge_id=$1 AND archived_at IS NULL) AS items,
           (SELECT count(*)::int FROM challenge_checkpoints WHERE challenge_id=$1 AND archived_at IS NULL) AS checkpoints`,
        [challengeId]);
      if (!readiness?.fields || !readiness.participants) {
        throw new ApiError(409, "challenge_incomplete", "Adicione campos e participantes antes de ativar.");
      }
      if ((usesRoundItems(types) && !readiness.items)
          || (usesCheckpoints(types, challengeHasPeriod) && !readiness.checkpoints)) {
        throw new ApiError(409, "challenge_incomplete", "Adicione os itens ou checkpoints antes de ativar.");
      }
      await client.query("UPDATE challenges SET status='active', activated_at=now(), updated_at=now() WHERE id=$1", [challengeId]);
    } else {
      const metricRows = await client.query<MetricRow>(
        `SELECT id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
                decimal_places,visible_during_challenge,position,settings
           FROM challenge_metrics WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [challengeId]);
      await client.query("UPDATE challenges SET status='closed', closed_at=now(), updated_at=now() WHERE id=$1", [challengeId]);
      const existingBlocks = await oneOrNull<{ count: number }>(client,
        "SELECT count(*)::int AS count FROM result_blocks WHERE challenge_id=$1", [challengeId]);
      if (!existingBlocks?.count) {
        for (const metric of metricRows.rows) {
          const value = await calculateMetricRow(client, metric);
          await client.query(
            `INSERT INTO result_blocks
              (id,challenge_id,kind,metric_id,heading,value_snapshot,position,visible,created_by_user_id,created_at,updated_at)
             VALUES ($1,$2,'metric',$3,$4,$5::jsonb,$6,true,$7,now(),now())`,
            [publicId(), challengeId, metric.id, metric.label, JSON.stringify(value), metric.position, session.user.id],
          );
        }
      }
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      `challenge.${target}`, "challenge", challengeId, { status: access.challenge.status }, { status: target });
    return { id: challengeId, status: target };
  });
}

export async function softDeleteChallenge(session: SessionContext, challengeId: string) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) {
      throw new ApiError(403, "forbidden", "Somente administradores podem apagar o desafio.");
    }
    await client.query(
      `UPDATE challenges
          SET deleted_at = now(), deleted_by_user_id = $2, updated_at = now()
        WHERE id = $1`,
      [challengeId, session.user.id],
    );
    await writeAudit(
      client,
      access.challenge.group_id,
      challengeId,
      session.user.id,
      "challenge.deleted",
      "challenge",
      challengeId,
      { title: access.challenge.title, status: access.challenge.status },
      null,
    );
    return { id: challengeId, deleted: true };
  });
}
