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
import { syncDailyCheckpoints } from "../daily-checkpoints";

export async function generateDailyCheckpoints(
  client: PoolClient,
  challengeId: string,
  startsOn: string,
  endsOn: string,
): Promise<string[]> {
  return syncDailyCheckpoints(client, challengeId, startsOn, endsOn);
}

export async function addChallengeItem(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const title = stringValue(body, "title", { max: 200 })!;
  const description = stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem criar itens.");
    if (access.challenge.status !== "draft") throw new ApiError(409, "challenge_locked", "Itens só podem ser criados no rascunho.");
    const entryType = await oneOrNull<{ id: string; submission_mode: string }>(client,
      "SELECT id, submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1", [challengeId]);
    if (!entryType || entryType.submission_mode !== "item") throw new ApiError(409, "invalid_mode", "Este desafio não usa itens.");
    const position = integerValue(body.position, 0, 0, 10_000);
    const id = publicId();
    await client.query(
      `INSERT INTO challenge_items
        (id, challenge_id, entry_type_id, semantic_key, title, description, position, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,now(),now())`,
      [id, challengeId, entryType.id, semanticKey(body.key ?? title, `item_${position + 1}`), title, description, position],
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
      if (access.challenge.status !== "draft") throw new ApiError(409, "challenge_locked", "Checkpoints só podem ser gerados no rascunho.");
      const type = await oneOrNull<{ submission_mode: string }>(client,
        "SELECT submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1",
        [challengeId]);
      if (type?.submission_mode !== "daily") {
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
    if (access.challenge.status !== "draft") throw new ApiError(409, "challenge_locked", "Itens só podem ser editados no rascunho.");
    const type = await oneOrNull<{ id: string; submission_mode: string }>(client,
      "SELECT id,submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1", [challengeId]);
    if (!type || type.submission_mode !== "item") throw new ApiError(409, "invalid_mode", "Este desafio não usa itens.");
    const ids: string[] = [];
    for (let position = 0; position < requestedItems.length; position += 1) {
      const item = asRecord(requestedItems[position]);
      const title = typeof item.title === "string" ? item.title.trim() : "";
      if (!title) throw new ApiError(400, "invalid_item", "Item sem título.");
      const id = publicId();
      await client.query(
        `INSERT INTO challenge_items
          (id,challenge_id,entry_type_id,semantic_key,title,description,position,metadata,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,now(),now())`,
        [id, challengeId, type.id, semanticKey(item.key ?? title, `item_${position + 1}`), title,
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

    const type = await oneOrNull<{ submission_mode: "item" | "daily" | "free" }>(
      client,
      `SELECT submission_mode
         FROM entry_types
        WHERE challenge_id = $1 AND archived_at IS NULL
        ORDER BY created_at
        LIMIT 1`,
      [challengeId],
    );

    if (type?.submission_mode === "daily") {
      const current = await oneOrNull<{ title: string; description: string | null }>(
        client,
        `SELECT title, description
           FROM challenge_checkpoints
          WHERE id = $1 AND challenge_id = $2 AND archived_at IS NULL
          FOR UPDATE`,
        [itemId, challengeId],
      );
      if (!current) throw new ApiError(404, "not_found", "Checkpoint não encontrado.");
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

    if (type?.submission_mode === "item") {
      const current = await oneOrNull<{ title: string; description: string | null }>(
        client,
        `SELECT title, description
           FROM challenge_items
          WHERE id = $1 AND challenge_id = $2 AND archived_at IS NULL
          FOR UPDATE`,
        [itemId, challengeId],
      );
      if (!current) throw new ApiError(404, "not_found", "Item não encontrado.");
      const title = body.title === undefined
        ? current.title
        : stringValue(body, "title", { min: 1, max: 200 })!;
      const description = body.description === undefined
        ? current.description
        : stringValue(body, "description", { max: 2_000, optional: true }) ?? null;
      await client.query(
        `UPDATE challenge_items
            SET title = $3, description = $4, updated_at = now()
          WHERE id = $1 AND challenge_id = $2`,
        [itemId, challengeId, title, description],
      );
      await writeAudit(
        client,
        access.challenge.group_id,
        challengeId,
        session.user.id,
        "item.updated",
        "challenge_item",
        itemId,
        current,
        { title, description },
      );
      return { id: itemId, title, description };
    }

    throw new ApiError(409, "invalid_mode", "Este desafio não usa itens ou checkpoints.");
  });
}
