import { requireGroupRole, type SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { ApiError, stringValue } from "../../http";
import { assertArrayWithin, assertUnder, LIMITS } from "../../limits";
import {
  applyCatalogItemUpdate,
  assertCatalogItemInGroup,
  authorRequired,
  createCatalogItem,
  enableLibraryEventSchedule,
  findOrCreateLibraryBySource,
  resolveItemKind,
  upsertCatalogItem,
} from "../catalog";
import { syncDailyCheckpoints } from "../daily-checkpoints";
import { seedExpectationType } from "../challenges/entry-types";
import { linkChallengeLibrary, resolveItemLibrary } from "../challenges/libraries";
import { resolveItemRecommender } from "../challenges/recommender";
import { resolveRecipe } from "../challenges/recipes";
import { writeAudit } from "./audit";
import { insertField, type ClientField } from "./fields";
import { parseRuleSections, rulesCompatibilityText } from "./rules";
import { asRecord, dateRange, publicId, semanticKey, timeZoneValue } from "./shared";

/** The libraries a create request names: `libraryIds` (+ optional matching `libraryKinds`), or the older single `libraryId` / `libraryKind`. */
function namedLibraries(body: Record<string, unknown>): Array<{ libraryId?: string; libraryKind?: string }> {
  const specs: Array<{ libraryId?: string; libraryKind?: string }> = [];
  const push = (spec: { libraryId?: unknown; libraryKind?: unknown }) => {
    if (typeof spec.libraryId === "string" && spec.libraryId) specs.push({ libraryId: spec.libraryId });
    else if (typeof spec.libraryKind === "string" && spec.libraryKind) specs.push({ libraryKind: spec.libraryKind });
  };
  if (Array.isArray(body.libraries)) {
    assertArrayWithin(body.libraries, 12, "Use no máximo 12 bibliotecas.");
    for (const entry of body.libraries) push(asRecord(entry));
  }
  push(body);
  return specs;
}

export async function createChallenge(
  session: SessionContext,
  groupId: string,
  body: Record<string, unknown>,
  options: { personal?: boolean } = {},
) {
  const title = stringValue(body, "title", { min: 1, max: 160 })!;
  const description = stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
  const ruleSections = parseRuleSections(body.ruleSections, body.rules);
  const rules = rulesCompatibilityText(ruleSections);
  const { startDate, endDate } = dateRange(
    Object.hasOwn(body, "startsOn") ? body.startsOn : body.startDate,
    Object.hasOwn(body, "endsOn") ? body.endsOn : body.endDate,
  );
  const timeZone = timeZoneValue(body.timeZone, "America/Sao_Paulo");
  const recipe = resolveRecipe(body);
  // A personal challenge with no start/end is a living list ("films I've seen",
  // "books I've read") — it has no round to open or close, so it is born active
  // and can never be closed. See `transitionChallenge` and `isLivingList`.
  const livingList = options.personal === true && !startDate && !endDate;
  // "Who fills in this response?" — only a Custom challenge lets its main response be filled once
  // for the whole group instead of by each participant; every other recipe is per participant.
  const sharedPrimary = body.answerScope === "shared";
  if (body.answerScope !== undefined && body.answerScope !== "individual" && body.answerScope !== "shared") {
    throw new ApiError(400, "invalid_answer_scope", "Escolha quem preenche o registro: cada participante ou uma vez para o grupo.");
  }
  if (sharedPrimary && recipe.key !== "custom") {
    throw new ApiError(400, "shared_custom_only", "Só um desafio personalizado pode ter o registro principal compartilhado.");
  }
  const sharedEditPolicy = body.sharedEditPolicy ?? "members_fill_admin_corrects";
  if (sharedPrimary && sharedEditPolicy !== "members_fill_admin_corrects" && sharedEditPolicy !== "members_can_edit") {
    throw new ApiError(400, "invalid_shared_edit_policy", "Escolha quem pode preencher ou corrigir a resposta compartilhada.");
  }
  if (body.collectsEntryDate !== undefined && body.collectsEntryDate !== null && typeof body.collectsEntryDate !== "boolean") {
    throw new ApiError(400, "invalid_setting", "Informe se o registro pergunta quando aconteceu.");
  }
  const collectsEntryDate = typeof body.collectsEntryDate === "boolean" ? body.collectsEntryDate : null;
  const wizardFields = Array.isArray(body.fields) && body.fields.length ? (body.fields as ClientField[]) : null;
  if (wizardFields && wizardFields.length > 30) throw new ApiError(400, "field_limit", "Use no máximo 30 campos.");
  const wantsItems = (recipe.catalogKind !== null || recipe.catalogKindFromBody === true)
    && recipe.entryTypes.some((type) => type.submissionMode === "item");
  const wantsCheckpoints = recipe.entryTypes.some((type) => type.schedulePolicy === "checkpoint");
  const items = Array.isArray(body.items) ? body.items : [];
  assertArrayWithin(body.items, 200, "Adicione no máximo 200 itens.");
  assertArrayWithin(body.participantIds, LIMITS.membersPerGroup, "Participantes demais para um único desafio.");
  const participantIds = options.personal
    ? [session.user.id]
    : Array.isArray(body.participantIds)
    ? [...new Set(body.participantIds.filter((id): id is string => typeof id === "string"))]
    : [session.user.id];

  return inTransaction(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin"], client);
    const activeGroup = await oneOrNull<{ id: string }>(
      client,
      `SELECT id FROM groups
        WHERE id=$1 AND kind=$2
          AND ($2 <> 'personal' OR owner_user_id=$3)
          AND archived_at IS NULL AND deleted_at IS NULL
        FOR UPDATE`,
      [groupId, options.personal ? "personal" : "standard", session.user.id],
    );
    if (!activeGroup) throw new ApiError(404, "not_found", "Grupo não encontrado.");
    const existing = await oneOrNull<{ count: number }>(
      client,
      // A challenge counts while it is live or sitting in a bin the owner can
      // empty (the bin never expires — ROADMAP §13). A row that is soft-deleted
      // with no `trash_items` record is a ghost from before the bin registry
      // existed: it is invisible and unrecoverable, so it must not hold a slot.
      `SELECT count(*)::int AS count FROM challenges c
        WHERE c.group_id = $1
          AND (c.deleted_at IS NULL
               OR EXISTS (SELECT 1 FROM trash_items ti
                           WHERE ti.entity_kind = 'challenge' AND ti.entity_id = c.id))`,
      [groupId],
    );
    const limit = options.personal ? LIMITS.challengesPerPersonalSpace : LIMITS.challengesPerGroup;
    assertUnder(
      existing?.count ?? 0,
      limit,
      "challenge_limit",
      options.personal
        ? `Seu espaço pessoal atingiu o limite de ${limit} desafios. Restaure ou exclua um da sua lixeira (Sua conta → Sua lixeira) para criar outro.`
        : `Este grupo atingiu o limite de ${limit} desafios. Apague um desafio da lixeira para criar outro.`,
    );

    const id = publicId();
    const status = livingList ? "active" : "draft";
    const kind = livingList ? "list" : "round";
    await client.query(
      `INSERT INTO challenges
        (id, group_id, created_by_user_id, title, description, rules, rule_sections, recipe_key, recipe_version,
         start_date, end_date, time_zone, kind, status, collects_entry_date, activated_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,
               CASE WHEN $14 = 'active' THEN now() END, now(), now())`,
      [id, groupId, session.user.id, title, description, rules, JSON.stringify(ruleSections),
        recipe.key, recipe.version, startDate, endDate, timeZone, kind, status, collectsEntryDate],
    );

    let primaryTypeId = "";
    let completionTypeId = "";
    const fieldByKey = new Map<string, { id: string; kind: string; entryTypeId: string }>();
    const hasExplicitPrimary = recipe.entryTypes.some((type) => type.primary);
    for (let typeIndex = 0; typeIndex < recipe.entryTypes.length; typeIndex += 1) {
      const type = recipe.entryTypes[typeIndex];
      const typeId = publicId();
      const isPrimary = hasExplicitPrimary ? type.primary === true : typeIndex === 0;
      const shared = sharedPrimary && type.primary === true;
      await client.query(
        `INSERT INTO entry_types
          (id, challenge_id, semantic_key, name, submission_mode, purpose, target_policy, cardinality, schedule_policy,
           is_primary, answer_scope, shared_edit_policy, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now())`,
        [typeId, id, type.semanticKey, type.name, type.submissionMode, type.purpose,
          type.targetPolicy, type.cardinality, type.schedulePolicy, isPrimary,
          shared ? "shared" : "individual", shared ? sharedEditPolicy : null],
      );
      if (type.purpose === "completion") completionTypeId = typeId;
      const typeFields = type.primary && wizardFields ? wizardFields : type.fields;
      for (let index = 0; index < typeFields.length; index += 1) {
        const field = await insertField(client, id, typeId, typeFields[index], index);
        if (!fieldByKey.has(field.semanticKey)) {
          fieldByKey.set(field.semanticKey, { id: field.id, kind: field.kind, entryTypeId: typeId });
        }
      }
      if (isPrimary || !primaryTypeId) {
        primaryTypeId = typeId;
      }
    }
    const entryTypeId = primaryTypeId;

    // The optional Cinema/Estante "Expectativa" type (V1 §3.1) — a pre-watch
    // rating that locks once the real one is in. Enabled here or later in the
    // admin Fields tab; only meaningful over a rating recipe with round items.
    const wantsExpectation =
      body.expectation === true
      && wantsItems
      && recipe.entryTypes.some((type) => type.purpose === "rating");
    if (wantsExpectation) {
      await seedExpectationType(client, id);
    }

    if (wantsItems) {
      if (!items.length || items.length > 200) throw new ApiError(400, "item_limit", "Adicione de 1 a 200 itens.");
      const memberIds = options.personal
        ? new Set([session.user.id])
        : new Set(
            (
              await client.query<{ user_id: string }>(
                "SELECT user_id FROM group_members WHERE group_id = $1 AND removed_at IS NULL",
                [groupId],
              )
            ).rows.map((row) => row.user_id),
          );
      // The libraries this challenge draws from, stored on the challenge itself.
      // Cinema/Estante/Library track their fixed one; Tables the workspace's own
      // Tables library (created on first use); `custom` only what the caller
      // names. Any recipe can also be given more libraries — Movies and TV Shows
      // in one list — via `libraryIds` (or the older single `libraryId`).
      const linkedKinds: string[] = [];
      const link = async (kind: string) => {
        if (linkedKinds.includes(kind)) return;
        await linkChallengeLibrary(client, id, groupId, kind, session.user.id);
        linkedKinds.push(kind);
      };
      const named = namedLibraries(body);
      if (recipe.catalogKind) await link(recipe.catalogKind);
      const namedKinds: string[] = [];
      for (const spec of named) namedKinds.push(await resolveItemKind(client, groupId, spec));
      if (recipe.defaultLibrarySource) {
        // The preset's own library — unless the caller already picked one of that kind themselves.
        const picked = namedKinds.length
          ? await oneOrNull<{ id: string }>(
              client,
              "SELECT id FROM catalog_libraries WHERE group_id = $1 AND kind = ANY($2::text[]) AND source = $3 LIMIT 1",
              [groupId, namedKinds, recipe.defaultLibrarySource],
            )
          : null;
        if (!picked) await link(await findOrCreateLibraryBySource(client, groupId, session.user.id, recipe.defaultLibrarySource));
      }
      for (const kind of namedKinds) await link(kind);
      if (!linkedKinds.length) throw new ApiError(400, "invalid_library", "Escolha a biblioteca de onde vêm os itens.");
      // "Each item has its own date and time" (a match's kickoff): the libraries this challenge draws
      // from start asking for it. A property of the library, so other challenges on it read the same date.
      if (body.itemDates === true) {
        for (const kind of linkedKinds) await enableLibraryEventSchedule(client, groupId, session.user.id, kind);
      }
      const linkedRows = linkedKinds.map((kind, position) => ({ id: null, kind, source: "", label: null, position }));
      const usedKeys = new Set<string>();
      for (let index = 0; index < items.length; index += 1) {
        const item = asRecord(items[index]);
        const itemTitle = typeof item.title === "string" ? item.title.trim() : "";
        if (!itemTitle) throw new ApiError(400, "invalid_item", "Item sem título.");
        const itemAuthor = typeof item.author === "string" ? item.author.trim() : "";
        // Each item names its library, or takes the challenge's only one.
        const catalogKind = await resolveItemLibrary(client, { id, group_id: groupId }, linkedRows, item, item.catalogItemId);
        if (!itemAuthor && await authorRequired(client, groupId, catalogKind)) {
          throw new ApiError(400, "invalid_item", "Informe o autor de cada livro.");
        }

        let catalogItemId: string | null = null;
        if (typeof item.catalogItemId === "string" && item.catalogItemId) {
          await assertCatalogItemInGroup(client, item.catalogItemId, groupId, catalogKind);
          catalogItemId = item.catalogItemId;
          if (itemAuthor || item.attributes || Object.hasOwn(item, "scheduledAt")) {
            await applyCatalogItemUpdate(
              client,
              catalogItemId,
              groupId,
              {
                ...(itemAuthor ? { author: itemAuthor } : {}),
                attributes: item.attributes,
                ...(Object.hasOwn(item, "scheduledAt") ? { scheduledAt: item.scheduledAt } : {}),
              },
              catalogKind,
            );
          }
        } else if (catalogKind === "film" || catalogKind === "book") {
          catalogItemId = await upsertCatalogItem(client, groupId, session.user.id, {
            kind: catalogKind,
            title: itemTitle,
            author: item.author,
            year: item.year,
            mainGenre: item.mainGenre,
            pageCount: item.pageCount,
            runtimeMinutes: item.runtimeMinutes,
            scheduledAt: item.scheduledAt,
            attributes: item.attributes,
          });
        } else {
          // Every other kind never merges on a title match (Phase 2) — each
          // row the caller didn't explicitly reuse via `catalogItemId` above
          // becomes its own new item, even if an earlier row in this same
          // batch used the same title.
          catalogItemId = await createCatalogItem(client, groupId, session.user.id, {
            kind: catalogKind,
            title: itemTitle,
            attributes: item.attributes,
            scheduledAt: item.scheduledAt,
          });
        }

        // A member, a saved outside name or a free-text note — at most one.
        const recommender = await resolveItemRecommender(client, groupId, item, memberIds);

        let itemKey = semanticKey(itemTitle, `item_${index + 1}`);
        for (let suffix = 2; usedKeys.has(itemKey); suffix += 1) {
          itemKey = `${semanticKey(itemTitle, `item_${index + 1}`)}_${suffix}`.slice(0, 64);
        }
        usedKeys.add(itemKey);

        await client.query(
          `INSERT INTO challenge_items
            (id, challenge_id, entry_type_id, catalog_item_id, recommended_by_user_id, recommended_by_external_id, origin_note, semantic_key, title, position, metadata, created_at, updated_at)
           VALUES ($1,$2,NULL,$3,$4,$9,$5,$6,$7,$8,'{}'::jsonb,now(),now())`,
          [publicId(), id, catalogItemId, recommender.userId, recommender.note, itemKey, itemTitle, index, recommender.externalId],
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
    // showcase with zero config. A metric whose `fieldKey` no longer resolves
    // (the wizard renamed the field away) is **skipped**, not re-pointed at some
    // other numeric field — a metric labelled "Nota média" must never quietly
    // average a different measure. The admin adds the right one later.
    let metricPosition = 0;
    for (const recipeMetric of recipe.metrics) {
      // A solo round has no disagreement or curator dynamics, and a Bayesian
      // shrink toward a one-person prior is meaningless — seed a plain average
      // and drop the group-only metrics entirely.
      if (options.personal && recipeMetric.needsGroup) continue;
      const soloRanking = options.personal === true && recipeMetric.operation === "bayesian_average";
      const operation = soloRanking ? "average" : recipeMetric.operation;
      const settings = soloRanking ? { minSample: 1 } : recipeMetric.settings;
      let fieldId: string | null = null;
      // Completion rate counts the "done" signal — a dedicated completion type
      // when the recipe has one, otherwise the primary type.
      let metricTypeId = operation === "completion_rate" && completionTypeId
        ? completionTypeId
        : entryTypeId;
      if (recipeMetric.fieldKey) {
        const resolved = fieldByKey.get(recipeMetric.fieldKey);
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
          operation, recipeMetric.groupBy ?? "none",
          operation === "completion_rate" ? 1 : 2,
          recipeMetric.visibleDuring !== false, metricPosition,
          JSON.stringify({
            visibleInResults: recipeMetric.visibleInResults !== false,
            ...settings,
          }),
          session.user.id],
      );
      metricPosition += 1;
    }
    await writeAudit(client, groupId, id, session.user.id, "challenge.created", "challenge", id, null, {
      title,
      template: body.template ?? null,
      livingList,
    });
    return { id, challengeId: id, status, kind };
  });
}

/**
 * Find-or-create the caller's hidden personal workspace: a `kind='personal'`
 * group they solely own, the backing store for challenges run on their own. It
 * is idempotent and sits outside the `groupsPerOwner` cap.
 */
export async function ensurePersonalWorkspace(userId: string): Promise<string> {
  return inTransaction(async (client) => {
    const readId = () =>
      oneOrNull<{ id: string }>(
        client,
        "SELECT id FROM groups WHERE owner_user_id = $1 AND kind = 'personal' AND deleted_at IS NULL",
        [userId],
      );
    const existing = await readId();
    // The partial unique index makes this a no-op under a concurrent request;
    // re-read to pick up whichever row won.
    if (!existing) {
      await client.query(
        `INSERT INTO groups (id, name, kind, owner_user_id, created_at, updated_at)
         VALUES ($1, 'Pessoal', 'personal', $2, now(), now())
         ON CONFLICT DO NOTHING`,
        [publicId(), userId],
      );
    }
    const workspaceId = existing?.id ?? (await readId())?.id;
    if (!workspaceId) throw new ApiError(500, "workspace_unavailable", "Não foi possível preparar seu espaço pessoal.");
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role, added_by_user_id, joined_at)
       VALUES ($1, $2, 'owner', $2, now())
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         role = 'owner',
         removed_at = NULL,
         joined_at = CASE WHEN group_members.removed_at IS NULL THEN group_members.joined_at ELSE now() END`,
      [workspaceId, userId],
    );
    return workspaceId;
  });
}

/** Creates a challenge in the caller's personal workspace, making it on demand. */
export async function createPersonalChallenge(
  session: SessionContext,
  body: Record<string, unknown>,
) {
  const workspaceId = await ensurePersonalWorkspace(session.user.id);
  return createChallenge(session, workspaceId, body, { personal: true });
}
