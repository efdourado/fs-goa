import type { PoolClient } from "pg";

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
import { recipeCollectsEntryDate } from "./recipes";
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

type ChallengeStatus = "draft" | "active" | "closed";

/**
 * The round's items (with their catalogue facts + a privacy-masked recommender),
 * shaped for the client. Shared by the in-group detail and the public template
 * preview.
 */
export async function detailItems(
  client: PoolClient,
  challengeId: string,
  groupId: string,
  status: ChallengeStatus,
) {
  const result = await client.query<{
    id: string; title: string; description: string | null;
    position: number; opens_at: Date | null; due_at: Date | null;
    checkpoint_id: string | null; origin_note: string | null;
    catalog_item_id: string | null; catalog_title: string | null;
    catalog_author: string | null; catalog_year: number | null;
    catalog_main_genre: string | null; catalog_pages: number | null; catalog_runtime_minutes: number | null;
    recommended_by_id: string | null; recommended_by_name: string | null;
  }>(
    // A recommender who left the group (or whose account is gone) never shows
    // their name to the group again — `recommended_by_id` goes null right
    // along with it, same as a deleted account already reads "Conta removida".
    `SELECT i.id, i.title, i.description, i.position, i.opens_at, i.due_at, i.checkpoint_id, i.origin_note,
            i.catalog_item_id, ci.title AS catalog_title, ci.author AS catalog_author, ci.year AS catalog_year,
            ci.main_genre AS catalog_main_genre, ci.page_count AS catalog_pages, ci.runtime_minutes AS catalog_runtime_minutes,
            CASE WHEN active_recommender.user_id IS NOT NULL THEN i.recommended_by_user_id END AS recommended_by_id,
            CASE WHEN active_recommender.user_id IS NOT NULL THEN ru.display_name END AS recommended_by_name
       FROM challenge_items i
       LEFT JOIN catalog_items ci ON ci.id = i.catalog_item_id
       LEFT JOIN users ru ON ru.id = i.recommended_by_user_id
       LEFT JOIN group_members active_recommender
         ON active_recommender.group_id = $2
        AND active_recommender.user_id = i.recommended_by_user_id
        AND active_recommender.removed_at IS NULL
      WHERE i.challenge_id = $1 AND i.archived_at IS NULL ORDER BY i.position`,
    [challengeId, groupId],
  );
  return result.rows.map((item) => ({
    id: item.id, title: item.title,
    description: item.description, position: item.position,
    checkpointId: item.checkpoint_id ?? null,
    originNote: item.origin_note ?? null,
    opensAt: item.opens_at?.toISOString() ?? null, dueAt: item.due_at?.toISOString() ?? null,
    status: windowStatus(status, item.opens_at, item.due_at),
    catalogItem: item.catalog_item_id
      ? {
          id: item.catalog_item_id,
          title: item.catalog_title ?? item.title,
          author: item.catalog_author,
          year: item.catalog_year,
          mainGenre: item.catalog_main_genre,
          pageCount: item.catalog_pages,
          runtimeMinutes: item.catalog_runtime_minutes,
        }
      : null,
    recommendedBy: item.recommended_by_id
      ? { id: item.recommended_by_id, name: item.recommended_by_name ?? "" }
      : null,
  }));
}

/** The dated sessions (weeks / milestones / generated days), shaped for the client. */
export async function detailCheckpoints(
  client: PoolClient,
  challengeId: string,
  status: ChallengeStatus,
) {
  const result = await client.query<{
    id: string; title: string; description: string | null; position: number; kind: string;
    starts_at: Date | null; due_at: Date | null;
    item_count: number; total_runtime_minutes: number | null;
  }>(
    `SELECT cc.id, cc.title, cc.description, cc.position, cc.kind, cc.starts_at, cc.due_at,
            count(i.id)::int AS item_count,
            nullif(sum(ci.runtime_minutes), 0)::int AS total_runtime_minutes
       FROM challenge_checkpoints cc
       LEFT JOIN challenge_items i ON i.checkpoint_id = cc.id AND i.archived_at IS NULL
       LEFT JOIN catalog_items ci ON ci.id = i.catalog_item_id
      WHERE cc.challenge_id = $1 AND cc.archived_at IS NULL
      GROUP BY cc.id
      ORDER BY cc.position`,
    [challengeId],
  );
  const now = Date.now();
  return result.rows.map((checkpoint) => ({
    id: checkpoint.id, checkpointId: checkpoint.id, title: checkpoint.title,
    description: checkpoint.description, position: checkpoint.position,
    kind: checkpoint.kind as "day" | "week" | "session" | "milestone",
    opensAt: checkpoint.starts_at?.toISOString() ?? null,
    dueAt: checkpoint.due_at?.toISOString() ?? null,
    date: checkpoint.starts_at?.toISOString().slice(0, 10) ?? null,
    status: windowStatus(status, checkpoint.starts_at, checkpoint.due_at),
    itemCount: checkpoint.item_count,
    totalRuntimeMinutes: checkpoint.total_runtime_minutes,
    timeframe: checkpoint.starts_at && checkpoint.starts_at.getTime() > now
      ? "future" as const
      : checkpoint.due_at && checkpoint.due_at.getTime() <= now
      ? "past" as const
      : "current" as const,
  }));
}

