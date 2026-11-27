import type { PoolClient } from "pg";

import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
import { ApiError } from "../../http";
import { challengeAccess } from "../domain/access";
import { writeAudit } from "../domain/audit";
import { ensureCatalogLibrary, insertLibrary, resolveItemKind } from "../catalog";
import { entryTypesForChallenge, recipeCatalogKind, usesRoundItems } from "./entry-types";

interface ChallengeLibraryRow {
  /** `null` for a built-in library (Screens/Pages) that has never held an item, so has no row yet. */
  id: string | null;
  kind: string;
  source: string;
  label: string | null;
  position: number;
}

const BUILT_IN_SOURCE: Record<string, string> = { film: "screens", book: "pages" };

async function linkedRows(client: PoolClient, challengeId: string): Promise<ChallengeLibraryRow[]> {
  const result = await client.query<ChallengeLibraryRow>(
    `SELECT cl.id, x.kind, cl.source, cl.label, x.position
       FROM challenge_libraries x
       JOIN catalog_libraries cl ON cl.group_id = x.group_id AND cl.kind = x.kind
      WHERE x.challenge_id = $1 ORDER BY x.position, x.kind`,
    [challengeId],
  );
  return result.rows;
}

/**
 * What a challenge that predates stored libraries implies: the one its recipe
 * tracks and the ones its existing items come from. Only used when nothing is
 * stored, so old challenges keep working until a write links them properly.
 */
async function impliedKinds(client: PoolClient, challengeId: string, recipeKey: string | null): Promise<string[]> {
  const kinds: string[] = [];
  const fixed = recipeCatalogKind(recipeKey);
  if (fixed) kinds.push(fixed);
  const fromItems = await client.query<{ kind: string }>(
    `SELECT ci.kind FROM challenge_items it JOIN catalog_items ci ON ci.id = it.catalog_item_id
      WHERE it.challenge_id = $1 AND it.archived_at IS NULL
      GROUP BY ci.kind ORDER BY min(it.position), ci.kind`,
    [challengeId],
  );
  for (const row of fromItems.rows) if (!kinds.includes(row.kind)) kinds.push(row.kind);
  return kinds;
}

/** The challenge's libraries, in the order they were linked. Never writes. */
export async function readChallengeLibraries(
  client: PoolClient,
  challengeId: string,
  groupId: string,
  recipeKey: string | null,
): Promise<ChallengeLibraryRow[]> {
  const stored = await linkedRows(client, challengeId);
  if (stored.length) return stored;
  const rows: ChallengeLibraryRow[] = [];
  for (const kind of await impliedKinds(client, challengeId, recipeKey)) {
    const library = await oneOrNull<{ id: string; source: string; label: string | null }>(
      client,
      "SELECT id, source, label FROM catalog_libraries WHERE group_id = $1 AND kind = $2",
      [groupId, kind],
    );
    rows.push({
      id: library?.id ?? null, kind, source: library?.source ?? BUILT_IN_SOURCE[kind] ?? "custom",
      label: library?.label ?? null, position: rows.length,
    });
  }
  return rows;
}

/**
 * Links a workspace library to a challenge (a no-op if it already is). A built-in
 * library that has never held an item is created on the spot; any other kind
 * must already exist in this workspace, so a link can never invent a library.
 */
export async function linkChallengeLibrary(
  client: PoolClient,
  challengeId: string,
  groupId: string,
  kind: string,
  actorUserId: string,
): Promise<void> {
  // One library per challenge: linking a second is refused (the database enforces it too).
  const current = await oneOrNull<{ kind: string }>(client, "SELECT kind FROM challenge_libraries WHERE challenge_id = $1", [challengeId]);
  if (current && current.kind !== kind) throw new ApiError(409, "one_library", "Um desafio usa uma biblioteca só.");
  if (current) return;
  if (kind === "film" || kind === "book") {
    await ensureCatalogLibrary(client, groupId, kind, actorUserId);
  } else {
    const exists = await oneOrNull<{ id: string }>(
      client, "SELECT id FROM catalog_libraries WHERE group_id = $1 AND kind = $2", [groupId, kind],
    );
    if (!exists) throw new ApiError(400, "invalid_library", "Biblioteca não encontrada.");
  }
  await client.query(
    `INSERT INTO challenge_libraries (challenge_id, group_id, kind, position)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (challenge_id, kind) DO NOTHING`,
    [challengeId, groupId, kind],
  );
}

