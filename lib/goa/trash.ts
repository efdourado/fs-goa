import type { PoolClient } from "pg";
import type { SessionContext } from "../auth";
import { requireGroupRole } from "../auth";
import { inTransaction, oneOrNull, withClient } from "../db";
import { ApiError, stringValue } from "../http";
import { challengeAccess } from "./domain/access";
import { publicId } from "./domain/shared";
import { writeAudit, writeSystemAudit } from "./domain/audit";
import { purgeChallengeRows, purgeGroupRows } from "./purge";

/**
 * Recoverable deletion (ROADMAP §13). The four actions the product keeps apart:
 *
 *   1. **Arquivar** (explicit) — `archived_at` on the row. Still part of history;
 *      shows under "Arquivados" in its own context, never in the bin.
 *   2. **Mover para a lixeira** (explicit) — a row in `trash_items`. Reversible.
 *   3. **Remover / revogar** — relations & tokens, handled elsewhere.
 *   4. **Excluir permanentemente** — irreversible, only from the bin/archive,
 *      only after the dependency preview, only when history stays intact.
 *
 * "Archived" and "binned" are **separate stored states**, never inferred from
 * live dependencies. The bin is permanent and user-controlled: nothing here
 * expires or is swept — an object stays until the owner restores or deletes it.
 */

// ── kinds ──────────────────────────────────────────────────────────────────
/** Independent units that get a real bin (`trash_items`). */
export type BinKind = "group" | "challenge" | "catalog_item" | "entry";
/** Structure recovered in place via `archived_at`; physical delete rides with the parent. */
export type ArchiveKind =
  | "challenge_item" | "checkpoint" | "entry_type" | "field" | "field_option" | "metric"
  | "catalog_attribute_def";
export type TrashKind = BinKind | ArchiveKind;

const BIN_KINDS: readonly BinKind[] = ["group", "challenge", "catalog_item", "entry"];
const ARCHIVE_KINDS: readonly ArchiveKind[] = [
  "challenge_item", "checkpoint", "entry_type", "field", "field_option", "metric", "catalog_attribute_def",
];
/** Archive kinds whose parent is a challenge — locked while it is closed. */
const CHALLENGE_STRUCTURE: readonly ArchiveKind[] = [
  "challenge_item", "checkpoint", "entry_type", "field", "field_option", "metric",
];

export interface Dependency {
  type: string;
  count: number;
}

interface RowContext {
  kind: TrashKind;
  id: string;
  groupId: string;
  groupKind: "standard" | "personal";
  challengeId: string | null;
  challengeStatus: "draft" | "active" | "closed" | null;
  label: string;
  fieldId: string | null;
  participantUserId: string | null;
  publishedTemplate: boolean;
}

export interface TrashItemView {
  kind: TrashKind;
  id: string;
  label: string;
  deletedAt: string | null;
  deletedBy: string | null;
  reason: string | null;
  dependencies: Dependency[];
  parentTrashed: boolean;
  blocked: { code: string; message: string } | null;
}

export interface ActionPreview {
  kind: TrashKind;
  id: string;
  label: string;
  dependencies: Dependency[];
  blocked: { code: string; message: string } | null;
  confirmation: "simple" | "count" | "name";
}

// ── locating a row + its context ──────────────────────────────────────────

const LOCATORS: Record<TrashKind, string> = {
  group: `SELECT g.id, g.id AS group_id, g.kind AS group_kind, NULL::text AS challenge_id, NULL::text AS challenge_status,
                 CASE WHEN g.kind='personal' THEN 'Espaço pessoal' ELSE g.name END AS label,
                 NULL::text AS field_id, NULL::text AS participant_user_id,
                 EXISTS(SELECT 1 FROM challenges c WHERE c.group_id=g.id AND c.published_as_template_at IS NOT NULL AND c.deleted_at IS NULL) AS published_template
            FROM groups g WHERE g.id=$1`,
  challenge: `SELECT c.id, c.group_id, g.kind AS group_kind, c.id AS challenge_id, c.status AS challenge_status, c.title AS label,
                     NULL::text AS field_id, NULL::text AS participant_user_id, (c.published_as_template_at IS NOT NULL) AS published_template
                FROM challenges c JOIN groups g ON g.id=c.group_id WHERE c.id=$1`,
  catalog_item: `SELECT ci.id, ci.group_id, g.kind AS group_kind, NULL::text AS challenge_id, NULL::text AS challenge_status, ci.title AS label,
                        NULL::text AS field_id, NULL::text AS participant_user_id, false AS published_template
                   FROM catalog_items ci JOIN groups g ON g.id=ci.group_id WHERE ci.id=$1`,
  entry: `SELECT e.id, c.group_id, g.kind AS group_kind, e.challenge_id, c.status AS challenge_status, et.name AS label,
                 NULL::text AS field_id, e.participant_user_id, false AS published_template
            FROM entries e JOIN challenges c ON c.id=e.challenge_id JOIN groups g ON g.id=c.group_id
            JOIN entry_types et ON et.id=e.entry_type_id WHERE e.id=$1`,
  challenge_item: `SELECT it.id, c.group_id, g.kind AS group_kind, it.challenge_id, c.status AS challenge_status, it.title AS label,
                          NULL::text AS field_id, NULL::text AS participant_user_id, false AS published_template
                     FROM challenge_items it JOIN challenges c ON c.id=it.challenge_id JOIN groups g ON g.id=c.group_id WHERE it.id=$1`,
  checkpoint: `SELECT cp.id, c.group_id, g.kind AS group_kind, cp.challenge_id, c.status AS challenge_status, cp.title AS label,
                      NULL::text AS field_id, NULL::text AS participant_user_id, false AS published_template
                 FROM challenge_checkpoints cp JOIN challenges c ON c.id=cp.challenge_id JOIN groups g ON g.id=c.group_id WHERE cp.id=$1`,
  entry_type: `SELECT et.id, c.group_id, g.kind AS group_kind, et.challenge_id, c.status AS challenge_status, et.name AS label,
                      NULL::text AS field_id, NULL::text AS participant_user_id, false AS published_template
                 FROM entry_types et JOIN challenges c ON c.id=et.challenge_id JOIN groups g ON g.id=c.group_id WHERE et.id=$1`,
  field: `SELECT f.id, c.group_id, g.kind AS group_kind, f.challenge_id, c.status AS challenge_status, f.label,
                 NULL::text AS field_id, NULL::text AS participant_user_id, false AS published_template
            FROM challenge_fields f JOIN challenges c ON c.id=f.challenge_id JOIN groups g ON g.id=c.group_id WHERE f.id=$1`,
  field_option: `SELECT o.id, c.group_id, g.kind AS group_kind, f.challenge_id, c.status AS challenge_status, o.label,
                        o.field_id, NULL::text AS participant_user_id, false AS published_template
                   FROM field_options o JOIN challenge_fields f ON f.id=o.field_id
                   JOIN challenges c ON c.id=f.challenge_id JOIN groups g ON g.id=c.group_id WHERE o.id=$1`,
  metric: `SELECT m.id, c.group_id, g.kind AS group_kind, m.challenge_id, c.status AS challenge_status, m.label,
                  NULL::text AS field_id, NULL::text AS participant_user_id, false AS published_template
             FROM challenge_metrics m JOIN challenges c ON c.id=m.challenge_id JOIN groups g ON g.id=c.group_id WHERE m.id=$1`,
  catalog_attribute_def: `SELECT d.id, d.group_id, g.kind AS group_kind, NULL::text AS challenge_id, NULL::text AS challenge_status, d.label,
                                 NULL::text AS field_id, NULL::text AS participant_user_id, false AS published_template
                            FROM catalog_attribute_defs d JOIN groups g ON g.id=d.group_id WHERE d.id=$1`,
};

