import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull, withClient } from "../../db";
import { challengeAccess, dateRange, writeAudit } from "../../goa-domain";
import { ApiError, stringValue } from "../../http";
import { fieldsForChallenge } from "./fields";
import { generateDailyCheckpoints } from "./items";
import { metricsForChallenge, resultForChallenge } from "./results";
import { parseRuleSections, rulesCompatibilityText } from "../domain/rules";

function windowStatus(
  challengeStatus: "draft" | "active" | "closed",
  opensAt: Date | null,
  dueAt: Date | null,
): "scheduled" | "open" | "past_due" | "closed" {
  if (challengeStatus === "closed") return "closed";
  const now = Date.now();
  if (opensAt && opensAt.getTime() > now) return "scheduled";
  if (dueAt && dueAt.getTime() <= now) return "past_due";
  return "open";
}

export async function getChallengeDetail(session: SessionContext, challengeId: string) {
  return withClient(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client);
    const fields = await fieldsForChallenge(client, challengeId);
    const itemsResult = await client.query<{
        id: string; entry_type_id: string; title: string; description: string | null;
        position: number; opens_at: Date | null; due_at: Date | null;
      }>(
        `SELECT id, entry_type_id, title, description, position, opens_at, due_at
           FROM challenge_items WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position`,
        [challengeId],
      );
    const checkpointsResult = await client.query<{
        id: string; title: string; description: string | null; position: number;
        starts_at: Date | null; due_at: Date | null;
      }>(
        `SELECT id, title, description, position, starts_at, due_at
           FROM challenge_checkpoints WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position`,
        [challengeId],
      );
    const participantsResult = await client.query<{ id: string; display_name: string; username: string }>(
        `SELECT u.id, u.display_name, u.username
           FROM challenge_participants cp JOIN users u ON u.id = cp.user_id
          WHERE cp.challenge_id = $1 AND cp.removed_at IS NULL ORDER BY u.display_name`,
        [challengeId],
      );
    const typeResult = await client.query<{ submission_mode: "item" | "daily" | "free" }>(
        "SELECT submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1",
        [challengeId],
      );
    const metrics = await metricsForChallenge(client, challengeId);
    const result = await resultForChallenge(client, challengeId, metrics);
    const submissionMode = typeResult.rows[0]?.submission_mode ?? "free";
    const items = submissionMode === "daily" && access.challenge.start_date === null
      ? []
      : itemsResult.rows.length
      ? itemsResult.rows.map((item) => ({
          id: item.id, entryTypeId: item.entry_type_id, title: item.title,
          description: item.description, position: item.position,
          opensAt: item.opens_at?.toISOString() ?? null, dueAt: item.due_at?.toISOString() ?? null,
          status: windowStatus(access.challenge.status, item.opens_at, item.due_at),
        }))
      : checkpointsResult.rows.map((checkpoint) => ({
          id: checkpoint.id, checkpointId: checkpoint.id, title: checkpoint.title,
          description: checkpoint.description, position: checkpoint.position,
          opensAt: checkpoint.starts_at?.toISOString() ?? null,
          dueAt: checkpoint.due_at?.toISOString() ?? null,
          date: checkpoint.starts_at?.toISOString().slice(0, 10) ?? null,
          status: windowStatus(access.challenge.status, checkpoint.starts_at, checkpoint.due_at),
        }));
    return {
      id: access.challenge.id,
      groupId: access.challenge.group_id,
      title: access.challenge.title,
      description: access.challenge.description,
      rules: access.challenge.rules,
      ruleSections: parseRuleSections(access.challenge.rule_sections, access.challenge.rules),
      startsOn: access.challenge.start_date,
      endsOn: access.challenge.end_date,
      status: access.challenge.status,
      submissionMode,
      viewerRole: access.challenge.role,
      isParticipant: access.challenge.is_participant,
      fields,
      items,
      participants: participantsResult.rows.map((participant) => ({
        id: participant.id, userId: participant.id, name: participant.display_name, username: participant.username,
      })),
      metrics,
      result,
    };
  });
}