/** Stores what an old challenge implied, the first time anything writes to it. */
export async function ensureChallengeLibraries(
  client: PoolClient,
  challenge: { id: string; group_id: string; recipe_key: string | null },
  actorUserId: string,
): Promise<ChallengeLibraryRow[]> {
  const stored = await linkedRows(client, challenge.id);
  if (stored.length) return stored;
  for (const kind of await impliedKinds(client, challenge.id, challenge.recipe_key)) {
    await linkChallengeLibrary(client, challenge.id, challenge.group_id, kind, actorUserId);
  }
  return linkedRows(client, challenge.id);
}

/**
 * Which linked library an item belongs to. An explicit choice (`libraryId`, or
 * `libraryKind` for a built-in with no id yet) or the library of a catalog item
 * being reused wins; otherwise the challenge's one library. It must be the library
 * the challenge has linked, items are never
 * silently pulled from a library the challenge doesn't use.
 */
export async function resolveItemLibrary(
  client: PoolClient,
  challenge: { id: string; group_id: string },
  linked: ChallengeLibraryRow[],
  spec: { libraryId?: unknown; libraryKind?: unknown },
  catalogItemId?: unknown,
): Promise<string> {
  const explicit = (typeof spec.libraryId === "string" && spec.libraryId) || (typeof spec.libraryKind === "string" && spec.libraryKind);
  let kind: string | null = null;
  if (explicit) {
    kind = await resolveItemKind(client, challenge.group_id, { libraryId: spec.libraryId, kind: spec.libraryKind });
  } else if (typeof catalogItemId === "string" && catalogItemId) {
    kind = (await oneOrNull<{ kind: string }>(
      client, "SELECT kind FROM catalog_items WHERE id = $1 AND group_id = $2 AND archived_at IS NULL", [catalogItemId, challenge.group_id],
    ))?.kind ?? null;
    if (!kind) throw new ApiError(400, "invalid_catalog_item", "Item da coleção não pertence a este grupo.");
  } else if (linked.length) {
    kind = linked[0].kind;
  } else {
    throw new ApiError(400, "library_required", "Vincule uma biblioteca antes de adicionar itens.");
  }
  if (!linked.some((library) => library.kind === kind)) {
    throw new ApiError(400, "library_not_linked", "Vincule essa biblioteca antes de usar os itens dela.");
  }
  return kind;
}

/** `POST /challenges/:id/libraries`: the library a challenge with none yet draws its items from. */
export async function addChallengeLibrary(session: SessionContext, challengeId: string, body: Record<string, unknown>) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores vinculam bibliotecas.");
    if (access.challenge.status === "closed") {
      throw new ApiError(409, "challenge_locked", "Um desafio encerrado fica congelado.");
    }
    const types = await entryTypesForChallenge(client, challengeId);
    if (!usesRoundItems(types)) throw new ApiError(409, "invalid_mode", "Este desafio não usa itens.");
    await ensureChallengeLibraries(client, access.challenge, session.user.id);
    await chooseChallengeLibrary(client, { id: challengeId, group_id: access.challenge.group_id }, body, null, session.user.id);
    return { libraries: await linkedRows(client, challengeId) };
  });
}

/** `DELETE /challenges/:id/libraries/:libraryId`: only while no item comes from it, so a wrong pick can be swapped. */
export async function removeChallengeLibrary(session: SessionContext, challengeId: string, libraryId: string) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores desvinculam bibliotecas.");
    if (access.challenge.status === "closed") {
      throw new ApiError(409, "challenge_locked", "Um desafio encerrado fica congelado.");
    }
    await ensureChallengeLibraries(client, access.challenge, session.user.id);
    const library = await oneOrNull<{ kind: string }>(
      client,
      `SELECT x.kind FROM challenge_libraries x
         JOIN catalog_libraries cl ON cl.group_id = x.group_id AND cl.kind = x.kind
        WHERE x.challenge_id = $1 AND cl.id = $2`,
      [challengeId, libraryId],
    );
    if (!library) throw new ApiError(404, "not_found", "Essa biblioteca não está vinculada ao desafio.");
    const inUse = await oneOrNull<{ count: number }>(
      client,
      `SELECT count(*)::int AS count FROM challenge_items it JOIN catalog_items ci ON ci.id = it.catalog_item_id
        WHERE it.challenge_id = $1 AND it.archived_at IS NULL AND ci.kind = $2`,
      [challengeId, library.kind],
    );
    if ((inUse?.count ?? 0) > 0) {
      throw new ApiError(409, "library_in_use", "Remova os itens dessa biblioteca do desafio antes.");
    }
    await client.query("DELETE FROM challenge_libraries WHERE challenge_id = $1 AND kind = $2", [challengeId, library.kind]);
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "challenge.library_unlinked", "challenge", challengeId, null, { kind: library.kind });
    return { libraries: await linkedRows(client, challengeId) };
  });
}

