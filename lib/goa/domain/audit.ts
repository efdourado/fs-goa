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