async function locate(client: PoolClient, kind: TrashKind, id: string): Promise<RowContext> {
  const row = await oneOrNull<Record<string, unknown>>(client, LOCATORS[kind], [id]);
  if (!row) throw new ApiError(404, "not_found", "Item não encontrado.");
  return {
    kind,
    id: String(row.id),
    groupId: String(row.group_id),
    groupKind: row.group_kind as "standard" | "personal",
    challengeId: (row.challenge_id as string | null) ?? null,
    challengeStatus: (row.challenge_status as RowContext["challengeStatus"]) ?? null,
    label: String(row.label ?? "—"),
    fieldId: (row.field_id as string | null) ?? null,
    participantUserId: (row.participant_user_id as string | null) ?? null,
    publishedTemplate: row.published_template === true,
  };
}

// ── authorisation ─────────────────────────────────────────────────────────

async function authorize(
  client: PoolClient,
  session: SessionContext,
  row: RowContext,
  action: "restore" | "purge",
): Promise<void> {
  if (row.groupKind === "personal") {
    const owns = await oneOrNull<{ id: string }>(
      client,
      "SELECT id FROM groups WHERE id=$1 AND kind='personal' AND owner_user_id=$2",
      [row.groupId, session.user.id],
    );
    if (!owns) throw new ApiError(404, "not_found", "Item não encontrado.");
    return;
  }
  if (row.kind === "entry" && row.participantUserId === session.user.id) {
    await requireGroupRole(session.user.id, row.groupId, ["owner", "admin", "participant"], client);
    return;
  }
  const allowed: Array<"owner" | "admin"> =
    action === "purge" && row.kind === "group" ? ["owner"] : ["owner", "admin"];
  await requireGroupRole(session.user.id, row.groupId, allowed, client);
}

// ── dependency counts ─────────────────────────────────────────────────────

