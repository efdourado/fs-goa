import type { PoolClient } from "pg";
import { publicId } from "./shared";

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
  await client.query(
    `INSERT INTO audit_events
      (id, group_id, challenge_id, actor_user_id, action, entity_type, entity_id,
       before, after, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,now())`,
    [publicId(), groupId, challengeId, actorUserId, action, entityType, entityId,
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), JSON.stringify(metadata)],
  );
}
