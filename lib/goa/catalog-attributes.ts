import type { PoolClient } from "pg";

import { requireGroupRole, type SessionContext } from "../auth";
import { inTransaction, oneOrNull, withClient } from "../db";
import { ApiError, stringValue } from "../http";
import { writeAudit } from "./domain/audit";
import { ensurePersonalWorkspace } from "./domain/challenges";
import { publicId, semanticKey } from "./domain/shared";
import type { CatalogKind } from "./catalog";

// Duplicated (not imported) from `catalog.ts` on purpose: it keeps this module
// free of a runtime import cycle back into the file that imports
// `setCatalogItemAttributeValues` from here. Same query either way.
async function requireStandardWorkspace(
  client: PoolClient,
  userId: string,
  groupId: string,
  roles: Array<"owner" | "admin" | "participant">,
): Promise<void> {
  await requireGroupRole(userId, groupId, roles, client);
  const group = await oneOrNull<{ kind: string }>(
    client,
    "SELECT kind FROM groups WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL",
    [groupId],
  );
  if (!group || group.kind !== "standard") {
    throw new ApiError(404, "not_found", "Grupo não encontrado.");
  }
}

async function personalWorkspaceId(client: PoolClient, userId: string): Promise<string | null> {
  const workspace = await oneOrNull<{ id: string }>(
    client,
    `SELECT id FROM groups
      WHERE kind = 'personal' AND owner_user_id = $1
        AND archived_at IS NULL AND deleted_at IS NULL`,
    [userId],
  );
  return workspace?.id ?? null;
}

/**
 * A group (or personal workspace) can name and type its own catalog
 * attributes instead of being stuck with the fixed year/genre/author/pages
 * columns — "diretor" on films, "editora" on books. Same mold as
 * `challenge_fields`/`entry_values`: named, typed, ordered, soft-archived,
 * never a JSON blob. Reading the shape only needs to see the catalog;
 * defining or archiving an attribute needs to manage it.
 */

export type CatalogAttributeType = "text" | "number" | "date" | "boolean";
const ATTRIBUTE_TYPES = new Set<string>(["text", "number", "date", "boolean"]);

export interface CatalogAttributeDef {
  id: string;
  kind: CatalogKind;
  key: string;
  label: string;
  type: CatalogAttributeType;
  position: number;
}

export interface CatalogAttributeValue {
  key: string;
  label: string;
  type: CatalogAttributeType;
  value: string | number | boolean;
}

function mapDef(row: { id: string; kind: string; semantic_key: string; label: string; type: string; position: number }): CatalogAttributeDef {
  return { id: row.id, kind: row.kind as CatalogKind, key: row.semantic_key, label: row.label, type: row.type as CatalogAttributeType, position: row.position };
}

async function listDefsWithClient(client: PoolClient, groupId: string, kind?: CatalogKind): Promise<CatalogAttributeDef[]> {
  const rows = await client.query<{ id: string; kind: string; semantic_key: string; label: string; type: string; position: number }>(
    kind
      ? `SELECT id, kind, semantic_key, label, type, position FROM catalog_attribute_defs
          WHERE group_id = $1 AND kind = $2 AND archived_at IS NULL ORDER BY position`
      : `SELECT id, kind, semantic_key, label, type, position FROM catalog_attribute_defs
          WHERE group_id = $1 AND archived_at IS NULL ORDER BY kind, position`,
    kind ? [groupId, kind] : [groupId],
  );
  return rows.rows.map(mapDef);
}

