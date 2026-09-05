import type { PoolClient } from "pg";
import { publicId } from "./shared";

/** Longer strings are prose (a comment, a rule, a headline) — the audit trail
 *  keeps the shape of a change, not its content. */
const REDACT_OVER = 60;
export const REDACTED = "[texto omitido]";

/**
 * Strips free text out of an audit `before`/`after` payload while keeping the
 * structure — which keys changed, and short scalar values like a status or a
 * role. The platform admin needs to see *that* a field changed, never the
 * private text that went into it.
 */
export function redactAuditPayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.length > REDACT_OVER ? REDACTED : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactAuditPayload(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactAuditPayload(inner, depth + 1);
    }
    return out;
  }
  return REDACTED;
}

/**
 * Operational breadcrumb for an irreversible action (a permanent delete, an
 * account removal). Goes to `system_audit_events`, which — unlike `audit_events`
 * — has no content foreign keys and no private text, so it can be written in the
 * same transaction that then deletes the group/challenge it refers to. The id is
 * stored only as a SHA-256 hash so support can correlate a report without
 * holding the raw identifier.
 */
export async function writeSystemAudit(
  client: PoolClient,
  actorUserId: string | null,
  action: string,
  entityKind: string,
  entityId: string,
  counts: Record<string, number> = {},
): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entityId));
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  await client.query(
    `INSERT INTO system_audit_events (id, actor_user_id, action, entity_kind, entity_id_hash, counts, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`,
    [publicId(), actorUserId, action, entityKind, hash, JSON.stringify(counts)],
  );
}

export async function writeAudit(
  client: PoolClient,
  groupId: string,
  challengeId: string | null,
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown = null,
  after: unknown = null,
  metadata: unknown = {},
): Promise<void> {
  const safeBefore = redactAuditPayload(before);
  const safeAfter = redactAuditPayload(after);
  await client.query(
    `INSERT INTO audit_events
      (id, group_id, challenge_id, actor_user_id, action, entity_type, entity_id,
       before, after, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,now())`,
    [publicId(), groupId, challengeId, actorUserId, action, entityType, entityId,
      safeBefore === null ? null : JSON.stringify(safeBefore), safeAfter === null ? null : JSON.stringify(safeAfter), JSON.stringify(redactAuditPayload(metadata))],
  );
}