async function dependencies(client: PoolClient, row: RowContext): Promise<Dependency[]> {
  const out: Dependency[] = [];
  const push = async (type: string, sql: string, params: unknown[]) => {
    const r = await oneOrNull<{ count: number }>(client, sql, params);
    if (r && r.count > 0) out.push({ type, count: r.count });
  };
  switch (row.kind) {
    case "group":
      await push("challenges", "SELECT count(*)::int AS count FROM challenges WHERE group_id=$1", [row.id]);
      await push("catalogItems", "SELECT count(*)::int AS count FROM catalog_items WHERE group_id=$1", [row.id]);
      await push("members", "SELECT count(*)::int AS count FROM group_members WHERE group_id=$1 AND removed_at IS NULL", [row.id]);
      await push("entries", `SELECT count(*)::int AS count FROM entries e JOIN challenges c ON c.id=e.challenge_id WHERE c.group_id=$1`, [row.id]);
      break;
    case "challenge":
      await push("items", "SELECT count(*)::int AS count FROM challenge_items WHERE challenge_id=$1 AND archived_at IS NULL", [row.id]);
      await push("checkpoints", "SELECT count(*)::int AS count FROM challenge_checkpoints WHERE challenge_id=$1 AND archived_at IS NULL", [row.id]);
      await push("entries", "SELECT count(*)::int AS count FROM entries WHERE challenge_id=$1", [row.id]);
      await push("metrics", "SELECT count(*)::int AS count FROM challenge_metrics WHERE challenge_id=$1 AND archived_at IS NULL", [row.id]);
      break;
    case "catalog_item":
      await push("challengesUsing", `SELECT count(DISTINCT it.challenge_id)::int AS count FROM challenge_items it
                                       JOIN challenges c ON c.id=it.challenge_id WHERE it.catalog_item_id=$1 AND c.deleted_at IS NULL`, [row.id]);
      await push("entries", `SELECT count(*)::int AS count FROM entries e JOIN challenge_items it ON it.id=e.item_id
                              WHERE it.catalog_item_id=$1 AND e.deleted_at IS NULL`, [row.id]);
      break;
    case "challenge_item":
      await push("entries", "SELECT count(*)::int AS count FROM entries WHERE item_id=$1", [row.id]);
      break;
    case "checkpoint":
      await push("items", "SELECT count(*)::int AS count FROM challenge_items WHERE checkpoint_id=$1 AND archived_at IS NULL", [row.id]);
      await push("entries", "SELECT count(*)::int AS count FROM entries WHERE checkpoint_id=$1 AND deleted_at IS NULL", [row.id]);
      break;
    case "entry_type":
      await push("fields", "SELECT count(*)::int AS count FROM challenge_fields WHERE entry_type_id=$1 AND archived_at IS NULL", [row.id]);
      await push("entries", "SELECT count(*)::int AS count FROM entries WHERE entry_type_id=$1", [row.id]);
      break;
    case "field":
      await push("values", "SELECT count(*)::int AS count FROM entry_values WHERE field_id=$1", [row.id]);
      await push("metrics", "SELECT count(*)::int AS count FROM challenge_metrics WHERE field_id=$1 AND archived_at IS NULL", [row.id]);
      break;
    case "field_option":
      await push("values", "SELECT count(*)::int AS count FROM entry_values WHERE option_id=$1", [row.id]);
      break;
    case "entry":
      await push("values", "SELECT count(*)::int AS count FROM entry_values WHERE entry_id=$1", [row.id]);
      break;
    case "catalog_attribute_def":
      await push("values", "SELECT count(*)::int AS count FROM catalog_attribute_values WHERE attribute_def_id=$1", [row.id]);
      break;
    case "metric":
      break;
  }
  return out;
}

// ── guards ────────────────────────────────────────────────────────────────

/** May this object be moved to the bin at all? (bin kinds only) */
async function trashGuard(client: PoolClient, row: RowContext): Promise<{ code: string; message: string; canArchive?: boolean } | null> {
  switch (row.kind) {
    case "group":
      if (row.groupKind === "personal") return { code: "personal_workspace", message: "O espaço pessoal não pode ser excluído." };
      if (row.publishedTemplate) return { code: "has_template", message: "Retire o template da galeria antes de excluir o grupo." };
      return null;
    case "challenge":
      return row.publishedTemplate
        ? { code: "has_template", message: "Retire o template da galeria antes de excluir o desafio." }
        : null;
    case "catalog_item":
      // "Remover do catálogo" (archiveCatalogItem) already blocks a live
      // draft/active link; a closed round's link is fine to bin — the row stays
      // and old rounds keep rendering. Only the *permanent* delete is guarded.
      return null;
    default:
      return null;
  }
}

/** May this object be permanently deleted now, or must history keep it? */
async function permanentGuard(client: PoolClient, row: RowContext): Promise<{ code: string; message: string } | null> {
  if (CHALLENGE_STRUCTURE.includes(row.kind as ArchiveKind)) {
    if (row.challengeStatus === "closed") {
      return { code: "challenge_closed", message: "Reabra o desafio para mexer na estrutura." };
    }
    if (row.challengeStatus !== "draft") {
      return { code: "structure_rides_parent", message: "A remoção definitiva desta peça acontece junto com o desafio." };
    }
    const deps = await dependencies(client, row);
    if (deps.some((d) => d.count > 0)) {
      const usedByMetric = deps.some((d) => d.type === "metrics");
      return {
        code: usedByMetric ? "field_used_by_metric" : "structure_has_data",
        message: usedByMetric
          ? "Resolva a métrica que usa este campo antes de apagá-lo em definitivo."
          : "Esta peça já tem dados. Fica arquivada até o desafio ser apagado.",
      };
    }
    return null;
  }
  switch (row.kind) {
    case "catalog_attribute_def": {
      const values = await oneOrNull<{ count: number }>(client,
        "SELECT count(*)::int AS count FROM catalog_attribute_values WHERE attribute_def_id=$1", [row.id]);
      return values && values.count > 0
        ? { code: "attribute_has_values", message: "Há itens do acervo com este atributo preenchido." }
        : null;
    }
    case "group":
      if (row.groupKind === "personal") return { code: "personal_workspace", message: "O espaço pessoal não pode ser excluído." };
      return row.publishedTemplate ? { code: "has_template", message: "Retire o template da galeria primeiro." } : null;
    case "challenge":
      return row.publishedTemplate ? { code: "has_template", message: "Retire o template da galeria primeiro." } : null;
    case "catalog_item": {
      const used = await oneOrNull<{ count: number }>(client,
        `SELECT count(*)::int AS count FROM challenge_items it JOIN challenges c ON c.id=it.challenge_id
          WHERE it.catalog_item_id=$1 AND c.deleted_at IS NULL AND c.status <> 'draft'`, [row.id]);
      return used && used.count > 0
        ? { code: "catalog_in_use", message: "Enquanto desafios usam este item, ele fica arquivado — não pode ser apagado em definitivo." }
        : null;
    }
    case "entry":
      // An entry reaches the bin from an active round; once that round closes its
      // memory is frozen and even a binned entry stays put.
      return row.challengeStatus === "closed"
        ? { code: "challenge_closed", message: "Um desafio encerrado congela seus registros." }
        : null;
    default:
      return null;
  }
}

