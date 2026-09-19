import type { PoolClient } from "pg";
import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import {
  asRecord,
  challengeAccess,
  dateString,
  integerValue,
  publicId,
  semanticKey,
  writeAudit,
} from "../../goa-domain";
import { ApiError, stringValue } from "../../http";
import {
  applyCatalogItemUpdate,
  assertCatalogItemInGroup,
  assertRecommendationsAllowed,
  assertRecommenderInGroup,
  authorRequired,
  createCatalogItem,
  upsertCatalogItem,
} from "../catalog";
import { ensureChallengeLibraries, resolveItemLibrary } from "./libraries";
import { midnightInTimeZone } from "../domain/shared";
import { resolveItemRecommender } from "./recommender";
import { syncDailyCheckpoints } from "../daily-checkpoints";
import {
  entryTypesForChallenge,
  primaryEntryType,
  usesRoundItems,
} from "./entry-types";

export async function generateDailyCheckpoints(
  client: PoolClient,
  challengeId: string,
  startsOn: string,
  endsOn: string,
): Promise<string[]> {
  return syncDailyCheckpoints(client, challengeId, startsOn, endsOn);
}

/**
 * `(challenge_id, semantic_key)` is unique across archived rows too, so an item
 * added after another was archived can clash on the slug. Resolve it here.
 */
