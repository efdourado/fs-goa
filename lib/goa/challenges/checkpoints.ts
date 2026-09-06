import type { PoolClient } from "pg";

import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { challengeAccess, publicId, semanticKey, writeAudit } from "../../goa-domain";
import { ApiError } from "../../http";

export type CheckpointKind = "day" | "week" | "session" | "milestone";
const CHECKPOINT_KINDS: readonly CheckpointKind[] = ["day", "week", "session", "milestone"];

export function isCheckpointKind(value: unknown): value is CheckpointKind {
  return typeof value === "string" && (CHECKPOINT_KINDS as readonly string[]).includes(value);
}

interface CheckpointInput {
  id?: string;
  title: string;
  kind: CheckpointKind;
  description: string | null;
  startsAt: string | null;
  dueAt: string | null;
}

function readCheckpointInput(raw: unknown, index: number): CheckpointInput {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title || title.length > 160) {
    throw new ApiError(400, "invalid_checkpoint", `O checkpoint ${index + 1} precisa de um título de até 160 caracteres.`);
  }
  const kind = record.kind === undefined ? "session" : record.kind;
  if (!isCheckpointKind(kind)) {
    throw new ApiError(400, "invalid_checkpoint", "Tipo de checkpoint inválido — use dia, semana, sessão ou marco.");
  }
  const description =
    typeof record.description === "string" && record.description.trim()
      ? record.description.trim().slice(0, 2_000)
      : null;
  const startsAt = normalizeInstant(record.startsAt ?? record.opensAt ?? null, `checkpoint ${index + 1}`);
  const dueAt = normalizeInstant(record.dueAt ?? null, `checkpoint ${index + 1}`);
  if (startsAt && dueAt && dueAt < startsAt) {
    throw new ApiError(400, "invalid_checkpoint", `O fim do checkpoint ${index + 1} não pode ser antes do início.`);
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : undefined,
    title,
    kind,
    description,
    startsAt,
    dueAt,
  };
}

function normalizeInstant(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_checkpoint", `Data inválida em ${label}.`);
  }
  // Accept a plain date (YYYY-MM-DD, treated as local midnight in São Paulo) or a
  // full ISO instant — store the ISO string, Postgres casts it to timestamptz.
  const asDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00-03:00` : value;
  const parsed = new Date(asDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "invalid_checkpoint", `Data inválida em ${label}.`);
  }
  return parsed.toISOString();
}

async function assertManualCheckpointsAllowed(client: PoolClient, challengeId: string): Promise<void> {
  // Only a round that actually generated day-by-day checkpoints derives them
  // from the period — editing those by hand would fight `syncDailyCheckpoints`.
  // A dated Library / reading round *without* auto days can still be split into
  // weeks or themed sessions here.
  const autoDays = await oneOrNull<{ count: number }>(
    client,
    "SELECT count(*)::int AS count FROM challenge_checkpoints WHERE challenge_id = $1 AND kind = 'day' AND archived_at IS NULL",
    [challengeId],
  );
  if (autoDays && autoDays.count > 0) {
    throw new ApiError(
      409,
      "daily_checkpoints_auto",
      "Este desafio gera os checkpoints a partir do período. Ajuste as datas na aba Geral.",
    );
  }
}

function uniqueCheckpointKey(desired: string, position: number, taken: Set<string>): string {
  const base = semanticKey(desired, `checkpoint_${position + 1}`);
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1_000; suffix += 1) {
    const candidate = `${base}_${suffix}`.slice(0, 64);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${publicId().slice(0, 8)}`.slice(0, 64);
}

/**
 * Replaces the challenge's manual checkpoint list in one transaction: known ids
 * are updated (and un-archived), new rows are inserted, and any current
 * checkpoint left out of the payload is archived — but only when it holds no
 * entries. Rescheduling never strands a record: a checkpoint with entries blocks
 * the save (409), and archiving an empty one just unassigns its items.
 */
