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
  createCatalogItem,
  resolveItemKind,
  upsertCatalogItem,
} from "../catalog";
import { midnightInTimeZone } from "../domain/shared";
import { syncDailyCheckpoints } from "../daily-checkpoints";
import {
  entryTypesForChallenge,
  primaryEntryType,
  recipeCatalogKind,
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

/**
 * The catalog kind THIS challenge actually uses. `cinema`/`library`/`bookshelf`
 * resolve it from the recipe key alone, unchanged. `custom` doesn't fix
 * one — every item-wanting challenge is created with at least one item (see
 * `createChallenge`), so its established kind is read off an existing item;
 * only if none remain does it fall back to an explicit `libraryId`.
 */
export async function resolveChallengeCatalogKind(
  client: PoolClient,
  challengeId: string,
  challenge: { recipe_key: string | null; group_id: string },
  libraryId?: unknown,
): Promise<string> {
  const fixed = recipeCatalogKind(challenge.recipe_key);
  if (fixed) return fixed;
  if (challenge.recipe_key === "custom") {
    const existing = await oneOrNull<{ kind: string }>(
      client,
      `SELECT ci.kind FROM challenge_items it JOIN catalog_items ci ON ci.id = it.catalog_item_id
        WHERE it.challenge_id = $1 AND it.archived_at IS NULL LIMIT 1`,
      [challengeId],
    );
    if (existing) return existing.kind;
    return resolveItemKind(client, challenge.group_id, { libraryId });
  }
  return "film";
}

/** Creates a new catalog item for `kind` — film/book keep their existing auto-match, every other kind never merges (Phase 2). */
async function createChallengeCatalogItem(
  client: PoolClient,
  groupId: string,
  userId: string,
  kind: string,
  title: string,
  extra: { author?: unknown; year?: unknown; mainGenre?: unknown; pageCount?: unknown; runtimeMinutes?: unknown; attributes?: unknown } = {},
): Promise<string> {
  return kind === "film" || kind === "book"
    ? upsertCatalogItem(client, groupId, userId, { kind, title, ...extra })
    : createCatalogItem(client, groupId, userId, { kind, title, attributes: extra.attributes });
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
    const catalogKind = await resolveChallengeCatalogKind(client, challengeId, access.challenge, body.libraryId);
    if (catalogKind === "book" && !author) {
      throw new ApiError(400, "invalid_item", "Informe o autor de cada livro.");
    }
    const position = integerValue(body.position, 0, 0, 10_000);
    const checkpointId = await resolveCheckpointId(client, challengeId, body.checkpointId);
    const recommendedBy = await resolveRecommender(client, access.challenge.group_id, body.recommendedByUserId);
    const id = publicId();
    let catalogItemId: string;
    if (typeof body.catalogItemId === "string" && body.catalogItemId) {
      await assertCatalogItemInGroup(client, body.catalogItemId, access.challenge.group_id, catalogKind);
      catalogItemId = body.catalogItemId;
      if (author) {
        await applyCatalogItemUpdate(client, catalogItemId, access.challenge.group_id, { author });
      }
    } else {
      catalogItemId = await createChallengeCatalogItem(client, access.challenge.group_id, session.user.id, catalogKind, title, { author });
    }
    await client.query(
      `INSERT INTO challenge_items
        (id, challenge_id, entry_type_id, catalog_item_id, recommended_by_user_id, checkpoint_id, origin_note, semantic_key, title, description, position, metadata, created_at, updated_at)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,'{}'::jsonb,now(),now())`,
      [id, challengeId, catalogItemId, recommendedBy, checkpointId, originNote,
        await uniqueItemKey(client, challengeId, body.key ?? title, position), title, description, position],
    );
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "item.created", "challenge_item", id, null, { title });
    return { id, title, position };
  });
}