async function uniqueItemKey(
  client: PoolClient,
  challengeId: string,
  desired: unknown,
  position: number,
): Promise<string> {
  const base = semanticKey(desired, `item_${position + 1}`);
  const taken = new Set(
    (
      await client.query<{ semantic_key: string }>(
        "SELECT semantic_key FROM challenge_items WHERE challenge_id=$1",
        [challengeId],
      )
    ).rows.map((row) => row.semantic_key),
  );
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1_000; suffix += 1) {
    const candidate = `${base}_${suffix}`.slice(0, 64);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${publicId().slice(0, 8)}`.slice(0, 64);
}

/** Creates a new catalog item for `kind` — film/book keep their existing auto-match, every other kind never merges (Phase 2). */
async function createChallengeCatalogItem(
  client: PoolClient,
  groupId: string,
  userId: string,
  kind: string,
  title: string,
  extra: {
    author?: unknown; year?: unknown; mainGenre?: unknown; pageCount?: unknown; runtimeMinutes?: unknown;
    scheduledAt?: unknown; attributes?: unknown;
  } = {},
): Promise<string> {
  return kind === "film" || kind === "book"
    ? upsertCatalogItem(client, groupId, userId, { kind, title, ...extra })
    : createCatalogItem(client, groupId, userId, { kind, title, attributes: extra.attributes, scheduledAt: extra.scheduledAt });
}

/**
 * An item's schedule (Phase 5): no schedule, a date only, or a date and
 * time — never a deadline that blocks recording a score (nothing in
 * `saveEntry` ever reads `challenge_items.due_at`). `opensOn`/`dueOn`
 * (YYYY-MM-DD) and `opensAt`/`dueAt` (a precise instant) are mutually
 * exclusive per call — mixing them in one request is rejected rather than
 * guessed. Like `dateRange`, touching the schedule at all replaces both
 * boundaries together; untouched, both boundaries and the precision stay
 * exactly as they were.
 */
function resolveItemSchedule(
  body: Record<string, unknown>,
  timeZone: string,
  current: { opensAt: Date | null; dueAt: Date | null; schedulePrecision: "date" | "datetime" },
): { opensAt: Date | null; dueAt: Date | null; schedulePrecision: "date" | "datetime"; touched: boolean } {
  const hasDatetime = Object.hasOwn(body, "opensAt") || Object.hasOwn(body, "dueAt");
  const hasDateOnly = Object.hasOwn(body, "opensOn") || Object.hasOwn(body, "dueOn");
  if (hasDatetime && hasDateOnly) {
    throw new ApiError(400, "invalid_schedule", "Use data e hora ou só a data para os dois limites do item, não uma mistura.");
  }
  if (!hasDatetime && !hasDateOnly) return { ...current, touched: false };

  let opensAt: Date | null;
  let dueAt: Date | null;
  if (hasDateOnly) {
    const opensOn = body.opensOn === undefined || body.opensOn === null || body.opensOn === ""
      ? null : dateString(body.opensOn, "Data de abertura");
    const dueOn = body.dueOn === undefined || body.dueOn === null || body.dueOn === ""
      ? null : dateString(body.dueOn, "Data de prazo");
    opensAt = opensOn ? midnightInTimeZone(opensOn, timeZone) : null;
    dueAt = dueOn ? midnightInTimeZone(dueOn, timeZone) : null;
  } else {
    const parseInstant = (value: unknown, name: string): Date | null => {
      if (value === undefined || value === null || value === "") return null;
      if (typeof value !== "string") throw new ApiError(400, "invalid_schedule", `${name} inválida.`);
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new ApiError(400, "invalid_schedule", `${name} inválida.`);
      return parsed;
    };
    opensAt = parseInstant(body.opensAt, "Abertura");
    dueAt = parseInstant(body.dueAt, "Prazo");
  }
  if (opensAt && dueAt && dueAt.getTime() < opensAt.getTime()) {
    throw new ApiError(400, "invalid_schedule", "O prazo precisa ser igual ou posterior à abertura.");
  }
  return { opensAt, dueAt, schedulePrecision: hasDateOnly ? "date" : "datetime", touched: true };
}

/** Validates that a checkpoint id (or null) belongs to this challenge. */
async function resolveCheckpointId(
  client: PoolClient,
  challengeId: string,
  raw: unknown,
): Promise<string | null> {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new ApiError(400, "invalid_checkpoint", "Checkpoint inválido.");
  const row = await oneOrNull<{ id: string }>(
    client,
    "SELECT id FROM challenge_checkpoints WHERE id = $1 AND challenge_id = $2 AND archived_at IS NULL",
    [raw, challengeId],
  );
  if (!row) throw new ApiError(400, "invalid_checkpoint", "Checkpoint inexistente neste desafio.");
  return row.id;
}

export async function addChallengeItem(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const title = stringValue(body, "title", { max: 200 })!;
  const description = stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
  const author = stringValue(body, "author", { max: 200, optional: true }) ?? null;
  const originNote = stringValue(body, "originNote", { max: 200, optional: true }) ?? null;
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem criar itens.");
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_locked", "Itens não podem ser criados depois do encerramento.");
    const types = await entryTypesForChallenge(client, challengeId);
    if (!usesRoundItems(types)) throw new ApiError(409, "invalid_mode", "Este desafio não usa itens.");
    const linked = await ensureChallengeLibraries(client, access.challenge, session.user.id);
    const catalogKind = await resolveItemLibrary(client, access.challenge, linked, body, body.catalogItemId);
    if (!author && await authorRequired(client, access.challenge.group_id, catalogKind)) {
      throw new ApiError(400, "invalid_item", "Informe o autor de cada livro.");
    }
    const position = integerValue(body.position, 0, 0, 10_000);
    const checkpointId = await resolveCheckpointId(client, challengeId, body.checkpointId);
    const recommender = await resolveItemRecommender(client, access.challenge.group_id, { ...body, originNote });
    const id = publicId();
    let catalogItemId: string;
    if (typeof body.catalogItemId === "string" && body.catalogItemId) {
      await assertCatalogItemInGroup(client, body.catalogItemId, access.challenge.group_id, catalogKind);
      catalogItemId = body.catalogItemId;
      const update: Record<string, unknown> = {};
      if (author) update.author = author;
      if (Object.hasOwn(body, "scheduledAt")) update.scheduledAt = body.scheduledAt;
      if (Object.keys(update).length) await applyCatalogItemUpdate(client, catalogItemId, access.challenge.group_id, update);
    } else {
      catalogItemId = await createChallengeCatalogItem(client, access.challenge.group_id, session.user.id, catalogKind, title, {
        author, scheduledAt: body.scheduledAt,
      });
    }
    await client.query(
      `INSERT INTO challenge_items
        (id, challenge_id, entry_type_id, catalog_item_id, recommended_by_user_id, recommended_by_external_id, checkpoint_id, origin_note, semantic_key, title, description, position, metadata, created_at, updated_at)
       VALUES ($1,$2,NULL,$3,$4,$11,$5,$6,$7,$8,$9,$10,'{}'::jsonb,now(),now())`,
      [id, challengeId, catalogItemId, recommender.userId, checkpointId, recommender.note,
        await uniqueItemKey(client, challengeId, body.key ?? title, position), title, description, position, recommender.externalId],
    );
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "item.created", "challenge_item", id, null, { title });
    return { id, title, position };
  });
}

export async function saveChallengeItems(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const generation = asRecord(body.generate);
  if (generation.frequency === "daily") {
    const startsOn = dateString(generation.startsOn, "Data inicial");
    const endsOn = dateString(generation.endsOn, "Data final");
    if (endsOn < startsOn) throw new ApiError(400, "date_range", "A data final deve ser posterior ao início.");
    return inTransaction(async (client) => {
      const access = await challengeAccess(session.user.id, challengeId, client, true);
      if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem gerar checkpoints.");
      if (access.challenge.status === "closed") throw new ApiError(409, "challenge_locked", "Checkpoints não podem ser gerados depois do encerramento.");
      const primary = await primaryEntryType(client, challengeId);
      if (primary?.submission_mode !== "daily") {
        throw new ApiError(409, "invalid_mode", "Este desafio não usa checkpoints diários.");
      }
      if (startsOn !== access.challenge.start_date || endsOn !== access.challenge.end_date) {
        throw new ApiError(400, "date_range", "Os checkpoints diários precisam cobrir todo o período do desafio.");
      }
      const ids = await generateDailyCheckpoints(client, challengeId, startsOn, endsOn);
      await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
        "checkpoints.generated", "challenge", challengeId, null, { startsOn, endsOn, count: ids.length });
      return { checkpointIds: ids };
    });
  }
  if (!Array.isArray(body.items)) return addChallengeItem(session, challengeId, body);
  const requestedItems = body.items;
  if (!requestedItems.length || requestedItems.length > 200) throw new ApiError(400, "item_limit", "Use de 1 a 200 itens.");
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem criar itens.");
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_locked", "Itens não podem ser editados depois do encerramento.");
    const types = await entryTypesForChallenge(client, challengeId);
    if (!usesRoundItems(types)) throw new ApiError(409, "invalid_mode", "Este desafio não usa itens.");
    const linked = await ensureChallengeLibraries(client, access.challenge, session.user.id);
    // This branch only ever appends. Land new items after whatever already
    // exists so adding a batch mid-challenge keeps a stable reading order.
    const base = await oneOrNull<{ position: number }>(client,
      "SELECT coalesce(max(position),-1)::int + 1 AS position FROM challenge_items WHERE challenge_id=$1 AND archived_at IS NULL",
      [challengeId]);
    const memberIds = new Set(
      (await client.query<{ user_id: string }>(
        `SELECT gm.user_id
           FROM group_members gm JOIN groups g ON g.id = gm.group_id
          WHERE gm.group_id=$1 AND gm.removed_at IS NULL
            AND (g.kind = 'standard' OR gm.user_id = g.owner_user_id)`,
        [access.challenge.group_id])
      ).rows.map((row) => row.user_id),
    );
    const validCheckpointIds = new Set(
      (await client.query<{ id: string }>(
        "SELECT id FROM challenge_checkpoints WHERE challenge_id=$1 AND archived_at IS NULL",
        [challengeId])
      ).rows.map((row) => row.id),
    );
    const ids: string[] = [];
    for (let index = 0; index < requestedItems.length; index += 1) {
      const item = asRecord(requestedItems[index]);
      const title = typeof item.title === "string" ? item.title.trim() : "";
      if (!title) throw new ApiError(400, "invalid_item", "Item sem título.");
      const author = typeof item.author === "string" ? item.author.trim() : "";
      // Each item names its library (or takes the batch's, or the challenge's only one).
      const catalogKind = await resolveItemLibrary(
        client, access.challenge, linked,
        { libraryId: item.libraryId ?? body.libraryId, libraryKind: item.libraryKind ?? body.libraryKind },
        item.catalogItemId,
      );
      if (!author && await authorRequired(client, access.challenge.group_id, catalogKind)) {
        throw new ApiError(400, "invalid_item", "Informe o autor de cada livro.");
      }
      const id = publicId();
      const position = (base?.position ?? 0) + index;

      let catalogItemId: string;
      if (typeof item.catalogItemId === "string" && item.catalogItemId) {
        await assertCatalogItemInGroup(client, item.catalogItemId, access.challenge.group_id, catalogKind);
        catalogItemId = item.catalogItemId;
        const update: Record<string, unknown> = {};
        if (author) update.author = author;
        if (Object.hasOwn(item, "scheduledAt")) update.scheduledAt = item.scheduledAt;
        if (Object.keys(update).length) await applyCatalogItemUpdate(client, catalogItemId, access.challenge.group_id, update);
      } else {
        catalogItemId = await createChallengeCatalogItem(client, access.challenge.group_id, session.user.id, catalogKind, title, {
          author: item.author, year: item.year, mainGenre: item.mainGenre,
          pageCount: item.pageCount, runtimeMinutes: item.runtimeMinutes, scheduledAt: item.scheduledAt, attributes: item.attributes,
        });
      }
      // A member, a saved outside name, or a free-text note — never a made-up
      // participant, never more than one. All may be absent.
      const recommender = await resolveItemRecommender(client, access.challenge.group_id, item, memberIds);
      let checkpointId: string | null = null;
      if (typeof item.checkpointId === "string" && item.checkpointId) {
        if (!validCheckpointIds.has(item.checkpointId)) {
          throw new ApiError(400, "invalid_checkpoint", "Um item aponta para um checkpoint inexistente.");
        }
        checkpointId = item.checkpointId;
      }

      await client.query(
        `INSERT INTO challenge_items
          (id,challenge_id,entry_type_id,catalog_item_id,recommended_by_user_id,recommended_by_external_id,checkpoint_id,origin_note,semantic_key,title,description,position,metadata,created_at,updated_at)
         VALUES ($1,$2,NULL,$3,$4,$11,$5,$6,$7,$8,$9,$10,'{}'::jsonb,now(),now())`,
        [id, challengeId, catalogItemId, recommender.userId, checkpointId, recommender.note,
          await uniqueItemKey(client, challengeId, item.key ?? title, position), title,
          typeof item.description === "string" ? item.description.trim() || null : null, position, recommender.externalId],
      );
      ids.push(id);
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "items.created", "challenge", challengeId, null, { itemIds: ids });
    return { itemIds: ids };
  });
}

export async function updateChallengeItem(
  session: SessionContext,
  challengeId: string,
  itemId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) {
      throw new ApiError(403, "forbidden", "Somente administradores podem editar itens e checkpoints.");
    }
    if (access.challenge.status === "closed") {
      throw new ApiError(409, "challenge_locked", "Desafios encerrados preservam sua leitura histórica.");
    }

    // Type-agnostic: resolve whatever `itemId` names — a round item or a dated
    // checkpoint — instead of guessing from the entry type.
    const checkpointRow = await oneOrNull<{ title: string; description: string | null }>(
      client,
      `SELECT title, description FROM challenge_checkpoints
        WHERE id = $1 AND challenge_id = $2 AND archived_at IS NULL FOR UPDATE`,
      [itemId, challengeId],
    );

    if (checkpointRow) {
      const current = checkpointRow;
      const title = body.title === undefined
        ? current.title
        : stringValue(body, "title", { min: 1, max: 160 })!;
      const description = body.description === undefined
        ? current.description
        : stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
      await client.query(
        `UPDATE challenge_checkpoints
            SET title = $3, description = $4, updated_at = now()
          WHERE id = $1 AND challenge_id = $2`,
        [itemId, challengeId, title, description],
      );
      await writeAudit(
        client,
        access.challenge.group_id,
        challengeId,
        session.user.id,
        "checkpoint.updated",
        "challenge_checkpoint",
        itemId,
        current,
        { title, description },
      );
      return { id: itemId, title, description };
    }

    const current = await oneOrNull<{
      title: string; description: string | null; recommended_by_user_id: string | null;
      recommended_by_external_id: string | null;
      catalog_item_id: string | null; origin_note: string | null; checkpoint_id: string | null;
      opens_at: Date | null; due_at: Date | null; schedule_precision: "date" | "datetime";
    }>(
      client,
      `SELECT title, description, recommended_by_user_id, recommended_by_external_id, catalog_item_id, origin_note, checkpoint_id,
              opens_at, due_at, schedule_precision
         FROM challenge_items
        WHERE id = $1 AND challenge_id = $2 AND archived_at IS NULL
        FOR UPDATE`,
      [itemId, challengeId],
    );
    if (current) {
      const title = body.title === undefined
        ? current.title
        : stringValue(body, "title", { min: 1, max: 200 })!;
      const description = body.description === undefined
        ? current.description
        : stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
      let checkpointId = current.checkpoint_id;
      if (Object.hasOwn(body, "checkpointId")) {
        const wanted = typeof body.checkpointId === "string" ? body.checkpointId : "";
        if (!wanted) {
          checkpointId = null;
        } else {
          const cp = await oneOrNull<{ id: string }>(client,
            "SELECT id FROM challenge_checkpoints WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL",
            [wanted, challengeId]);
          if (!cp) throw new ApiError(400, "invalid_checkpoint", "Checkpoint inexistente neste desafio.");
          checkpointId = wanted;
        }
      }
      if (Object.hasOwn(body, "author")
        && !(typeof body.author === "string" && body.author.trim())
        && current.catalog_item_id
        && await authorRequired(client, access.challenge.group_id, (await oneOrNull<{ kind: string }>(
          client, "SELECT kind FROM catalog_items WHERE id = $1", [current.catalog_item_id],
        ))?.kind ?? "")) {
        throw new ApiError(400, "invalid_item", "Informe o autor de cada livro.");
      }
      // A member, a saved external name, or a free-text note — never more
      // than one (Phase 6: `challenge_items_recommender_exclusive_check`).
      const touchesRecommender = Object.hasOwn(body, "recommendedByUserId")
        || Object.hasOwn(body, "recommendedByExternalId")
        || Object.hasOwn(body, "originNote");
      let recommendedBy = current.recommended_by_user_id;
      let recommendedByExternal = current.recommended_by_external_id;
      let originNote = current.origin_note;
      if (touchesRecommender) {
        const wantedUser = typeof body.recommendedByUserId === "string" ? body.recommendedByUserId : "";
        const wantedExternal = typeof body.recommendedByExternalId === "string" ? body.recommendedByExternalId : "";
        const wantedNote = typeof body.originNote === "string" ? body.originNote.trim() : "";
        if ([wantedUser, wantedExternal, wantedNote].filter(Boolean).length > 1) {
          throw new ApiError(400, "invalid_recommender", "Escolha apenas uma origem: um membro, um nome salvo ou uma nota — não mais de uma.");
        }
        if (wantedUser || wantedExternal || wantedNote) await assertRecommendationsAllowed(client, access.challenge.group_id);
        recommendedBy = null;
        recommendedByExternal = null;
        originNote = null;
        if (wantedUser) {
          const member = await oneOrNull<{ user_id: string }>(client,
            "SELECT user_id FROM group_members WHERE group_id=$1 AND user_id=$2 AND removed_at IS NULL",
            [access.challenge.group_id, wantedUser]);
          if (!member) throw new ApiError(400, "invalid_recommender", "Quem indicou precisa ser um membro do grupo.");
          recommendedBy = wantedUser;
        } else if (wantedExternal) {
          await assertRecommenderInGroup(client, wantedExternal, access.challenge.group_id);
          recommendedByExternal = wantedExternal;
        } else if (wantedNote) {
          originNote = stringValue({ originNote: wantedNote }, "originNote", { max: 200, optional: true }) ?? null;
        }
      }
      const schedule = resolveItemSchedule(body, access.challenge.time_zone, {
        opensAt: current.opens_at, dueAt: current.due_at, schedulePrecision: current.schedule_precision,
      });
      await client.query(
        `UPDATE challenge_items
            SET title = $3, description = $4, recommended_by_user_id = $5,
                origin_note = $6, checkpoint_id = $7, opens_at = $8, due_at = $9,
                schedule_precision = $10, recommended_by_external_id = $11, updated_at = now()
          WHERE id = $1 AND challenge_id = $2`,
        [itemId, challengeId, title, description, recommendedBy, originNote, checkpointId,
          schedule.opensAt, schedule.dueAt, schedule.schedulePrecision, recommendedByExternal],
      );
      // Autor, ano, gênero principal, páginas e duração vivem no item do acervo
      // compartilhado, não no item do desafio — atualizá-los aqui é o que deixa
      // "esqueci de preencher na criação" corrigível depois, sem duplicar a
      // lógica de `updateCatalogItem`.
      if (current.catalog_item_id
        && (Object.hasOwn(body, "author") || Object.hasOwn(body, "year") || Object.hasOwn(body, "mainGenre")
          || Object.hasOwn(body, "pageCount") || Object.hasOwn(body, "runtimeMinutes") || Object.hasOwn(body, "scheduledAt")
          || Object.hasOwn(body, "attributes"))) {
        // The item's library decides which custom properties `attributes` may set.
        const catalogKind = (await oneOrNull<{ kind: string }>(
          client, "SELECT kind FROM catalog_items WHERE id = $1", [current.catalog_item_id],
        ))?.kind;
        await applyCatalogItemUpdate(client, current.catalog_item_id, access.challenge.group_id, body, catalogKind);
      }
      await writeAudit(
        client,
        access.challenge.group_id,
        challengeId,
        session.user.id,
        "item.updated",
        "challenge_item",
        itemId,
        { title: current.title, description: current.description },
        {
          title, description,
          ...(touchesRecommender ? { recommendedByUserId: recommendedBy, recommendedByExternalId: recommendedByExternal, originNote } : {}),
          ...(schedule.touched ? { opensAt: schedule.opensAt, dueAt: schedule.dueAt, schedulePrecision: schedule.schedulePrecision } : {}),
        },
      );
      return {
        id: itemId, title, description,
        ...(touchesRecommender ? { recommendedByUserId: recommendedBy, recommendedByExternalId: recommendedByExternal, originNote } : {}),
        opensAt: schedule.opensAt?.toISOString() ?? null,
        dueAt: schedule.dueAt?.toISOString() ?? null,
        schedulePrecision: schedule.schedulePrecision,
      };
    }

    throw new ApiError(404, "not_found", "Item ou checkpoint não encontrado.");
  });
}

export async function archiveChallengeItem(
  session: SessionContext,
  challengeId: string,
  itemId: string,
) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) {
      throw new ApiError(403, "forbidden", "Somente administradores podem remover itens.");
    }
    if (access.challenge.status === "closed") {
      throw new ApiError(409, "challenge_locked", "Desafios encerrados preservam sua leitura histórica.");
    }
    const current = await oneOrNull<{ title: string }>(
      client,
      "SELECT title FROM challenge_items WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL FOR UPDATE",
      [itemId, challengeId],
    );
    if (!current) {
      // A missing row is usually a dated checkpoint — those follow the period.
      const checkpoint = await oneOrNull<{ id: string }>(
        client,
        "SELECT id FROM challenge_checkpoints WHERE id=$1 AND challenge_id=$2 AND archived_at IS NULL",
        [itemId, challengeId],
      );
      if (checkpoint) {
        throw new ApiError(409, "invalid_mode", "Os dias de um desafio diário seguem o período; ajuste as datas na aba Geral.");
      }
      throw new ApiError(404, "not_found", "Item não encontrado.");
    }
    // Um item com registros não trava mais a remoção: os registros presos a ele
    // saem junto, em soft-delete, para sumir de métricas, histórico e showcase.
    const purged = await client.query(
      "UPDATE entries SET deleted_at=now(),last_edited_by_user_id=$3,updated_at=now() WHERE item_id=$1 AND challenge_id=$2 AND deleted_at IS NULL",
      [itemId, challengeId, session.user.id],
    );
    await client.query(
      "UPDATE challenge_items SET archived_at=now(),updated_at=now() WHERE id=$1 AND challenge_id=$2",
      [itemId, challengeId],
    );
    await writeAudit(
      client,
      access.challenge.group_id,
      challengeId,
      session.user.id,
      "item.archived",
      "challenge_item",
      itemId,
      { title: current.title },
      null,
      { entriesRemoved: purged.rowCount ?? 0 },
    );
    return { id: itemId, archived: true, entriesRemoved: purged.rowCount ?? 0 };
  });
}
