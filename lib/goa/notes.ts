import type { PoolClient } from "pg";

import type { SessionContext } from "../auth";
import { inTransaction, withClient } from "../db";
import { ApiError, stringValue } from "../http";
import { publicId } from "./domain/shared";

/** The six tag colours already used for a challenge card's colour dot — reused so a note picks up no new palette. */
const COLOR_TAGS = ["green", "blue", "violet", "coral", "amber", "rose"] as const;
type ColorTag = (typeof COLOR_TAGS)[number];
function isColorTag(value: unknown): value is ColorTag {
  return typeof value === "string" && (COLOR_TAGS as readonly string[]).includes(value);
}

export interface NoteItem {
  id: string;
  text: string;
  done: boolean;
}

interface NoteRow {
  id: string;
  kind: "text" | "checklist";
  title: string;
  body: string | null;
  items: unknown;
  color_tag: string | null;
  pinned: boolean;
  created_at: Date;
  updated_at: Date;
}

/** One checklist row, trusted only after this — a stray object in the jsonb array never reaches the client. */
function readItem(raw: unknown): NoteItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) return null;
  return {
    id: typeof record.id === "string" && record.id ? record.id : publicId(),
    text: text.slice(0, 300),
    done: record.done === true,
  };
}

/** `items` from a request body — absent means "leave as is" (a title-only edit), present means "replace". */
function readItemsInput(body: Record<string, unknown>): NoteItem[] | undefined {
  if (!("items" in body)) return undefined;
  if (!Array.isArray(body.items)) throw new ApiError(400, "invalid_field", "items precisa ser uma lista.");
  const items = body.items.map(readItem).filter((item): item is NoteItem => item !== null);
  if (items.length > 300) throw new ApiError(400, "invalid_field", "Uma lista aceita até 300 itens.");
  return items;
}

function serialize(row: NoteRow) {
  const items = Array.isArray(row.items) ? row.items.map(readItem).filter((item): item is NoteItem => item !== null) : [];
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    items: row.kind === "checklist" ? items : [],
    colorTag: row.color_tag as ColorTag | null,
    pinned: row.pinned,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT = `SELECT id, kind, title, body, items, color_tag, pinned, created_at, updated_at FROM notes`;

/** Every note of the person's own space, pinned first, then most recently touched. */
export async function listNotes(session: SessionContext) {
  return withClient(async (client) => {
    const result = await client.query<NoteRow>(
      `${SELECT} WHERE user_id = $1 AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC`,
      [session.user.id],
    );
    return { notes: result.rows.map(serialize) };
  });
}

async function findOwnNote(client: PoolClient, userId: string, noteId: string): Promise<NoteRow> {
  const result = await client.query<NoteRow>(
    `${SELECT} WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [noteId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "not_found", "Nota não encontrada.");
  return row;
}

export async function createNote(session: SessionContext, body: Record<string, unknown>) {
  const kind = body.kind === "checklist" ? "checklist" : "text";
  const title = stringValue(body, "title", { min: 1, max: 160 })!;
  const text = kind === "text" ? stringValue(body, "body", { max: 20000, optional: true }) ?? null : null;
  const items = kind === "checklist" ? readItemsInput(body) ?? [] : [];
  const colorTag = isColorTag(body.colorTag) ? body.colorTag : null;
  return inTransaction(async (client) => {
    const id = publicId();
    const result = await client.query<NoteRow>(
      `INSERT INTO notes (id, user_id, kind, title, body, items, color_tag, pinned, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,false,now(),now())
       RETURNING id, kind, title, body, items, color_tag, pinned, created_at, updated_at`,
      [id, session.user.id, kind, title, text, JSON.stringify(items), colorTag],
    );
    return serialize(result.rows[0]);
  });
}

/**
 * A partial save: only the fields the request actually names are touched, so ticking one checklist item
 * (`items` alone) never risks racing a title edit made from another tab, and vice versa. `kind` is fixed
 * at creation — a text note and a checklist are different enough shapes that switching one into the other
 * would just orphan whichever content mode it leaves behind.
 */
export async function updateNote(session: SessionContext, noteId: string, body: Record<string, unknown>) {
  return inTransaction(async (client) => {
    const existing = await findOwnNote(client, session.user.id, noteId);
    const title = "title" in body ? stringValue(body, "title", { min: 1, max: 160 })! : existing.title;
    const bodyText = existing.kind === "text" && "body" in body
      ? stringValue(body, "body", { max: 20000, optional: true }) ?? null
      : existing.body;
    const items = existing.kind === "checklist" ? readItemsInput(body) ?? existing.items : existing.items;
    const colorTag = "colorTag" in body ? (isColorTag(body.colorTag) ? body.colorTag : null) : existing.color_tag;
    const pinned = typeof body.pinned === "boolean" ? body.pinned : existing.pinned;
    const result = await client.query<NoteRow>(
      `UPDATE notes SET title=$1, body=$2, items=$3::jsonb, color_tag=$4, pinned=$5, updated_at=now()
        WHERE id=$6 AND user_id=$7
        RETURNING id, kind, title, body, items, color_tag, pinned, created_at, updated_at`,
      [title, bodyText, JSON.stringify(Array.isArray(items) ? items : []), colorTag, pinned, noteId, session.user.id],
    );
    return serialize(result.rows[0]);
  });
}

/** Ticks (or unticks) one checklist row without the client resending the whole list — the common tap. */
export async function toggleNoteItem(session: SessionContext, noteId: string, body: Record<string, unknown>) {
  const itemId = stringValue(body, "itemId", { min: 1, max: 100 })!;
  const done = body.done === true;
  return inTransaction(async (client) => {
    const existing = await findOwnNote(client, session.user.id, noteId);
    if (existing.kind !== "checklist") throw new ApiError(400, "not_a_checklist", "Esta nota não é uma lista.");
    const items = (Array.isArray(existing.items) ? existing.items : [])
      .map(readItem)
      .filter((item): item is NoteItem => item !== null);
    if (!items.some((item) => item.id === itemId)) throw new ApiError(404, "not_found", "Item não encontrado.");
    const next = items.map((item) => (item.id === itemId ? { ...item, done } : item));
    const result = await client.query<NoteRow>(
      `UPDATE notes SET items=$1::jsonb, updated_at=now() WHERE id=$2 AND user_id=$3
        RETURNING id, kind, title, body, items, color_tag, pinned, created_at, updated_at`,
      [JSON.stringify(next), noteId, session.user.id],
    );
    return serialize(result.rows[0]);
  });
}

export async function deleteNote(session: SessionContext, noteId: string) {
  return inTransaction(async (client) => {
    await findOwnNote(client, session.user.id, noteId);
    await client.query("UPDATE notes SET deleted_at = now() WHERE id = $1 AND user_id = $2", [noteId, session.user.id]);
    return { id: noteId, deleted: true };
  });
}