// ── parent-chain + identity conflict (restore) ────────────────────────────

async function parentTrashed(client: PoolClient, row: RowContext): Promise<boolean> {
  if (row.kind === "group") return false;
  if (row.kind === "challenge" || row.kind === "catalog_item" || row.kind === "catalog_attribute_def") {
    // Their only parent is the group; the challenge/item's own `deleted_at` is
    // its bin marker, not a trashed parent.
    const g = await oneOrNull<{ gone: boolean }>(client, "SELECT (deleted_at IS NOT NULL) AS gone FROM groups WHERE id=$1", [row.groupId]);
    return g?.gone ?? true;
  }
  if (row.kind === "field_option" && row.fieldId) {
    // The whole chain: the option's field, and that field's entry type.
    const f = await oneOrNull<{ gone: boolean }>(client,
      `SELECT (f.archived_at IS NOT NULL OR et.archived_at IS NOT NULL) AS gone
         FROM challenge_fields f JOIN entry_types et ON et.id = f.entry_type_id
        WHERE f.id = $1`, [row.fieldId]);
    if (f?.gone) return true;
  }
  if (row.kind === "field") {
    const et = await oneOrNull<{ gone: boolean }>(client,
      `SELECT (et.archived_at IS NOT NULL) AS gone
         FROM challenge_fields f JOIN entry_types et ON et.id = f.entry_type_id WHERE f.id = $1`, [row.id]);
    if (et?.gone) return true;
  }
  if (row.kind === "challenge_item") {
    // An item pinned to an archived checkpoint would dangle on restore.
    const cp = await oneOrNull<{ gone: boolean }>(client,
      `SELECT (cc.archived_at IS NOT NULL) AS gone FROM challenge_items it
         JOIN challenge_checkpoints cc ON cc.id = it.checkpoint_id WHERE it.id = $1`, [row.id]);
    if (cp?.gone) return true;
  }
  if (!row.challengeId) return false;
  const c = await oneOrNull<{ gone: boolean }>(client,
    `SELECT (c.deleted_at IS NOT NULL OR g.deleted_at IS NOT NULL) AS gone
       FROM challenges c JOIN groups g ON g.id=c.group_id WHERE c.id=$1`, [row.challengeId]);
  return c?.gone ?? true;
}

async function identityConflict(client: PoolClient, row: RowContext, rename: string | null): Promise<{ code: string; message: string } | null> {
  if (row.kind === "catalog_item") {
    const clash = await oneOrNull<{ id: string }>(client,
      `SELECT other.id FROM catalog_items self JOIN catalog_items other
          ON other.group_id=self.group_id AND other.kind=self.kind AND other.archived_at IS NULL AND other.id<>self.id
         AND other.normalized_title = CASE WHEN $2::text IS NULL THEN self.normalized_title ELSE lower(btrim($2)) END
         AND coalesce(lower(btrim(other.author)),'') = coalesce(lower(btrim(self.author)),'')
        WHERE self.id=$1`, [row.id, rename]);
    return clash ? { code: "name_conflict", message: "Já existe um item ativo com esse título no acervo. Renomeie ao restaurar." } : null;
  }
  const keyedTable: Partial<Record<TrashKind, string>> = {
    challenge_item: "challenge_items", entry_type: "entry_types", field: "challenge_fields",
    checkpoint: "challenge_checkpoints", metric: "challenge_metrics",
  };
  const table = keyedTable[row.kind];
  if (table) {
    const clash = await oneOrNull<{ id: string }>(client,
      `SELECT o.id FROM ${table} s JOIN ${table} o
          ON o.challenge_id=s.challenge_id AND o.semantic_key=s.semantic_key AND o.archived_at IS NULL AND o.id<>s.id
        WHERE s.id=$1`, [row.id]);
    return clash ? { code: "name_conflict", message: "Outro item ativo já ocupa a identidade deste." } : null;
  }
  if (row.kind === "field_option") {
    const clash = await oneOrNull<{ id: string }>(client,
      `SELECT o.id FROM field_options s JOIN field_options o
          ON o.field_id=s.field_id AND o.semantic_key=s.semantic_key AND o.archived_at IS NULL AND o.id<>s.id
        WHERE s.id=$1`, [row.id]);
    return clash ? { code: "name_conflict", message: "Outra opção ativa já ocupa a identidade desta." } : null;
  }
  if (row.kind === "catalog_attribute_def") {
    const clash = await oneOrNull<{ id: string }>(client,
      `SELECT o.id FROM catalog_attribute_defs s JOIN catalog_attribute_defs o
          ON o.group_id=s.group_id AND o.kind=s.kind AND o.semantic_key=s.semantic_key AND o.archived_at IS NULL AND o.id<>s.id
        WHERE s.id=$1`, [row.id]);
    return clash ? { code: "name_conflict", message: "Outro atributo ativo já ocupa a identidade deste." } : null;
  }
  return null;
}

// ── marker writes ─────────────────────────────────────────────────────────

