import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

import { users } from "./accounts";
import { challenges } from "./challenges";
import { timestamptz } from "./columns";
import { groups } from "./groups";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    challengeId: text("challenge_id"),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "audit_events_challenge_group_fk",
      columns: [table.challengeId, table.groupId],
      foreignColumns: [challenges.id, challenges.groupId],
    }).onDelete("restrict"),
    index("audit_events_group_created_idx").on(table.groupId, table.createdAt),
    index("audit_events_challenge_created_idx").on(table.challengeId, table.createdAt),
    index("audit_events_entity_created_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    check("audit_events_action_check", sql`char_length(btrim(${table.action})) between 1 and 100`),
    check(
      "audit_events_entity_type_check",
      sql`char_length(btrim(${table.entityType})) between 1 and 80`,
    ),
    check("audit_events_metadata_object_check", sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
);
