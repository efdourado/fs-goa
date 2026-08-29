import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./accounts";
import { timestamptz } from "./columns";

export const groups = pgTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamptz("archived_at"),
    deletedAt: timestamptz("deleted_at"),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("groups_owner_active_idx")
      .on(table.ownerUserId)
      .where(sql`${table.deletedAt} is null and ${table.archivedAt} is null`),
    check("groups_name_check", sql`char_length(btrim(${table.name})) between 1 and 120`),
    check(
      "groups_deleted_at_check",
      sql`${table.deletedAt} is null or ${table.deletedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    addedByUserId: text("added_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    joinedAt: timestamptz("joined_at").defaultNow().notNull(),
    removedAt: timestamptz("removed_at"),
  },
  (table) => [
    primaryKey({ name: "group_members_pk", columns: [table.groupId, table.userId] }),
    uniqueIndex("group_members_one_active_owner_uidx")
      .on(table.groupId)
      .where(sql`${table.role} = 'owner' and ${table.removedAt} is null`),
    index("group_members_user_active_idx").on(table.userId, table.removedAt),
    index("group_members_group_role_active_idx").on(
      table.groupId,
      table.role,
      table.removedAt,
    ),
    check("group_members_role_check", sql`${table.role} in ('owner', 'admin', 'participant')`),
    check(
      "group_members_removed_at_check",
      sql`${table.removedAt} is null or ${table.removedAt} >= ${table.joinedAt}`,
    ),
  ],
);

export const groupInvites = pgTable(
  "group_invites",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    role: text("role").notNull().default("participant"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    maxUses: integer("max_uses").notNull().default(1),
    useCount: integer("use_count").notNull().default(0),
    expiresAt: timestamptz("expires_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("group_invites_token_hash_unique").on(table.tokenHash),
    index("group_invites_group_active_idx").on(
      table.groupId,
      table.revokedAt,
      table.expiresAt,
    ),
    index("group_invites_expires_at_idx").on(table.expiresAt),
    check(
      "group_invites_token_hash_check",
      sql`${table.tokenHash} ~ '^[A-Za-z0-9_-]{43}$'`,
    ),
    check("group_invites_role_check", sql`${table.role} in ('admin', 'participant')`),
    check(
      "group_invites_usage_check",
      sql`${table.maxUses} > 0 and ${table.useCount} between 0 and ${table.maxUses}`,
    ),
    check("group_invites_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "group_invites_revocation_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const inviteRedemptions = pgTable(
  "invite_redemptions",
  {
    inviteId: text("invite_id")
      .notNull()
      .references(() => groupInvites.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    redeemedAt: timestamptz("redeemed_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: "invite_redemptions_pk", columns: [table.inviteId, table.userId] }),
    index("invite_redemptions_user_idx").on(table.userId, table.redeemedAt),
  ],
);