const CLEAR_MARKER: Record<TrashKind, string> = {
  group: "UPDATE groups SET deleted_at=NULL, deleted_by_user_id=NULL, updated_at=now() WHERE id=$1",
  challenge: "UPDATE challenges SET deleted_at=NULL, deleted_by_user_id=NULL, updated_at=now() WHERE id=$1",
  catalog_item: "UPDATE catalog_items SET archived_at=NULL, updated_at=now() WHERE id=$1",
  entry: "UPDATE entries SET deleted_at=NULL, updated_at=now() WHERE id=$1",
  challenge_item: "UPDATE challenge_items SET archived_at=NULL, updated_at=now() WHERE id=$1",
  checkpoint: "UPDATE challenge_checkpoints SET archived_at=NULL, updated_at=now() WHERE id=$1",
  entry_type: "UPDATE entry_types SET archived_at=NULL, updated_at=now() WHERE id=$1",
  field: "UPDATE challenge_fields SET archived_at=NULL, updated_at=now() WHERE id=$1",
  field_option: "UPDATE field_options SET archived_at=NULL WHERE id=$1",
  metric: "UPDATE challenge_metrics SET archived_at=NULL, updated_at=now() WHERE id=$1",
  catalog_attribute_def: "UPDATE catalog_attribute_defs SET archived_at=NULL, updated_at=now() WHERE id=$1",
};

const SET_MARKER: Partial<Record<BinKind, string>> = {
  group: "UPDATE groups SET deleted_at=now(), deleted_by_user_id=$2, updated_at=now() WHERE id=$1",
  challenge: "UPDATE challenges SET deleted_at=now(), deleted_by_user_id=$2, updated_at=now() WHERE id=$1",
  catalog_item: "UPDATE catalog_items SET archived_at=now(), updated_at=now() WHERE id=$1",
  entry: "UPDATE entries SET deleted_at=now(), last_edited_by_user_id=$2, updated_at=now() WHERE id=$1",
};

// ── permanent purge (FK-dependency order — schema uses RESTRICT) ───────────

async function applyPurge(client: PoolClient, row: RowContext): Promise<Record<string, number>> {
  const deps = await dependencies(client, row);
  const counts = Object.fromEntries(deps.map((d) => [d.type, d.count]));
  switch (row.kind) {
    case "group": await purgeGroupRows(client, row.id); break;
    case "challenge": await purgeChallengeRows(client, row.id); break;
    case "catalog_item":
      await client.query("DELETE FROM catalog_attribute_values WHERE catalog_item_id=$1", [row.id]);
      await client.query("UPDATE challenge_items SET catalog_item_id=NULL WHERE catalog_item_id=$1", [row.id]);
      await client.query("DELETE FROM trash_items WHERE entity_kind='catalog_item' AND entity_id=$1", [row.id]);
      await client.query("DELETE FROM catalog_items WHERE id=$1", [row.id]);
      break;
    case "entry":
      await client.query("DELETE FROM entry_values WHERE entry_id=$1", [row.id]);
      await client.query("DELETE FROM trash_items WHERE entity_kind='entry' AND entity_id=$1", [row.id]);
      await client.query("DELETE FROM entries WHERE id=$1", [row.id]);
      break;
    case "challenge_item":
      await client.query("DELETE FROM challenge_items WHERE id=$1", [row.id]);
      break;
    case "checkpoint":
      // Anything the guard let through has no items/entries — but a leftover
      // challenge_item pointer to this checkpoint would still RESTRICT.
      await client.query("UPDATE challenge_items SET checkpoint_id=NULL WHERE checkpoint_id=$1", [row.id]);
      await client.query("DELETE FROM challenge_checkpoints WHERE id=$1", [row.id]);
      break;
    case "entry_type":
      // Metrics, fields and options reference the type (RESTRICT) — archived or
      // not, they go with it; a type-less challenge_item is left detached.
      await client.query("DELETE FROM result_blocks WHERE metric_id IN (SELECT id FROM challenge_metrics WHERE entry_type_id=$1)", [row.id]);
      await client.query("DELETE FROM challenge_metrics WHERE entry_type_id=$1", [row.id]);
      await client.query("DELETE FROM field_options WHERE field_id IN (SELECT id FROM challenge_fields WHERE entry_type_id=$1)", [row.id]);
      await client.query("DELETE FROM challenge_fields WHERE entry_type_id=$1", [row.id]);
      await client.query("UPDATE challenge_items SET entry_type_id=NULL WHERE entry_type_id=$1", [row.id]);
      await client.query("DELETE FROM entry_types WHERE id=$1", [row.id]);
      break;
    case "field":
      // An archived metric can still hold `field_id` (RESTRICT).
      await client.query("DELETE FROM result_blocks WHERE metric_id IN (SELECT id FROM challenge_metrics WHERE field_id=$1)", [row.id]);
      await client.query("DELETE FROM challenge_metrics WHERE field_id=$1", [row.id]);
      await client.query("DELETE FROM field_options WHERE field_id=$1", [row.id]);
      await client.query("DELETE FROM challenge_fields WHERE id=$1", [row.id]);
      break;
    case "field_option":
      await client.query("DELETE FROM field_options WHERE id=$1", [row.id]);
      break;
    case "metric":
      await client.query("DELETE FROM result_blocks WHERE metric_id=$1", [row.id]);
      await client.query("DELETE FROM challenge_metrics WHERE id=$1", [row.id]);
      break;
    case "catalog_attribute_def":
      await client.query("DELETE FROM catalog_attribute_defs WHERE id=$1", [row.id]);
      break;
  }
  return counts;
}

function confirmationTier(kind: TrashKind): ActionPreview["confirmation"] {
  if (kind === "group") return "name";
  if (kind === "challenge") return "count";
  return "simple";
}

// ── move to trash (called by the soft-delete services) ────────────────────

async function personalWorkspaceId(client: PoolClient, userId: string): Promise<string | null> {
  const ws = await oneOrNull<{ id: string }>(client, "SELECT id FROM groups WHERE kind='personal' AND owner_user_id=$1", [userId]);
  return ws?.id ?? null;
}

