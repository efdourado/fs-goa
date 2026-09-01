import { requireGroupRole, type SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { ApiError, stringValue } from "../../http";
import { assertArrayWithin, assertUnder, LIMITS } from "../../limits";
import {
  assertCatalogItemInGroup,
  resolveTags,
  setCatalogItemTags,
  upsertCatalogItem,
} from "../catalog";
import { syncDailyCheckpoints } from "../daily-checkpoints";
import { resolveRecipe } from "../challenges/recipes";
import { writeAudit } from "./audit";
import { insertField, type ClientField } from "./fields";
import { parseRuleSections, rulesCompatibilityText } from "./rules";
import { asRecord, dateRange, meetingUrlValue, publicId, semanticKey } from "./shared";

export async function createChallenge(
  session: SessionContext,
  groupId: string,
  body: Record<string, unknown>,
) {
  const title = stringValue(body, "title", { min: 1, max: 160 })!;
  const description = stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
  const meetingUrl = meetingUrlValue(body.meetingUrl);
  const ruleSections = parseRuleSections(body.ruleSections, body.rules);
  const rules = rulesCompatibilityText(ruleSections);
  const { startDate, endDate } = dateRange(
    Object.hasOwn(body, "startsOn") ? body.startsOn : body.startDate,
    Object.hasOwn(body, "endsOn") ? body.endsOn : body.endDate,
  );
  const recipe = resolveRecipe(body);
  const wizardFields = Array.isArray(body.fields) && body.fields.length ? (body.fields as ClientField[]) : null;
  if (wizardFields && wizardFields.length > 30) throw new ApiError(400, "field_limit", "Use no máximo 30 campos.");
  const wantsItems = recipe.catalogKind !== null && recipe.entryTypes.some((type) => type.submissionMode === "item");
  const wantsCheckpoints = recipe.entryTypes.some((type) => type.schedulePolicy === "checkpoint");
  const items = Array.isArray(body.items) ? body.items : [];
  assertArrayWithin(body.items, 200, "Adicione no máximo 200 itens.");
  assertArrayWithin(body.participantIds, LIMITS.membersPerGroup, "Participantes demais para um único desafio.");
  const participantIds = Array.isArray(body.participantIds)
    ? [...new Set(body.participantIds.filter((id): id is string => typeof id === "string"))]
    : [session.user.id];

  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin"], client);
    const activeGroup = await oneOrNull<{ id: string }>(
      client,
      `SELECT id FROM groups
        WHERE id=$1 AND archived_at IS NULL AND deleted_at IS NULL
        FOR UPDATE`,
      [groupId],
    );
    if (!activeGroup) throw new ApiError(404, "not_found", "Grupo não encontrado.");
    const existing = await oneOrNull<{ count: number }>(
      client,
      "SELECT count(*)::int AS count FROM challenges WHERE group_id = $1 AND deleted_at IS NULL",
      [groupId],
    );
    assertUnder(
      existing?.count ?? 0,
      LIMITS.challengesPerGroup,
      "challenge_limit",
      `Este grupo atingiu o limite de ${LIMITS.challengesPerGroup} desafios. Apague um desafio para criar outro.`,
    );

    const id = publicId();
    await client.query(
      `INSERT INTO challenges
        (id, group_id, created_by_user_id, title, description, meeting_url, rules, rule_sections, recipe_key, recipe_version,
         start_date, end_date, time_zone, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,'draft',now(),now())`,
      [id, groupId, session.user.id, title, description, meetingUrl, rules, JSON.stringify(ruleSections),
        recipe.key, recipe.version, startDate, endDate, "America/Sao_Paulo"],
    );

    let primaryTypeId = "";
    let primaryFields: Array<{ id: string; kind: string; semanticKey: string }> = [];
    const fieldByKey = new Map<string, { id: string; kind: string; entryTypeId: string }>();
    for (const type of recipe.entryTypes) {
      const typeId = publicId();
      await client.query(
        `INSERT INTO entry_types
          (id, challenge_id, semantic_key, name, submission_mode, purpose, target_policy, cardinality, schedule_policy,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())`,
        [typeId, id, type.semanticKey, type.name, type.submissionMode, type.purpose,
          type.targetPolicy, type.cardinality, type.schedulePolicy],
      );
      const typeFields = type.primary && wizardFields ? wizardFields : type.fields;
      const inserted: Array<{ id: string; kind: string; semanticKey: string }> = [];
      for (let index = 0; index < typeFields.length; index += 1) {
        const field = await insertField(client, id, typeId, typeFields[index], index);
        inserted.push(field);
        if (!fieldByKey.has(field.semanticKey)) {
          fieldByKey.set(field.semanticKey, { id: field.id, kind: field.kind, entryTypeId: typeId });
        }
      }
      if (type.primary || !primaryTypeId) {
        primaryTypeId = typeId;
        primaryFields = inserted;
      }
    }
    const entryTypeId = primaryTypeId;
    const insertedFields = primaryFields;

    if (wantsItems) {
      if (!items.length || items.length > 200) throw new ApiError(400, "item_limit", "Adicione de 1 a 200 itens.");
      const memberIds = new Set(
        (
          await client.query<{ user_id: string }>(
            "SELECT user_id FROM group_members WHERE group_id = $1 AND removed_at IS NULL",
            [groupId],
          )
        ).rows.map((row) => row.user_id),
      );
      const catalogKind = recipe.catalogKind ?? "film";
      const usedKeys = new Set<string>();
      for (let index = 0; index < items.length; index += 1) {
        const item = asRecord(items[index]);
        const itemTitle = typeof item.title === "string" ? item.title.trim() : "";
        if (!itemTitle) throw new ApiError(400, "invalid_item", "Item sem título.");

        let catalogItemId: string | null = null;
        if (typeof item.catalogItemId === "string" && item.catalogItemId) {
          await assertCatalogItemInGroup(client, item.catalogItemId, groupId, catalogKind);
          catalogItemId = item.catalogItemId;
        } else {
          catalogItemId = await upsertCatalogItem(client, groupId, session.user.id, {
            kind: catalogKind,
            title: itemTitle,
            year: item.year,
            runtimeMinutes: item.runtimeMinutes,
            pageCount: item.pageCount,
          });
        }
        if (Array.isArray(item.genres) && item.genres.length) {
          await setCatalogItemTags(client, catalogItemId, await resolveTags(client, groupId, "genre", item.genres));
        }

        let recommendedBy: string | null = null;
        if (typeof item.recommendedByUserId === "string" && item.recommendedByUserId) {
          if (!memberIds.has(item.recommendedByUserId)) {
            throw new ApiError(400, "invalid_recommender", "Quem indicou precisa ser um membro do grupo.");
          }
          recommendedBy = item.recommendedByUserId;
        }

        let itemKey = semanticKey(itemTitle, `item_${index + 1}`);
        for (let suffix = 2; usedKeys.has(itemKey); suffix += 1) {
          itemKey = `${semanticKey(itemTitle, `item_${index + 1}`)}_${suffix}`.slice(0, 64);
        }
        usedKeys.add(itemKey);

        await client.query(
          `INSERT INTO challenge_items
            (id, challenge_id, entry_type_id, catalog_item_id, recommended_by_user_id, semantic_key, title, position, metadata, created_at, updated_at)
           VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,'{}'::jsonb,now(),now())`,
          [publicId(), id, catalogItemId, recommendedBy, itemKey, itemTitle, index],
        );
      }
    }
    if (
      wantsCheckpoints
      && startDate !== null
      && endDate !== null
      && body.generateDaily !== false
    ) {
      await syncDailyCheckpoints(
        client,
        id,
        startDate,
        endDate,
        "Desafios diários podem ter no máximo 366 dias.",
      );
    }

    const requestedParticipants = participantIds.length ? participantIds : [session.user.id];
    const validParticipants = await client.query<{ user_id: string }>(
      `SELECT user_id FROM group_members
        WHERE group_id = $1 AND removed_at IS NULL AND user_id = ANY($2::text[])`,
      [groupId, requestedParticipants],
    );
    if (validParticipants.rows.length !== requestedParticipants.length) {
      throw new ApiError(400, "invalid_participant", "Todos os participantes precisam ser membros ativos do grupo.");
    }
    for (const participant of validParticipants.rows) {
      await client.query(
        `INSERT INTO challenge_participants
          (challenge_id, group_id, user_id, added_by_user_id, joined_at)
         VALUES ($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING`,
        [id, groupId, participant.user_id, session.user.id],
      );
    }

    // Seed the recipe's analysis metrics so a fresh round produces a full
    // showcase with zero config. A metric with an unresolvable `fieldKey` (the
    // wizard renamed the field away) falls back to the first numeric field.
    const fallbackNumeric = insertedFields.find((field) => field.kind === "rating" || field.kind === "number");
    let metricPosition = 0;
    for (const recipeMetric of recipe.metrics) {
      let fieldId: string | null = null;
      let metricTypeId = entryTypeId;
      if (recipeMetric.fieldKey) {
        const resolved = fieldByKey.get(recipeMetric.fieldKey)
          ?? (fallbackNumeric
            ? { id: fallbackNumeric.id, kind: fallbackNumeric.kind, entryTypeId }
            : null);
        if (!resolved) continue;
        fieldId = resolved.id;
        metricTypeId = resolved.entryTypeId;
      }
      await client.query(
        `INSERT INTO challenge_metrics
          (id, challenge_id, entry_type_id, field_id, semantic_key, label, operation,
           group_by, decimal_places, visible_during_challenge, position, settings,
           created_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,now(),now())`,
        [publicId(), id, metricTypeId, fieldId,
          semanticKey(recipeMetric.key, `metrica_${metricPosition}`), recipeMetric.label,
          recipeMetric.operation, recipeMetric.groupBy ?? "none",
          recipeMetric.operation === "completion_rate" ? 1 : 2,
          recipeMetric.visibleDuring !== false, metricPosition,
          JSON.stringify({
            visibleInResults: recipeMetric.visibleInResults !== false,
            ...recipeMetric.settings,
          }),
          session.user.id],
      );
      metricPosition += 1;
    }
    await writeAudit(client, groupId, id, session.user.id, "challenge.created", "challenge", id, null, {
      title,
      template: body.template ?? null,
    });
    return { id, challengeId: id, status: "draft" };
  });
}