async function insertDef(
  client: PoolClient,
  actorUserId: string,
  groupId: string,
  body: Record<string, unknown>,
): Promise<CatalogAttributeDef> {
  const kind = body.kind;
  if (kind !== "film" && kind !== "book" && kind !== "other") {
    throw new ApiError(400, "invalid_kind", "Escolha filme ou livro.");
  }
  const label = stringValue(body, "label", { min: 1, max: 80 })!;
  const type = typeof body.type === "string" ? body.type : "text";
  if (!ATTRIBUTE_TYPES.has(type)) throw new ApiError(400, "invalid_type", "Tipo de atributo inválido.");

  const existing = await client.query<{ semantic_key: string }>(
    "SELECT semantic_key FROM catalog_attribute_defs WHERE group_id = $1 AND kind = $2",
    [groupId, kind],
  );
  const used = new Set(existing.rows.map((row) => row.semantic_key));
  const base = semanticKey(body.key, semanticKey(label, "atributo"));
  let key = base;
  for (let suffix = 2; used.has(key); suffix += 1) key = `${base}_${suffix}`.slice(0, 64);

  const positionRow = await oneOrNull<{ position: number }>(
    client,
    "SELECT coalesce(max(position), -1)::int + 1 AS position FROM catalog_attribute_defs WHERE group_id = $1 AND kind = $2",
    [groupId, kind],
  );
  const position = positionRow?.position ?? 0;
  const id = publicId();
  await client.query(
    `INSERT INTO catalog_attribute_defs
      (id, group_id, kind, semantic_key, label, type, position, created_by_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())`,
    [id, groupId, kind, key, label, type, position, actorUserId],
  );
  await writeAudit(client, groupId, null, actorUserId, "catalog.attribute_created", "catalog_attribute_def", id, null, { kind, label, type });
  return { id, kind, key, label, type: type as CatalogAttributeType, position };
}

async function archiveDefWithClient(client: PoolClient, actorUserId: string, groupId: string, defId: string): Promise<void> {
  const def = await oneOrNull<{ label: string }>(
    client,
    "SELECT label FROM catalog_attribute_defs WHERE id = $1 AND group_id = $2 AND archived_at IS NULL FOR UPDATE",
    [defId, groupId],
  );
  if (!def) throw new ApiError(404, "not_found", "Atributo não encontrado.");
  const withValues = await oneOrNull<{ count: number }>(
    client,
    "SELECT count(*)::int AS count FROM catalog_attribute_values WHERE attribute_def_id = $1",
    [defId],
  );
  if ((withValues?.count ?? 0) > 0) {
    throw new ApiError(
      409,
      "attribute_has_data",
      `"${def.label}" já tem valores preenchidos em itens do acervo e não pode ser removido.`,
    );
  }
  await client.query("UPDATE catalog_attribute_defs SET archived_at = now(), updated_at = now() WHERE id = $1", [defId]);
  await writeAudit(client, groupId, null, actorUserId, "catalog.attribute_archived", "catalog_attribute_def", defId, null, null);
}

/**
 * Upserts every value the client sent for one catalog item, matched against
 * each attribute's declared type. Keyed by attribute id OR semantic key, so
 * both the item-adding wizard (which only knows keys) and a direct edit
 * (which has ids) call this the same way. An unrecognized key is skipped, not
 * a reason to fail the whole save — attributes are additive, never required.
 */
export async function setCatalogItemAttributeValues(
  client: PoolClient,
  catalogItemId: string,
  groupId: string,
  kind: CatalogKind,
  values: unknown,
): Promise<void> {
  if (!values || typeof values !== "object") return;
  const defs = await listDefsWithClient(client, groupId, kind);
  if (!defs.length) return;
  const byIdOrKey = new Map<string, CatalogAttributeDef>();
  for (const def of defs) {
    byIdOrKey.set(def.id, def);
    byIdOrKey.set(def.key, def);
  }
  for (const [rawKey, rawValue] of Object.entries(values as Record<string, unknown>)) {
    const def = byIdOrKey.get(rawKey);
    if (!def) continue;
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      await client.query(
        "DELETE FROM catalog_attribute_values WHERE catalog_item_id = $1 AND attribute_def_id = $2",
        [catalogItemId, def.id],
      );
      continue;
    }
    let textValue: string | null = null;
    let numberValue: number | null = null;
    let dateValue: string | null = null;
    let booleanValue: boolean | null = null;
    if (def.type === "number") {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) throw new ApiError(400, "invalid_attribute_value", `"${def.label}" precisa de um número.`);
      numberValue = Math.round(parsed);
    } else if (def.type === "date") {
      if (typeof rawValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
        throw new ApiError(400, "invalid_attribute_value", `"${def.label}" precisa de uma data (AAAA-MM-DD).`);
      }
      dateValue = rawValue;
    } else if (def.type === "boolean") {
      booleanValue = rawValue === true || rawValue === "true";
    } else {
      textValue = String(rawValue).trim().slice(0, 500);
      if (!textValue) continue;
    }
    await client.query(
      `INSERT INTO catalog_attribute_values
        (catalog_item_id, attribute_def_id, group_id, text_value, number_value, date_value, boolean_value, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now())
       ON CONFLICT (catalog_item_id, attribute_def_id) DO UPDATE SET
         text_value = excluded.text_value, number_value = excluded.number_value,
         date_value = excluded.date_value, boolean_value = excluded.boolean_value, updated_at = now()`,
      [catalogItemId, def.id, groupId, textValue, numberValue, dateValue, booleanValue],
    );
  }
}