/**
 * Moves one independent unit to the bin: sets its hiding marker and records the
 * explicit `trash_items` row. Throws (with a `canArchive` hint where relevant)
 * when a dependency forbids the bin.
 */
export async function moveToTrash(
  client: PoolClient,
  kind: BinKind,
  entityId: string,
  actorUserId: string,
  opts: { reason?: string | null; skipMarker?: boolean } = {},
): Promise<void> {
  const row = await locate(client, kind, entityId);
  const guard = await trashGuard(client, row);
  if (guard) throw new ApiError(409, guard.code, guard.message, guard.canArchive ? { canArchive: true } : undefined);

  // Personal-workspace content is scoped to that workspace ("Minha lixeira").
  // Standard-group content — and a trashed standard group itself — is scoped to
  // the group ("Lixeira do grupo"); `personalTrash` additionally surfaces
  // trashed groups the caller owns.
  const scopeType: "personal" | "group" = row.groupKind === "personal" ? "personal" : "group";
  const scopeId = kind === "group" ? row.id : row.groupId;

  if (!opts.skipMarker) {
    await client.query(SET_MARKER[kind]!, kind === "catalog_item" ? [entityId] : [entityId, actorUserId]);
  }
  await client.query(
    `INSERT INTO trash_items (id, entity_kind, entity_id, scope_type, scope_id, deleted_by_user_id, reason, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
       scope_type=EXCLUDED.scope_type, scope_id=EXCLUDED.scope_id,
       deleted_by_user_id=EXCLUDED.deleted_by_user_id, reason=EXCLUDED.reason, deleted_at=now()`,
    [publicId(), kind, entityId, scopeType, scopeId, actorUserId, opts.reason ?? null],
  );
}

// ── listing ──────────────────────────────────────────────────────────────

async function annotate(client: PoolClient, row: RowContext, trashRow?: { deleted_at: string; deleted_by: string | null; reason: string | null }): Promise<TrashItemView> {
  const [deps, blocked, parent] = await Promise.all([
    dependencies(client, row),
    permanentGuard(client, row),
    parentTrashed(client, row),
  ]);
  return {
    kind: row.kind,
    id: row.id,
    label: row.label,
    deletedAt: trashRow?.deleted_at ?? null,
    deletedBy: trashRow?.deleted_by ?? null,
    reason: trashRow?.reason ?? null,
    dependencies: deps,
    parentTrashed: parent,
    blocked,
  };
}

async function listBinScope(client: PoolClient, scopeType: "personal" | "group", scopeId: string): Promise<TrashItemView[]> {
  const rows = await client.query<{ entity_kind: BinKind; entity_id: string; deleted_at: string; reason: string | null; deleted_by: string | null }>(
    `SELECT ti.entity_kind, ti.entity_id, ti.deleted_at::text AS deleted_at, ti.reason, du.username AS deleted_by
       FROM trash_items ti LEFT JOIN users du ON du.id = ti.deleted_by_user_id
      WHERE ti.scope_type=$1 AND ti.scope_id=$2 AND ti.entity_kind NOT IN ('entry','group')
      ORDER BY ti.deleted_at DESC`,
    [scopeType, scopeId],
  );
  const out: TrashItemView[] = [];
  for (const r of rows.rows) {
    const row = await locate(client, r.entity_kind, r.entity_id).catch(() => null);
    if (!row) continue;
    out.push(await annotate(client, row, r));
  }
  return out;
}

/** "Minha lixeira" — trashed personal challenges, personal catalogue items, and the owner's trashed standard groups. */
export async function personalTrash(session: SessionContext) {
  return withClient(async (client) => {
    const wsId = await personalWorkspaceId(client, session.user.id);
    if (!wsId) throw new ApiError(404, "not_found", "Espaço pessoal não encontrado.");
    const items = await listBinScope(client, "personal", wsId);
    const ownedGroups = await client.query<{
      entity_id: string; deleted_at: string; reason: string | null; deleted_by: string | null;
    }>(
      `SELECT ti.entity_id, ti.deleted_at::text AS deleted_at, ti.reason, du.username AS deleted_by
         FROM trash_items ti
         JOIN groups g ON g.id = ti.entity_id
         LEFT JOIN users du ON du.id = ti.deleted_by_user_id
        WHERE ti.entity_kind = 'group' AND g.owner_user_id = $1
        ORDER BY ti.deleted_at DESC`,
      [session.user.id],
    );
    for (const r of ownedGroups.rows) {
      const row = await locate(client, "group", r.entity_id).catch(() => null);
      if (row) items.unshift(await annotate(client, row, r));
    }
    return { scope: "personal" as const, items };
  });
}

/** "Lixeira do grupo" — trashed group challenges and group catalogue items (owner/admin). */
export async function groupTrash(session: SessionContext, groupId: string) {
  return withClient(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin"], client);
    return { scope: "group" as const, groupId, items: await listBinScope(client, "group", groupId) };
  });
}

/**
 * A challenge's "Estrutura removida" (archived structure), "Arquivados" and
 * "Registros removidos" (binned entries). The challenge itself is active/closed.
 */