/** The library a challenge draws from, as a copy of it sees it: what its suggestion rebuilds, columns included. */
export interface LibraryOrigin {
  groupId: string;
  kind: string;
  source: string;
  label: string | null;
}

/** A challenge's (first, only) library, or null when it uses none. */
export async function describeChallengeLibrary(
  client: PoolClient,
  challenge: { id: string; group_id: string; recipe_key: string | null },
): Promise<LibraryOrigin | null> {
  const [library] = await readChallengeLibraries(client, challenge.id, challenge.group_id, challenge.recipe_key);
  return library ? { groupId: challenge.group_id, kind: library.kind, source: library.source, label: library.label } : null;
}

const BUILT_IN_KINDS = new Set(["film", "book"]);

/**
 * A copy of a challenge that draws from a library has to say which library its items go to (`library` in the body):
 * nothing is picked, used or made for its owner. `{ libraryId }` / `{ libraryKind }` is one the destination has;
 * `{ suggested: true }` is the source's library made in the destination (offered when it has none of its own).
 */
export async function linkCopyLibrary(
  client: PoolClient,
  copy: { id: string; group_id: string },
  body: Record<string, unknown>,
  origin: LibraryOrigin | null,
  actorUserId: string,
): Promise<void> {
  if (!origin) return;
  const pick = body.library && typeof body.library === "object" ? body.library as Record<string, unknown> : null;
  if (!pick) throw new ApiError(400, "copy_library_required", "Escolha a biblioteca onde ficam os itens da cópia.");
  await chooseChallengeLibrary(client, copy, pick, origin, actorUserId);
}

/**
 * Links a challenge with no library yet to the one picked: `libraryId`/`libraryKind` for one the workspace has, or
 * `suggested: true` for the origin's library rebuilt here: a built-in as the workspace's own Screens/Pages, any other as
 * a new library under the same name with the same columns (never its items), and the same kind while this workspace
 * doesn't have it.
 */
export async function chooseChallengeLibrary(
  client: PoolClient,
  challenge: { id: string; group_id: string },
  body: Record<string, unknown>,
  origin: LibraryOrigin | null,
  actorUserId: string,
): Promise<void> {
  let kind: string;
  if (body.suggested === true) {
    if (!origin) throw new ApiError(400, "invalid_library", "Biblioteca não encontrada.");
    const here = await oneOrNull<{ id: string }>(
      client, "SELECT id FROM catalog_libraries WHERE group_id = $1 AND kind = $2", [challenge.group_id, origin.kind],
    );
    if (BUILT_IN_KINDS.has(origin.kind) || here) {
      kind = origin.kind;
    } else {
      const source = origin.source === "tables" ? "tables" : "custom";
      const made = await insertLibrary(client, challenge.group_id, actorUserId, { label: origin.label, source }, origin.kind);
      kind = made.kind;
      await copyLibraryColumns(client, origin, { groupId: challenge.group_id, kind, libraryId: made.id }, actorUserId);
    }
  } else {
    kind = await resolveItemKind(client, challenge.group_id, { libraryId: body.libraryId, kind: body.libraryKind });
  }
  await linkChallengeLibrary(client, challenge.id, challenge.group_id, kind, actorUserId);
  await writeAudit(client, challenge.group_id, challenge.id, actorUserId,
    "challenge.library_linked", "challenge", challenge.id, null, { kind });
}
/** The origin library's columns, renamed/hidden built-in ones included, onto a library just made from it (never its items). */
async function copyLibraryColumns(
  client: PoolClient,
  origin: LibraryOrigin,
  target: { groupId: string; kind: string; libraryId: string },
  actorUserId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO catalog_native_property_configs (id, library_id, property_key, label, hidden, position, created_at, updated_at)
     SELECT gen_random_uuid()::text, $3, n.property_key, n.label, n.hidden, n.position, now(), now()
       FROM catalog_native_property_configs n
       JOIN catalog_libraries cl ON cl.id = n.library_id AND cl.group_id = $1 AND cl.kind = $2
     ON CONFLICT (library_id, property_key) DO NOTHING`,
    [origin.groupId, origin.kind, target.libraryId],
  );
  await client.query(
    `INSERT INTO catalog_attribute_defs
       (id, group_id, kind, semantic_key, label, type, unit, position, hidden, created_by_user_id, created_at, updated_at)
     SELECT gen_random_uuid()::text, $3, $4, d.semantic_key, d.label, d.type, d.unit, d.position, d.hidden, $5, now(), now()
       FROM catalog_attribute_defs d
      WHERE d.group_id = $1 AND d.kind = $2 AND d.archived_at IS NULL
     ON CONFLICT (group_id, kind, semantic_key) DO NOTHING`,
    [origin.groupId, origin.kind, target.groupId, target.kind, actorUserId],
  );
}
