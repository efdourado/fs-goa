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
import { writeAudit } from "./audit";
import { defaultFields, insertField, type ClientField } from "./fields";
import { parseRuleSections, rulesCompatibilityText } from "./rules";
import { asRecord, dateRange, meetingUrlValue, publicId, semanticKey } from "./shared";

const SUBMISSION_MODES = new Set(["item", "daily", "free"]);

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
  const submissionMode = typeof body.submissionMode === "string" ? body.submissionMode : body.template === "reading" ? "daily" : "item";
  if (!SUBMISSION_MODES.has(submissionMode)) throw new ApiError(400, "submission_mode", "Modo de registro inválido.");
  const fields = Array.isArray(body.fields) && body.fields.length ? (body.fields as ClientField[]) : defaultFields(body.template);
  if (fields.length > 30) throw new ApiError(400, "field_limit", "Use no máximo 30 campos.");
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
        (id, group_id, created_by_user_id, title, description, meeting_url, rules, rule_sections, start_date, end_date,
         time_zone, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'draft',now(),now())`,
      [id, groupId, session.user.id, title, description, meetingUrl, rules, JSON.stringify(ruleSections), startDate, endDate, "America/Sao_Paulo"],
    );
    const entryTypeId = publicId();
    await client.query(
      `INSERT INTO entry_types
        (id, challenge_id, semantic_key, name, submission_mode, created_at, updated_at)
       VALUES ($1,$2,'registro','Registro',$3,now(),now())`,
      [entryTypeId, id, submissionMode],
    );

    const insertedFields: Array<{ id: string; kind: string; semanticKey: string }> = [];
    for (let index = 0; index < fields.length; index += 1) {
      insertedFields.push(await insertField(client, id, entryTypeId, fields[index], index));
    }

    if (submissionMode === "item") {
      if (!items.length || items.length > 200) throw new ApiError(400, "item_limit", "Adicione de 1 a 200 itens.");
      const memberIds = new Set(
        (
          await client.query<{ user_id: string }>(
            "SELECT user_id FROM group_members WHERE group_id = $1 AND removed_at IS NULL",
            [groupId],
          )
        ).rows.map((row) => row.user_id),
      );
      const catalogKind = body.template === "reading" ? "book" : "film";
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

        await client.query(
          `INSERT INTO challenge_items
            (id, challenge_id, entry_type_id, catalog_item_id, recommended_by_user_id, semantic_key, title, position, metadata, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}'::jsonb,now(),now())`,
          [publicId(), id, entryTypeId, catalogItemId, recommendedBy, semanticKey(itemTitle, `item_${index + 1}`), itemTitle, index],
        );
      }
    } else if (
      submissionMode === "daily"
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

    const numeric = insertedFields.find((field) => field.kind === "rating" || field.kind === "number");
    if (numeric) {
      await client.query(
        `INSERT INTO challenge_metrics
          (id, challenge_id, entry_type_id, field_id, semantic_key, label, operation,
           group_by, decimal_places, visible_during_challenge, position, settings,
           created_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'average','none',2,true,0,'{}'::jsonb,$7,now(),now())`,
        [publicId(), id, entryTypeId, numeric.id, `media_${numeric.semanticKey}`, `Média de ${fields.find((field) => semanticKey(field.key, "") === numeric.semanticKey)?.label ?? "valores"}`, session.user.id],
      );
    }
    await client.query(
      `INSERT INTO challenge_metrics
        (id, challenge_id, entry_type_id, field_id, semantic_key, label, operation,
         group_by, decimal_places, visible_during_challenge, position, settings,
         created_by_user_id, created_at, updated_at)
       VALUES ($1,$2,$3,NULL,'taxa_conclusao','Taxa de conclusão','completion_rate',
               'none',1,true,1,'{}'::jsonb,$4,now(),now())`,
      [publicId(), id, entryTypeId, session.user.id],
    );
    await writeAudit(client, groupId, id, session.user.id, "challenge.created", "challenge", id, null, {
      title,
      template: body.template ?? null,
    });
    return { id, challengeId: id, status: "draft" };
  });
}