export async function challengeArchive(session: SessionContext, challengeId: string) {
  return withClient(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client);
    const canManage = access.canManage;
    const structure: TrashItemView[] = [];
    if (canManage) {
      const kinds: Array<[ArchiveKind, string]> = [
        ["challenge_item", "SELECT id FROM challenge_items WHERE challenge_id=$1 AND archived_at IS NOT NULL"],
        ["checkpoint", "SELECT id FROM challenge_checkpoints WHERE challenge_id=$1 AND archived_at IS NOT NULL"],
        ["entry_type", "SELECT id FROM entry_types WHERE challenge_id=$1 AND archived_at IS NOT NULL"],
        ["field", "SELECT id FROM challenge_fields WHERE challenge_id=$1 AND archived_at IS NOT NULL"],
        ["metric", "SELECT id FROM challenge_metrics WHERE challenge_id=$1 AND archived_at IS NOT NULL"],
        ["field_option", `SELECT o.id FROM field_options o JOIN challenge_fields f ON f.id=o.field_id WHERE f.challenge_id=$1 AND o.archived_at IS NOT NULL`],
      ];
      for (const [kind, sql] of kinds) {
        const rows = await client.query<{ id: string }>(sql, [challengeId]);
        for (const r of rows.rows) structure.push(await annotate(client, await locate(client, kind, r.id)));
      }
    }
    const entrySql = canManage
      ? `SELECT ti.entity_id, ti.deleted_at::text AS deleted_at, ti.reason, du.username AS deleted_by
           FROM trash_items ti JOIN entries e ON e.id=ti.entity_id LEFT JOIN users du ON du.id=ti.deleted_by_user_id
          WHERE ti.entity_kind='entry' AND e.challenge_id=$1 ORDER BY ti.deleted_at DESC`
      : `SELECT ti.entity_id, ti.deleted_at::text AS deleted_at, ti.reason, du.username AS deleted_by
           FROM trash_items ti JOIN entries e ON e.id=ti.entity_id LEFT JOIN users du ON du.id=ti.deleted_by_user_id
          WHERE ti.entity_kind='entry' AND e.challenge_id=$1 AND e.participant_user_id=$2 ORDER BY ti.deleted_at DESC`;
    const entryRows = await client.query<{ entity_id: string; deleted_at: string; reason: string | null; deleted_by: string | null }>(
      entrySql, canManage ? [challengeId] : [challengeId, session.user.id]);
    const entries: TrashItemView[] = [];
    for (const r of entryRows.rows) {
      const row = await locate(client, "entry", r.entity_id).catch(() => null);
      if (row) entries.push(await annotate(client, row, r));
    }
    return { challengeId, canManage, structure, entries };
  });
}

// ── preview / restore / purge ────────────────────────────────────────────

export async function previewTrashAction(session: SessionContext, body: Record<string, unknown>): Promise<ActionPreview> {
  const kind = parseKind(body.kind);
  const id = stringValue(body, "id", { min: 1, max: 100 })!;
  return withClient(async (client) => {
    const row = await locate(client, kind, id);
    await authorize(client, session, row, "purge");
    const [deps, blocked] = await Promise.all([dependencies(client, row), permanentGuard(client, row)]);
    return { kind, id, label: row.label, dependencies: deps, blocked, confirmation: confirmationTier(kind) };
  });
}

export async function restoreTrashItem(session: SessionContext, body: Record<string, unknown>) {
  const kind = parseKind(body.kind);
  const id = stringValue(body, "id", { min: 1, max: 100 })!;
  const rename = stringValue(body, "rename", { min: 1, max: 300, optional: true }) ?? null;
  return inTransaction(async (client) => {
    const row = await locate(client, kind, id);
    await authorize(client, session, row, "restore");
    const isBin = BIN_KINDS.includes(kind as BinKind);
    if (isBin) {
      const inBin = await oneOrNull<{ id: string }>(client, "SELECT id FROM trash_items WHERE entity_kind=$1 AND entity_id=$2", [kind, id]);
      if (!inBin) throw new ApiError(404, "not_found", "Item não está na lixeira.");
    } else if (!(await isArchived(client, kind as ArchiveKind, id))) {
      throw new ApiError(404, "not_found", "Item não está arquivado.");
    }
    if (CHALLENGE_STRUCTURE.includes(kind as ArchiveKind) && row.challengeStatus === "closed") {
      throw new ApiError(409, "challenge_closed", "Reabra o desafio para restaurar itens da estrutura.");
    }
    if (kind === "entry" && row.challengeStatus === "closed") {
      // A closed round's memory is frozen — bringing an entry back would rewrite
      // its metrics and Wrapped after the fact (ROADMAP §13).
      throw new ApiError(409, "challenge_closed", "Reabra o desafio ou use a correção administrativa para mexer nos registros.");
    }
    if (await parentTrashed(client, row)) {
      throw new ApiError(409, "parent_trashed", "Restaure primeiro o item que contém este.");
    }
    const conflict = await identityConflict(client, row, rename);
    if (conflict) throw new ApiError(409, conflict.code, conflict.message);
    if (rename && kind === "catalog_item") {
      await client.query("UPDATE catalog_items SET title=$2, normalized_title=lower(btrim($2)), updated_at=now() WHERE id=$1", [id, rename]);
    }
    if (rename && kind === "group") {
      await client.query("UPDATE groups SET name=$2, updated_at=now() WHERE id=$1", [id, rename]);
    }
    await client.query(CLEAR_MARKER[kind], [id]);
    if (kind === "challenge_item") {
      // Entries cascade-binned with the item come back; ones a participant binned
      // by hand (a `trash_items` row of their own) stay binned.
      await client.query(
        `UPDATE entries SET deleted_at=NULL, updated_at=now()
          WHERE item_id=$1 AND deleted_at IS NOT NULL
            AND id NOT IN (SELECT entity_id FROM trash_items WHERE entity_kind='entry')`, [id]);
    }
    if (kind === "catalog_item") {
      // In a living list the catalogue identity and the list row are one and the
      // same — restoring the item brings its list row and history back too
      // (mirror of the cascade in archiveCatalogItemWithClient).
      const revived = await client.query<{ id: string }>(
        `UPDATE challenge_items it SET archived_at=NULL, updated_at=now()
           FROM challenges c, groups g
          WHERE it.catalog_item_id=$1 AND it.archived_at IS NOT NULL
            AND c.id=it.challenge_id AND g.id=c.group_id
            AND g.kind='personal' AND c.start_date IS NULL AND c.end_date IS NULL
          RETURNING it.id`,
        [id],
      );
      if (revived.rows.length) {
        await client.query(
          `UPDATE entries SET deleted_at=NULL, updated_at=now()
            WHERE item_id = ANY($1::text[]) AND deleted_at IS NOT NULL
              AND id NOT IN (SELECT entity_id FROM trash_items WHERE entity_kind='entry')`,
          [revived.rows.map((r) => r.id)],
        );
      }
    }
    if (kind === "challenge") {
      // A deleted challenge orphan-archives catalogue items only it referenced;
      // if the challenge comes back, un-archive the ones it revives that no one
      // binned on purpose (mirror of archiveOrphanedCatalogItemsForChallenge).
      await client.query(
        `UPDATE catalog_items ci SET archived_at=NULL, updated_at=now()
          WHERE ci.archived_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM challenge_items it WHERE it.catalog_item_id=ci.id AND it.challenge_id=$1 AND it.archived_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM trash_items ti WHERE ti.entity_kind='catalog_item' AND ti.entity_id=ci.id)`,
        [id],
      );
    }
    if (isBin) {
      await client.query("DELETE FROM trash_items WHERE entity_kind=$1 AND entity_id=$2", [kind, id]);
    }
    await writeAudit(client, row.groupId, row.challengeId, session.user.id,
      `${row.kind}.restored`, row.kind, id, null, null, { label: row.label });
    return { kind, id, restored: true };
  });
}

