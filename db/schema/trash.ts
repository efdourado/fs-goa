import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";

import { users } from "./accounts";
import { timestamptz } from "./columns";

/**
 * The recoverable-deletion registry (ROADMAP §13). Presence of a row here means
 * the object is **in the bin** — an explicit, user-initiated "move to trash",
 * distinct from `archived_at` (which stays reserved for "archive"). Deliberately
 * carries **no foreign key to a content table**: the row is removed in the same
 * transaction as a restore or a permanent delete, and a content-scoped FK would
 * make it impossible to delete a group/challenge while its bin record still
 * points at it.
 */
export const trashItems = pgTable(
  "trash_items",
  {
    id: text("id").primaryKey(),
    entityKind: text("entity_kind").notNull(),
    entityId: text("entity_id").notNull(),
    // 'personal' → scopeId is the owner's hidden workspace; 'group' → a group id.
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Only set when an admin bins another person's entry ("exclusão
    // administrativa exige motivo").
    reason: text("reason"),
    deletedAt: timestamptz("deleted_at").defaultNow().notNull(),
  },
  (table) => [
    unique("trash_items_entity_unique").on(table.entityKind, table.entityId),
    index("trash_items_scope_idx").on(table.scopeType, table.scopeId),
    check(
      "trash_items_entity_kind_check",
      sql`${table.entityKind} in ('group', 'challenge', 'catalog_item', 'entry')`,
    ),
    check("trash_items_scope_type_check", sql`${table.scopeType} in ('personal', 'group')`),
  ],
);

/**
 * Operational breadcrumbs for irreversible actions (permanent deletes, account
 * removal). Unlike `audit_events` this table holds **no private content and no
 * content foreign keys** — only who did what, to which kind of thing, and rough
 * counts. `entity_id_hash` lets support correlate a report without the raw id.
 */
export const systemAuditEvents = pgTable(
  "system_audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityKind: text("entity_kind").notNull(),
    entityIdHash: text("entity_id_hash").notNull(),
    counts: jsonb("counts").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("system_audit_events_created_idx").on(table.createdAt),
    check("system_audit_events_action_check", sql`char_length(btrim(${table.action})) between 1 and 100`),
    check("system_audit_events_counts_object_check", sql`jsonb_typeof(${table.counts}) = 'object'`),
  ],
);