export async function updateChallenge(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem editar o desafio.");
    if (access.challenge.status === "closed") {
      throw new ApiError(409, "challenge_locked", "Desafios encerrados preservam sua leitura histórica.");
    }
    const title = body.title === undefined ? access.challenge.title : stringValue(body, "title", { max: 160 })!;
    const description = body.description === undefined
      ? access.challenge.description
      : stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
    const ruleSections = body.ruleSections === undefined && body.rules === undefined
      ? parseRuleSections(access.challenge.rule_sections, access.challenge.rules)
      : parseRuleSections(body.ruleSections, body.rules);
    const rules = rulesCompatibilityText(ruleSections);
    const rawStartDate = Object.hasOwn(body, "startsOn")
      ? body.startsOn
      : Object.hasOwn(body, "startDate")
        ? body.startDate
        : access.challenge.start_date;
    const rawEndDate = Object.hasOwn(body, "endsOn")
      ? body.endsOn
      : Object.hasOwn(body, "endDate")
        ? body.endDate
        : access.challenge.end_date;
    const { startDate, endDate } = dateRange(rawStartDate, rawEndDate);
    const scheduleChanged =
      startDate !== access.challenge.start_date || endDate !== access.challenge.end_date;
    const entryType = await oneOrNull<{ submission_mode: string }>(client,
      "SELECT submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1",
      [challengeId]);

    if (access.challenge.status === "active" && scheduleChanged) {
      // A agenda de um desafio ativo pode ser estendida ou remarcada à vontade,
      // mas nunca de um jeito que deixe um registro já enviado fora do período.
      if (startDate !== null && endDate !== null) {
        const stranded = await oneOrNull<{ count: number }>(
          client,
          `SELECT count(*)::int AS count FROM entries
            WHERE challenge_id=$1 AND deleted_at IS NULL
              AND (occurred_on < $2::date OR occurred_on > $3::date)`,
          [challengeId, startDate, endDate],
        );
        if (stranded && stranded.count > 0) {
          throw new ApiError(
            409,
            "schedule_would_strand_entries",
            `Este período deixaria ${stranded.count} registro(s) fora do desafio. Ajuste ou remova esses registros antes de encurtar as datas.`,
          );
        }
      } else if (entryType?.submission_mode === "daily") {
        const anyEntry = await oneOrNull<{ count: number }>(
          client,
          "SELECT count(*)::int AS count FROM entries WHERE challenge_id=$1 AND deleted_at IS NULL",
          [challengeId],
        );
        if (anyEntry && anyEntry.count > 0) {
          throw new ApiError(
            409,
            "schedule_would_strand_entries",
            `Este desafio diário já tem ${anyEntry.count} registro(s) presos ao calendário. Defina um período em vez de retirá-lo.`,
          );
        }
      }
    }

    await client.query(
      `UPDATE challenges SET title=$2, description=$3, rules=$4, rule_sections=$5::jsonb, start_date=$6,
              end_date=$7, updated_at=now() WHERE id=$1`,
      [challengeId, title, description, rules, JSON.stringify(ruleSections), startDate, endDate],
    );
    if (
      entryType?.submission_mode === "daily"
      && (access.challenge.status === "draft"
        || (access.challenge.status === "active" && scheduleChanged))
    ) {
      if (startDate !== null && endDate !== null) {
        await generateDailyCheckpoints(client, challengeId, startDate, endDate);
      } else {
        await client.query(
          `UPDATE challenge_checkpoints
              SET archived_at = now(), updated_at = now()
            WHERE challenge_id = $1 AND archived_at IS NULL`,
          [challengeId],
        );
      }
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "challenge.updated", "challenge", challengeId,
      { title: access.challenge.title, description: access.challenge.description,
        ruleSections: parseRuleSections(access.challenge.rule_sections, access.challenge.rules),
        startsOn: access.challenge.start_date, endsOn: access.challenge.end_date },
      { title, description, ruleSections, startsOn: startDate, endsOn: endDate });
    return { id: challengeId, title, description, rules, ruleSections, startsOn: startDate, endsOn: endDate };
  });
}