export async function saveCheckpoints(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  if (!Array.isArray(body.checkpoints)) {
    throw new ApiError(400, "invalid_checkpoint", "Envie a lista de checkpoints.");
  }
  if (body.checkpoints.length > 104) {
    throw new ApiError(400, "checkpoint_limit", "Use no máximo 104 checkpoints (dois anos de semanas).");
  }
  const inputs = body.checkpoints.map(readCheckpointInput);

  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores organizam os checkpoints.");
    if (access.challenge.status === "closed") {
      throw new ApiError(409, "challenge_locked", "Desafios encerrados preservam sua leitura histórica.");
    }
    await assertManualCheckpointsAllowed(client, challengeId);

    const existing = (
      await client.query<{ id: string; title: string; semantic_key: string }>(
        "SELECT id, title, semantic_key FROM challenge_checkpoints WHERE challenge_id = $1 AND archived_at IS NULL",
        [challengeId],
      )
    ).rows;
    const existingById = new Map(existing.map((row) => [row.id, row]));
    const keptIds = new Set(inputs.filter((input) => input.id).map((input) => input.id as string));

    for (const input of inputs) {
      if (input.id && !existingById.has(input.id)) {
        throw new ApiError(404, "not_found", "Um dos checkpoints não pertence a este desafio.");
      }
    }

    // Archive the dropped ones first, freeing their semantic keys for reuse.
    const dropped = existing.filter((row) => !keptIds.has(row.id));
    for (const row of dropped) {
      const withEntries = await oneOrNull<{ count: number }>(
        client,
        "SELECT count(*)::int AS count FROM entries WHERE checkpoint_id = $1 AND challenge_id = $2 AND deleted_at IS NULL",
        [row.id, challengeId],
      );
      if (withEntries && withEntries.count > 0) {
        throw new ApiError(
          409,
          "checkpoint_has_entries",
          `O checkpoint "${row.title}" já tem ${withEntries.count} registro(s). Mova ou remova os registros antes de excluí-lo.`,
        );
      }
      await client.query(
        "UPDATE challenge_items SET checkpoint_id = NULL, updated_at = now() WHERE checkpoint_id = $1 AND challenge_id = $2",
        [row.id, challengeId],
      );
      await client.query(
        "UPDATE challenge_checkpoints SET archived_at = now(), updated_at = now() WHERE id = $1 AND challenge_id = $2",
        [row.id, challengeId],
      );
    }

    const taken = new Set<string>();
    const results: Array<{ id: string; title: string; kind: CheckpointKind; position: number }> = [];
    for (let position = 0; position < inputs.length; position += 1) {
      const input = inputs[position];
      if (input.id) {
        const key = existingById.get(input.id)!.semantic_key;
        taken.add(key);
        await client.query(
          `UPDATE challenge_checkpoints
              SET title = $3, kind = $4, description = $5, position = $6,
                  starts_at = $7, due_at = $8, archived_at = NULL, updated_at = now()
            WHERE id = $1 AND challenge_id = $2`,
          [input.id, challengeId, input.title, input.kind, input.description, position, input.startsAt, input.dueAt],
        );
        results.push({ id: input.id, title: input.title, kind: input.kind, position });
      } else {
        const id = publicId();
        const key = uniqueCheckpointKey(input.title, position, taken);
        taken.add(key);
        await client.query(
          `INSERT INTO challenge_checkpoints
             (id, challenge_id, semantic_key, title, kind, description, position, starts_at, due_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())`,
          [id, challengeId, key, input.title, input.kind, input.description, position, input.startsAt, input.dueAt],
        );
        results.push({ id, title: input.title, kind: input.kind, position });
      }
    }

    await writeAudit(
      client, access.challenge.group_id, challengeId, session.user.id,
      "checkpoints.saved", "challenge", challengeId, null,
      { count: results.length, archived: dropped.length },
    );
    return { checkpoints: results };
  });
}

/**
 * Assigns round items to checkpoints (or clears the assignment with a null
 * `checkpointId`). One flat operation so a "distribute across weeks" preview
 * commits at once. Items and checkpoints must belong to this challenge.
 */
export async function assignCheckpointItems(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const assignments = Array.isArray(body.assignments) ? body.assignments : null;
  if (!assignments) {
    throw new ApiError(400, "invalid_assignment", "Envie a lista de atribuições.");
  }
  if (assignments.length > 400) {
    throw new ApiError(400, "assignment_limit", "Atribuições demais numa só operação.");
  }
  const parsed = assignments.map((raw, index) => {
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const itemId = typeof record.itemId === "string" ? record.itemId : "";
    if (!itemId) throw new ApiError(400, "invalid_assignment", "Atribuição sem item.");
    const checkpointId =
      record.checkpointId === null || record.checkpointId === undefined || record.checkpointId === ""
        ? null
        : String(record.checkpointId);
    // Explicit `position`, else the order the client sent them in — a shuffle or
    // manual sort in the planner must survive a reload.
    const position = Number.isSafeInteger(record.position) ? Number(record.position) : index;
    return { itemId, checkpointId, position };
  });

  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores organizam os itens.");
    if (access.challenge.status === "closed") {
      throw new ApiError(409, "challenge_locked", "Desafios encerrados preservam sua leitura histórica.");
    }

    const validItems = new Set(
      (
        await client.query<{ id: string }>(
          "SELECT id FROM challenge_items WHERE challenge_id = $1 AND archived_at IS NULL",
          [challengeId],
        )
      ).rows.map((row) => row.id),
    );
    const validCheckpoints = new Set(
      (
        await client.query<{ id: string }>(
          "SELECT id FROM challenge_checkpoints WHERE challenge_id = $1 AND archived_at IS NULL",
          [challengeId],
        )
      ).rows.map((row) => row.id),
    );

    let changed = 0;
    for (const assignment of parsed) {
      if (!validItems.has(assignment.itemId)) {
        throw new ApiError(404, "not_found", "Um dos itens não pertence a este desafio.");
      }
      if (assignment.checkpointId && !validCheckpoints.has(assignment.checkpointId)) {
        throw new ApiError(400, "invalid_checkpoint", "Um checkpoint da atribuição não existe.");
      }
      const result = await client.query(
        `UPDATE challenge_items SET checkpoint_id = $3, position = $4, updated_at = now()
          WHERE id = $1 AND challenge_id = $2
            AND (checkpoint_id IS DISTINCT FROM $3 OR position IS DISTINCT FROM $4)`,
        [assignment.itemId, challengeId, assignment.checkpointId, assignment.position],
      );
      changed += result.rowCount ?? 0;
    }

    if (changed > 0) {
      await writeAudit(
        client, access.challenge.group_id, challengeId, session.user.id,
        "checkpoints.items_assigned", "challenge", challengeId, null,
        { changed, total: parsed.length },
      );
    }
    return { changed };
  });
}
