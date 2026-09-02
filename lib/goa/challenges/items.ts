import type { PoolClient } from "pg";
import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import {
  asRecord,
  challengeAccess,
  dateString,
  integerValue,
  itemTargetDate,
  publicId,
  semanticKey,
  writeAudit,
} from "../../goa-domain";
import { ApiError, stringValue } from "../../http";
import {
  applyCatalogItemUpdate,
  assertCatalogItemInGroup,
  upsertCatalogItem,
} from "../catalog";
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

export async function addChallengeItem(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const title = stringValue(body, "title", { max: 200 })!;
  const description = stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
  const author = stringValue(body, "author", { max: 200, optional: true }) ?? null;
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem criar itens.");
    if (access.challenge.status === "closed") throw new ApiError(409, "challenge_locked", "Itens não podem ser criados depois do encerramento.");
    const types = await entryTypesForChallenge(client, challengeId);
    if (!usesRoundItems(types)) throw new ApiError(409, "invalid_mode", "Este desafio não usa itens.");
    const catalogKind = recipeCatalogKind(access.challenge.recipe_key) ?? "film";
    if (catalogKind === "book" && !author) {
      throw new ApiError(400, "invalid_item", "Informe o autor de cada livro.");
    }
    const position = integerValue(body.position, 0, 0, 10_000);
    const targetDate = itemTargetDate(body.targetDate, access.challenge.start_date, access.challenge.end_date);
    const id = publicId();
    let catalogItemId: string;
    if (typeof body.catalogItemId === "string" && body.catalogItemId) {
      await assertCatalogItemInGroup(client, body.catalogItemId, access.challenge.group_id, catalogKind);
      catalogItemId = body.catalogItemId;
      if (author) {
        await applyCatalogItemUpdate(client, catalogItemId, access.challenge.group_id, { author });
      }
    } else {
      catalogItemId = await upsertCatalogItem(client, access.challenge.group_id, session.user.id, { kind: catalogKind, title, author });
    }
    await client.query(
      `INSERT INTO challenge_items
        (id, challenge_id, entry_type_id, catalog_item_id, semantic_key, title, description, position, target_date, metadata, created_at, updated_at)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,'{}'::jsonb,now(),now())`,
      [id, challengeId, catalogItemId, await uniqueItemKey(client, challengeId, body.key ?? title, position), title, description, position, targetDate],
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
    const catalogKind = recipeCatalogKind(access.challenge.recipe_key) ?? "film";
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
        catalogItemId = await upsertCatalogItem(client, access.challenge.group_id, session.user.id, {
          kind: catalogKind, title, author: item.author, year: item.year, mainGenre: item.mainGenre,
          pageCount: item.pageCount,
        });
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
          (id,challenge_id,entry_type_id,catalog_item_id,recommended_by_user_id,semantic_key,title,description,position,target_date,metadata,created_at,updated_at)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb,now(),now())`,
        [id, challengeId, catalogItemId, recommendedBy,
          await uniqueItemKey(client, challengeId, item.key ?? title, position), title,
          typeof item.description === "string" ? item.description.trim() || null : null, position,
          itemTargetDate(item.targetDate, access.challenge.start_date, access.challenge.end_date)],
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
      catalog_item_id: string | null; target_date: string | null;
    }>(
      client,
      `SELECT title, description, recommended_by_user_id, catalog_item_id, target_date::text AS target_date
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
      const targetDate = Object.hasOwn(body, "targetDate")
        ? itemTargetDate(body.targetDate, access.challenge.start_date, access.challenge.end_date)
        : current.target_date;
      await client.query(
        `UPDATE challenge_items
            SET title = $3, description = $4, recommended_by_user_id = $5, target_date = $6, updated_at = now()
          WHERE id = $1 AND challenge_id = $2`,
        [itemId, challengeId, title, description, recommendedBy, targetDate],
      );
      // Autor, ano, gênero principal e páginas vivem no item do acervo compartilhado, não
      // no item do desafio — atualizá-los aqui é o que deixa "esqueci de preencher
      // na criação" corrigível depois, sem duplicar a lógica de `updateCatalogItem`.
      if (current.catalog_item_id
        && (Object.hasOwn(body, "author") || Object.hasOwn(body, "year") || Object.hasOwn(body, "mainGenre")
          || Object.hasOwn(body, "pageCount"))) {
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
        { title, description, ...(touchesRecommender ? { recommendedByUserId: recommendedBy } : {}) },
      );
      return { id: itemId, title, description, ...(touchesRecommender ? { recommendedByUserId: recommendedBy } : {}) };
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
    const usage = await oneOrNull<{ count: number }>(
      client,
      "SELECT count(*)::int AS count FROM entries WHERE item_id=$1 AND deleted_at IS NULL",
      [itemId],
    );
    if (usage && usage.count > 0) {
      throw new ApiError(
        409,
        "item_has_data",
        `"${current.title}" já tem ${usage.count} registro(s). Apague os registros antes de remover o item.`,
      );
    }
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
    );
    return { id: itemId, archived: true };
  });
}