/** Validates a recommender id against the group's active membership. */
async function resolveRecommender(
  client: PoolClient,
  groupId: string,
  raw: unknown,
): Promise<string | null> {
  if (typeof raw !== "string" || !raw) return null;
  const row = await oneOrNull<{ user_id: string }>(
    client,
    `SELECT gm.user_id
       FROM group_members gm JOIN groups g ON g.id = gm.group_id
      WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.removed_at IS NULL
        AND (g.kind = 'standard' OR gm.user_id = g.owner_user_id)`,
    [groupId, raw],
  );
  if (!row) throw new ApiError(400, "invalid_recommender", "Quem indicou precisa ser um membro do grupo.");
  return row.user_id;
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
    const catalogKind = await resolveChallengeCatalogKind(client, challengeId, access.challenge, body.libraryId);
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
      if (catalogKind === "book" && !author) {
        throw new ApiError(400, "invalid_item", "Informe o autor de cada livro.");
      }
      const id = publicId();
      const position = (base?.position ?? 0) + index;

      let catalogItemId: string;
      if (typeof item.catalogItemId === "string" && item.catalogItemId) {
        await assertCatalogItemInGroup(client, item.catalogItemId, access.challenge.group_id, catalogKind);
        catalogItemId = item.catalogItemId;
        if (author) {
          await applyCatalogItemUpdate(client, catalogItemId, access.challenge.group_id, { author });
        }
      } else {
        catalogItemId = await createChallengeCatalogItem(client, access.challenge.group_id, session.user.id, catalogKind, title, {
          author: item.author, year: item.year, mainGenre: item.mainGenre,
          pageCount: item.pageCount, runtimeMinutes: item.runtimeMinutes, attributes: item.attributes,
        });
      }
      let recommendedBy: string | null = null;
      if (typeof item.recommendedByUserId === "string" && item.recommendedByUserId) {
        if (!memberIds.has(item.recommendedByUserId)) {
          throw new ApiError(400, "invalid_recommender", "Quem indicou precisa ser um membro do grupo.");
        }
        recommendedBy = item.recommendedByUserId;
      }
      // An item can carry a participant recommender OR a free-text origin, never
      // a fake participant. Both may be absent.
      const originNote = typeof item.originNote === "string" && item.originNote.trim()
        ? item.originNote.trim().slice(0, 200)
        : null;
      let checkpointId: string | null = null;
      if (typeof item.checkpointId === "string" && item.checkpointId) {
        if (!validCheckpointIds.has(item.checkpointId)) {
          throw new ApiError(400, "invalid_checkpoint", "Um item aponta para um checkpoint inexistente.");
        }
        checkpointId = item.checkpointId;
      }

      await client.query(
        `INSERT INTO challenge_items
          (id,challenge_id,entry_type_id,catalog_item_id,recommended_by_user_id,checkpoint_id,origin_note,semantic_key,title,description,position,metadata,created_at,updated_at)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,'{}'::jsonb,now(),now())`,
        [id, challengeId, catalogItemId, recommendedBy, checkpointId, originNote,
          await uniqueItemKey(client, challengeId, item.key ?? title, position), title,
          typeof item.description === "string" ? item.description.trim() || null : null, position],
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
      catalog_item_id: string | null; origin_note: string | null; checkpoint_id: string | null;
      opens_at: Date | null; due_at: Date | null; schedule_precision: "date" | "datetime";
    }>(
      client,
      `SELECT title, description, recommended_by_user_id, catalog_item_id, origin_note, checkpoint_id,
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
      const originNote = Object.hasOwn(body, "originNote")
        ? stringValue(body, "originNote", { max: 200, optional: true }) ?? null
        : current.origin_note;
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
      if (recipeCatalogKind(access.challenge.recipe_key) === "book"
        && Object.hasOwn(body, "author")
        && !(typeof body.author === "string" && body.author.trim())) {
        throw new ApiError(400, "invalid_item", "Informe o autor de cada livro.");
      }
      const touchesRecommender = Object.hasOwn(body, "recommendedByUserId");
      let recommendedBy = current.recommended_by_user_id;
      if (touchesRecommender) {
        const wanted = typeof body.recommendedByUserId === "string" ? body.recommendedByUserId : "";
        if (!wanted) {
          recommendedBy = null;
        } else {
          const member = await oneOrNull<{ user_id: string }>(client,
            "SELECT user_id FROM group_members WHERE group_id=$1 AND user_id=$2 AND removed_at IS NULL",
            [access.challenge.group_id, wanted]);
          if (!member) throw new ApiError(400, "invalid_recommender", "Quem indicou precisa ser um membro do grupo.");
          recommendedBy = wanted;
        }
      }
      const schedule = resolveItemSchedule(body, access.challenge.time_zone, {
        opensAt: current.opens_at, dueAt: current.due_at, schedulePrecision: current.schedule_precision,
      });
      await client.query(
        `UPDATE challenge_items
            SET title = $3, description = $4, recommended_by_user_id = $5,
                origin_note = $6, checkpoint_id = $7, opens_at = $8, due_at = $9,
                schedule_precision = $10, updated_at = now()
          WHERE id = $1 AND challenge_id = $2`,
        [itemId, challengeId, title, description, recommendedBy, originNote, checkpointId,
          schedule.opensAt, schedule.dueAt, schedule.schedulePrecision],
      );
      // Autor, ano, gênero principal, páginas e duração vivem no item do acervo
      // compartilhado, não no item do desafio — atualizá-los aqui é o que deixa
      // "esqueci de preencher na criação" corrigível depois, sem duplicar a
      // lógica de `updateCatalogItem`.
      if (current.catalog_item_id
        && (Object.hasOwn(body, "author") || Object.hasOwn(body, "year") || Object.hasOwn(body, "mainGenre")
          || Object.hasOwn(body, "pageCount") || Object.hasOwn(body, "runtimeMinutes"))) {
        await applyCatalogItemUpdate(client, current.catalog_item_id, access.challenge.group_id, body);
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
          title, description, ...(touchesRecommender ? { recommendedByUserId: recommendedBy } : {}),
          ...(schedule.touched ? { opensAt: schedule.opensAt, dueAt: schedule.dueAt, schedulePrecision: schedule.schedulePrecision } : {}),
        },
      );
      return {
        id: itemId, title, description, ...(touchesRecommender ? { recommendedByUserId: recommendedBy } : {}),
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
