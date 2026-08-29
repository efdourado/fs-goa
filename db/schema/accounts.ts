import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { timestamptz } from "./columns";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    passwordHash: text("password_hash").notNull(),
    passwordChangedAt: timestamptz("password_changed_at").defaultNow().notNull(),
    platformAdmin: boolean("platform_admin").notNull().default(false),
    disabledAt: timestamptz("disabled_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_username_normalized_uidx").on(table.usernameNormalized),
    uniqueIndex("users_email_normalized_uidx")
      .on(table.emailNormalized)
      .where(sql`${table.emailNormalized} is not null`),
    check(
      "users_username_normalized_check",
      sql`${table.usernameNormalized} ~ '^[a-z0-9][a-z0-9._-]{2,31}$'`,
    ),
    check(
      "users_display_name_check",
      sql`char_length(btrim(${table.displayName})) between 1 and 80`,
    ),
    check("users_username_check", sql`char_length(${table.username}) between 3 and 32`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    lastSeenAt: timestamptz("last_seen_at").defaultNow().notNull(),
    revokedAt: timestamptz("revoked_at"),
    revokeReason: text("revoke_reason"),
    rotatedFromSessionId: text("rotated_from_session_id"),
  },
  (table) => [
    unique("sessions_token_hash_unique").on(table.tokenHash),
    unique("sessions_rotated_from_unique").on(table.rotatedFromSessionId),
    foreignKey({
      name: "sessions_rotated_from_fk",
      columns: [table.rotatedFromSessionId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
    index("sessions_user_active_idx").on(table.userId, table.revokedAt),
    index("sessions_expires_at_idx").on(table.expiresAt),
    check(
      "sessions_token_hash_check",
      sql`${table.tokenHash} ~ '^[A-Za-z0-9_-]{43}$'`,
    ),
    check("sessions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "sessions_revocation_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

// This table deliberately does not reference users: unknown usernames must be
// rate-limited exactly like existing ones, without leaking account existence.
export const loginAttempts = pgTable(
  "login_attempts",
  {
    usernameNormalized: text("username_normalized").primaryKey(),
    windowStartedAt: timestamptz("window_started_at").defaultNow().notNull(),
    failureCount: integer("failure_count").notNull().default(0),
    lockedUntil: timestamptz("locked_until"),
  },
  (table) => [
    index("login_attempts_locked_until_idx").on(table.lockedUntil),
    check(
      "login_attempts_username_check",
      sql`${table.usernameNormalized} ~ '^[a-z0-9][a-z0-9._-]{2,31}$'`,
    ),
    check("login_attempts_failure_count_check", sql`${table.failureCount} >= 0`),
    check(
      "login_attempts_lock_window_check",
      sql`${table.lockedUntil} is null or ${table.lockedUntil} >= ${table.windowStartedAt}`,
    ),
  ],
);