export interface DetailChallengeRow {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  rules: string | null;
  rule_sections: unknown;
  start_date: string | null;
  end_date: string | null;
  status: ChallengeStatus;
  kind: "round" | "list";
  recipe_key: string | null;
  group_kind: string | null;
  results_anon: boolean;
}

type ParticipantRow = { id: string; display_name: string; username: string; name_consent: boolean };

/**
 * Shapes a `ChallengeDetail` from an already-loaded challenge row. `getChallengeDetail`
 * feeds it the in-group view (real participants, live result); `getTemplatePreview`
 * feeds it the public view (no participants, the frozen published showcase).
 */
export async function buildChallengeDetail(
  client: PoolClient,
  ch: DetailChallengeRow,
  viewer: { userId: string | null; role: string | null; isParticipant: boolean },
  opts: { participants?: ParticipantRow[]; result?: unknown } = {},
) {
  const challengeId = ch.id;
  const fields = await fieldsForChallenge(client, challengeId);
  const participants = opts.participants
    ?? (await client.query<ParticipantRow>(
      `SELECT u.id, u.display_name, u.username, cp.name_consent
         FROM challenge_participants cp JOIN users u ON u.id = cp.user_id
        WHERE cp.challenge_id = $1 AND cp.removed_at IS NULL ORDER BY u.display_name`,
      [challengeId],
    )).rows;
  const allTypes = await entryTypesForChallenge(client, challengeId);
  const primaryType = await primaryEntryType(client, challengeId);
  const challengeHasPeriod = ch.start_date !== null && ch.end_date !== null;
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
    visibilityPolicy: type.visibility_policy,
    fields: fieldsByType.get(type.id) ?? [],
  }));
  const primaryEntryTypeId = primaryType?.id ?? null;
  const completionEntryTypeId = completionType?.id ?? null;
  const metrics = await metricsForChallenge(client, challengeId);
  // Rankings + affinity update live while the round is open (ROADMAP §11). Once
  // closed they are frozen in `result_blocks` and this flag is a no-op. The
  // template preview passes its own `result` (the frozen published snapshot).
  const result = "result" in opts
    ? opts.result
    : await resultForChallenge(client, challengeId, metrics, { liveRankings: true });
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
  const checkpoints = await detailCheckpoints(client, challengeId, ch.status);
  const roundItems = await detailItems(client, challengeId, ch.group_id, ch.status);
  const items = submissionMode === "daily" && ch.start_date === null
    ? []
    : roundItems.length
    ? roundItems
    : checkpoints;
  return {
    id: ch.id,
    groupId: ch.group_id,
    title: ch.title,
    description: ch.description,
    rules: ch.rules,
    ruleSections: parseRuleSections(ch.rule_sections, ch.rules),
    startsOn: ch.start_date,
    endsOn: ch.end_date,
    status: ch.status,
    kind: ch.kind,
    recipeKey: ch.recipe_key ?? null,
    scope: ch.group_kind === "personal" ? "personal" : "group",
    collectsEntryDate: recipeCollectsEntryDate(ch.recipe_key),
    resultsAnon: ch.results_anon,
    submissionMode,
    completionEntryTypeId,
    viewerRole: viewer.role,
    isParticipant: viewer.isParticipant,
    // The viewer's own name-in-publication consent for this challenge (V1 §12).
    viewerNameConsent: participants.find((row) => row.id === viewer.userId)?.name_consent ?? false,
    fields: primaryFields,
    entryTypes,
    items,
    checkpoints,
    participants: participants.map((participant) => ({
      id: participant.id, userId: participant.id, name: participant.display_name, username: participant.username,
      nameConsent: participant.name_consent,
    })),
    metrics,
    result,
  };
}

export async function getChallengeDetail(session: SessionContext, challengeId: string) {
  return withClient(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client);
    return buildChallengeDetail(
      client,
      access.challenge as unknown as DetailChallengeRow,
      {
        userId: session.user.id,
        role: access.challenge.role,
        isParticipant: access.challenge.is_participant,
      },
    );
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