/** Batch-loads every filled-in attribute value for a set of catalog items. */
export async function attributeValuesForItems(
  client: PoolClient,
  catalogItemIds: string[],
): Promise<Map<string, CatalogAttributeValue[]>> {
  const map = new Map<string, CatalogAttributeValue[]>();
  if (!catalogItemIds.length) return map;
  const rows = await client.query<{
    catalog_item_id: string; key: string; label: string; type: string;
    text_value: string | null; number_value: number | null; date_value: string | null; boolean_value: boolean | null;
  }>(
    `SELECT v.catalog_item_id, d.semantic_key AS key, d.label, d.type,
            v.text_value, v.number_value, v.date_value, v.boolean_value
       FROM catalog_attribute_values v
       JOIN catalog_attribute_defs d ON d.id = v.attribute_def_id AND d.archived_at IS NULL
      WHERE v.catalog_item_id = ANY($1::text[])
      ORDER BY d.position`,
    [catalogItemIds],
  );
  for (const row of rows.rows) {
    const value = row.type === "number" ? row.number_value
      : row.type === "date" ? row.date_value
      : row.type === "boolean" ? row.boolean_value
      : row.text_value;
    if (value === null) continue;
    const list = map.get(row.catalog_item_id) ?? [];
    list.push({ key: row.key, label: row.label, type: row.type as CatalogAttributeType, value });
    map.set(row.catalog_item_id, list);
  }
  return map;
}

// --- Group-scoped endpoints -------------------------------------------------

export async function listGroupCatalogAttributes(session: SessionContext, groupId: string, kind?: CatalogKind) {
  return withClient(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin", "participant"]);
    return { attributes: await listDefsWithClient(client, groupId, kind) };
  });
}

export async function createGroupCatalogAttribute(session: SessionContext, groupId: string, body: Record<string, unknown>) {
  return inTransaction(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin"]);
    return insertDef(client, session.user.id, groupId, body);
  });
}

export async function archiveGroupCatalogAttribute(session: SessionContext, groupId: string, defId: string) {
  return inTransaction(async (client) => {
    await requireStandardWorkspace(client, session.user.id, groupId, ["owner", "admin"]);
    await archiveDefWithClient(client, session.user.id, groupId, defId);
    return { id: defId, archived: true as const };
  });
}

// --- Personal-workspace endpoints -------------------------------------------

export async function listPersonalCatalogAttributes(session: SessionContext, kind?: CatalogKind) {
  return withClient(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    return { attributes: workspaceId ? await listDefsWithClient(client, workspaceId, kind) : [] };
  });
}

export async function createPersonalCatalogAttribute(session: SessionContext, body: Record<string, unknown>) {
  const workspaceId = await ensurePersonalWorkspace(session.user.id);
  return inTransaction((client) => insertDef(client, session.user.id, workspaceId, body));
}

export async function archivePersonalCatalogAttribute(session: SessionContext, defId: string) {
  return inTransaction(async (client) => {
    const workspaceId = await personalWorkspaceId(client, session.user.id);
    if (!workspaceId) throw new ApiError(404, "not_found", "Atributo não encontrado.");
    await archiveDefWithClient(client, session.user.id, workspaceId, defId);
    return { id: defId, archived: true as const };
  });
}