export async function purgeTrashItem(session: SessionContext, body: Record<string, unknown>) {
  const kind = parseKind(body.kind);
  const id = stringValue(body, "id", { min: 1, max: 100 })!;
  const confirmation = (stringValue(body, "confirmation", { min: 0, max: 200, optional: true }) ?? "").trim();
  const reason = stringValue(body, "reason", { min: 1, max: 500, optional: true }) ?? null;
  return inTransaction(async (client) => {
    const row = await locate(client, kind, id);
    await authorize(client, session, row, "purge");
    // An object can only be destroyed for good *from the bin* (ROADMAP §13). A
    // still-active group / challenge / structure is never a valid target, no
    // matter the role or the confirmation string.
    if (BIN_KINDS.includes(kind as BinKind)) {
      const inBin = await oneOrNull<{ id: string }>(client,
        "SELECT id FROM trash_items WHERE entity_kind=$1 AND entity_id=$2", [kind, id]);
      if (!inBin) throw new ApiError(409, "not_in_trash", "Só é possível excluir permanentemente um item que está na lixeira.");
    } else if (!(await isArchived(client, kind as ArchiveKind, id))) {
      throw new ApiError(409, "not_archived", "Só é possível excluir em definitivo uma peça que já foi arquivada.");
    }
    const blocked = await permanentGuard(client, row);
    if (blocked) throw new ApiError(409, blocked.code, blocked.message);

    const tier = confirmationTier(kind);
    if (tier === "name" && confirmation !== row.label.trim()) {
      throw new ApiError(409, "confirmation_required", "Digite o nome do grupo para confirmar a exclusão permanente.");
    }
    if (tier === "count") {
      const entries = (await dependencies(client, row)).find((d) => d.type === "entries")?.count ?? 0;
      if (confirmation !== String(entries)) {
        throw new ApiError(409, "confirmation_required", `Digite ${entries} para confirmar que ${entries} registros serão apagados.`);
      }
    }
    if (row.kind === "entry" && row.participantUserId !== session.user.id && !reason) {
      throw new ApiError(400, "reason_required", "Informe o motivo da exclusão administrativa.");
    }
    const counts = await applyPurge(client, row);
    await writeSystemAudit(client, session.user.id, `${row.kind}.purged`, row.kind, id,
      reason ? { ...counts, reason } : counts);
    console.warn("trash.purge", { actor: session.user.username, kind: row.kind, hasReason: Boolean(reason) });
    return { kind, id, purged: true };
  });
}

const ARCHIVE_TABLE: Record<ArchiveKind, string> = {
  challenge_item: "challenge_items",
  checkpoint: "challenge_checkpoints",
  entry_type: "entry_types",
  field: "challenge_fields",
  field_option: "field_options",
  metric: "challenge_metrics",
  catalog_attribute_def: "catalog_attribute_defs",
};

async function isArchived(client: PoolClient, kind: ArchiveKind, id: string): Promise<boolean> {
  const r = await oneOrNull<{ a: boolean }>(
    client,
    `SELECT (archived_at IS NOT NULL) AS a FROM ${ARCHIVE_TABLE[kind]} WHERE id=$1`,
    [id],
  );
  return r?.a ?? false;
}

function parseKind(value: unknown): TrashKind {
  if (typeof value === "string" && [...BIN_KINDS, ...ARCHIVE_KINDS].includes(value as TrashKind)) {
    return value as TrashKind;
  }
  throw new ApiError(400, "invalid_kind", "Tipo de item inválido.");
}

export { BIN_KINDS, ARCHIVE_KINDS };
