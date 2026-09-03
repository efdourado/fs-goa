import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull, withClient } from "../../db";
import { challengeAccess, dateRange, writeAudit } from "../../goa-domain";
import { ApiError, stringValue } from "../../http";
import {
  cardinalityOf,
  completionEntryType,
  entryTypesForChallenge,
  primaryEntryType,
  purposeOf,
  schedulePolicyOf,
  targetPolicyOf,
  usesRoundItems,
} from "./entry-types";
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
        id: string; title: string; description: string | null;
        position: number; opens_at: Date | null; due_at: Date | null;
        checkpoint_id: string | null;
        catalog_item_id: string | null; catalog_title: string | null;
        catalog_author: string | null; catalog_year: number | null;
        catalog_main_genre: string | null; catalog_pages: number | null;
        recommended_by_id: string | null; recommended_by_name: string | null;
      }>(
        `SELECT i.id, i.title, i.description, i.position, i.opens_at, i.due_at, i.checkpoint_id,
                i.catalog_item_id, ci.title AS catalog_title, ci.author AS catalog_author, ci.year AS catalog_year,
                ci.main_genre AS catalog_main_genre, ci.page_count AS catalog_pages,
                i.recommended_by_user_id AS recommended_by_id, ru.display_name AS recommended_by_name
           FROM challenge_items i
           LEFT JOIN catalog_items ci ON ci.id = i.catalog_item_id
           LEFT JOIN users ru ON ru.id = i.recommended_by_user_id
          WHERE i.challenge_id = $1 AND i.archived_at IS NULL ORDER BY i.position`,
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
    const allTypes = await entryTypesForChallenge(client, challengeId);
    const primaryType = await primaryEntryType(client, challengeId);
    const challengeHasPeriod =
      access.challenge.start_date !== null && access.challenge.end_date !== null;
    const fieldsByType = new Map<string, typeof fields>();
    for (const field of fields) {
      const list = fieldsByType.get(field.entryTypeId as string) ?? [];
      list.push(field);
      fieldsByType.set(field.entryTypeId as string, list);
    }
    const completionType = await completionEntryType(client, challengeId);
    const entryTypes = allTypes.map((type) => ({
      id: type.id,
      name: type.name,
      semanticKey: type.semantic_key,
      purpose: purposeOf(type),
      submissionMode: type.submission_mode,
      targetPolicy: targetPolicyOf(type),
      cardinality: cardinalityOf(type),
      schedulePolicy: schedulePolicyOf(type, challengeHasPeriod),
      isPrimary: type.is_primary || type.id === primaryType?.id,
      countsCompletion: type.id === completionType?.id,
      fields: fieldsByType.get(type.id) ?? [],
    }));
    const primaryEntryTypeId = primaryType?.id ?? null;
    const completionEntryTypeId = completionType?.id ?? null;
    const metrics = await metricsForChallenge(client, challengeId);
    const result = await resultForChallenge(client, challengeId, metrics);
    // The client's `submissionMode` answers "how does a participant pick what to
    // log". A round with catalog items is "item" even when its primary type
    // (a reading club's daily progress) is `daily`.
    const submissionMode = usesRoundItems(allTypes)
      ? "item"
      : primaryType?.submission_mode ?? "free";
    const primaryFields = primaryEntryTypeId
      ? fieldsByType.get(primaryEntryTypeId) ?? []
      : fields;
    // Checkpoints (dated sessions) are an always-available array, independent of
    // whether the round also has items. `items` stays overloaded for the
    // single-axis screens: a pure daily round still gets its checkpoints here.
    const checkpoints = checkpointsResult.rows.map((checkpoint) => ({
      id: checkpoint.id, checkpointId: checkpoint.id, title: checkpoint.title,
      description: checkpoint.description, position: checkpoint.position,
      opensAt: checkpoint.starts_at?.toISOString() ?? null,
      dueAt: checkpoint.due_at?.toISOString() ?? null,
      date: checkpoint.starts_at?.toISOString().slice(0, 10) ?? null,
      status: windowStatus(access.challenge.status, checkpoint.starts_at, checkpoint.due_at),
    }));
    const roundItems = itemsResult.rows.map((item) => ({
      id: item.id, title: item.title,
      description: item.description, position: item.position,
      checkpointId: item.checkpoint_id ?? null,
      opensAt: item.opens_at?.toISOString() ?? null, dueAt: item.due_at?.toISOString() ?? null,
      status: windowStatus(access.challenge.status, item.opens_at, item.due_at),
      catalogItem: item.catalog_item_id
        ? {
            id: item.catalog_item_id,
            title: item.catalog_title ?? item.title,
            author: item.catalog_author,
            year: item.catalog_year,
            mainGenre: item.catalog_main_genre,
            pageCount: item.catalog_pages,
          }
        : null,
      recommendedBy: item.recommended_by_id
        ? { id: item.recommended_by_id, name: item.recommended_by_name ?? "" }
        : null,
    }));
    const items = submissionMode === "daily" && access.challenge.start_date === null
      ? []
      : roundItems.length
      ? roundItems
      : checkpoints;
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
      recipeKey: access.challenge.recipe_key ?? null,
      resultsAnon: access.challenge.results_anon,
      submissionMode,
      completionEntryTypeId,
      viewerRole: access.challenge.role,
      isParticipant: access.challenge.is_participant,
      fields: primaryFields,
      entryTypes,
      items,
      checkpoints,
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
    const allTypes = await entryTypesForChallenge(client, challengeId);
    // Checkpoints are generated only for recipes that bind entries to them, not
    // for every "daily" primary type (a reading club's progress is `while_active`).
    const checkpointDriven = allTypes.some((type) => schedulePolicyOf(type, true) === "checkpoint");

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
      } else if (checkpointDriven) {
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
      `UPDATE challenges SET title=$2, description=$3, rules=$4, rule_sections=$5::jsonb,
              start_date=$6, end_date=$7, updated_at=now() WHERE id=$1`,
      [challengeId, title, description, rules, JSON.stringify(ruleSections), startDate, endDate],
    );
    if (
      checkpointDriven
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
