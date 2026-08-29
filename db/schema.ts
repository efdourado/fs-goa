import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

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
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    check("groups_name_check", sql`char_length(btrim(${table.name})) between 1 and 120`),
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

export const challenges = pgTable(
  "challenges",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    rules: text("rules"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    timeZone: text("time_zone").notNull().default("UTC"),
    status: text("status").notNull().default("draft"),
    activatedAt: timestamptz("activated_at"),
    closedAt: timestamptz("closed_at"),
    resultsPublishedAt: timestamptz("results_published_at"),
    resultShareTokenHash: text("result_share_token_hash"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("challenges_id_group_unique").on(table.id, table.groupId),
    unique("challenges_result_share_token_hash_unique").on(table.resultShareTokenHash),
    index("challenges_group_status_dates_idx").on(
      table.groupId,
      table.status,
      table.startDate,
      table.endDate,
    ),
    check("challenges_title_check", sql`char_length(btrim(${table.title})) between 1 and 160`),
    check("challenges_date_range_check", sql`${table.endDate} >= ${table.startDate}`),
    check("challenges_time_zone_check", sql`char_length(btrim(${table.timeZone})) between 1 and 100`),
    check("challenges_status_check", sql`${table.status} in ('draft', 'active', 'closed')`),
    check(
      "challenges_status_timestamps_check",
      sql`(${table.status} = 'draft' and ${table.activatedAt} is null and ${table.closedAt} is null)
        or (${table.status} = 'active' and ${table.activatedAt} is not null and ${table.closedAt} is null)
        or (${table.status} = 'closed' and ${table.activatedAt} is not null and ${table.closedAt} is not null and ${table.closedAt} >= ${table.activatedAt})`,
    ),
    check(
      "challenges_results_publication_check",
      sql`${table.resultsPublishedAt} is null or (${table.status} = 'closed' and ${table.resultsPublishedAt} >= ${table.closedAt})`,
    ),
    check(
      "challenges_share_token_check",
      sql`${table.resultShareTokenHash} is null or (${table.resultsPublishedAt} is not null and ${table.resultShareTokenHash} ~ '^[A-Za-z0-9_-]{43}$')`,
    ),
  ],
);

export const challengeParticipants = pgTable(
  "challenge_participants",
  {
    challengeId: text("challenge_id").notNull(),
    groupId: text("group_id").notNull(),
    userId: text("user_id").notNull(),
    addedByUserId: text("added_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    joinedAt: timestamptz("joined_at").defaultNow().notNull(),
    removedAt: timestamptz("removed_at"),
  },
  (table) => [
    primaryKey({
      name: "challenge_participants_pk",
      columns: [table.challengeId, table.userId],
    }),
    foreignKey({
      name: "challenge_participants_challenge_group_fk",
      columns: [table.challengeId, table.groupId],
      foreignColumns: [challenges.id, challenges.groupId],
    }).onDelete("cascade"),
    foreignKey({
      name: "challenge_participants_group_member_fk",
      columns: [table.groupId, table.userId],
      foreignColumns: [groupMembers.groupId, groupMembers.userId],
    }).onDelete("restrict"),
    index("challenge_participants_user_active_idx").on(table.userId, table.removedAt),
    index("challenge_participants_challenge_active_idx").on(
      table.challengeId,
      table.removedAt,
    ),
    check(
      "challenge_participants_removed_at_check",
      sql`${table.removedAt} is null or ${table.removedAt} >= ${table.joinedAt}`,
    ),
  ],
);

export const challengeCheckpoints = pgTable(
  "challenge_checkpoints",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    semanticKey: text("semantic_key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    startsAt: timestamptz("starts_at"),
    dueAt: timestamptz("due_at"),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("challenge_checkpoints_challenge_key_unique").on(
      table.challengeId,
      table.semanticKey,
    ),
    unique("challenge_checkpoints_id_challenge_unique").on(table.id, table.challengeId),
    index("challenge_checkpoints_order_idx").on(table.challengeId, table.position),
    check(
      "challenge_checkpoints_key_check",
      sql`${table.semanticKey} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      "challenge_checkpoints_title_check",
      sql`char_length(btrim(${table.title})) between 1 and 160`,
    ),
    check("challenge_checkpoints_position_check", sql`${table.position} >= 0`),
    check(
      "challenge_checkpoints_schedule_check",
      sql`${table.startsAt} is null or ${table.dueAt} is null or ${table.dueAt} >= ${table.startsAt}`,
    ),
  ],
);

export const entryTypes = pgTable(
  "entry_types",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    semanticKey: text("semantic_key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    submissionMode: text("submission_mode").notNull(),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("entry_types_challenge_key_unique").on(table.challengeId, table.semanticKey),
    unique("entry_types_id_challenge_unique").on(table.id, table.challengeId),
    unique("entry_types_id_challenge_mode_unique").on(
      table.id,
      table.challengeId,
      table.submissionMode,
    ),
    check("entry_types_key_check", sql`${table.semanticKey} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check("entry_types_name_check", sql`char_length(btrim(${table.name})) between 1 and 120`),
    check(
      "entry_types_submission_mode_check",
      sql`${table.submissionMode} in ('item', 'daily', 'free')`,
    ),
  ],
);

export const challengeItems = pgTable(
  "challenge_items",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id").notNull(),
    checkpointId: text("checkpoint_id"),
    entryTypeId: text("entry_type_id").notNull(),
    semanticKey: text("semantic_key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    opensAt: timestamptz("opens_at"),
    dueAt: timestamptz("due_at"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("challenge_items_challenge_key_unique").on(table.challengeId, table.semanticKey),
    unique("challenge_items_id_challenge_type_unique").on(
      table.id,
      table.challengeId,
      table.entryTypeId,
    ),
    foreignKey({
      name: "challenge_items_checkpoint_challenge_fk",
      columns: [table.checkpointId, table.challengeId],
      foreignColumns: [challengeCheckpoints.id, challengeCheckpoints.challengeId],
    }).onDelete("restrict"),
    foreignKey({
      name: "challenge_items_type_challenge_fk",
      columns: [table.entryTypeId, table.challengeId],
      foreignColumns: [entryTypes.id, entryTypes.challengeId],
    }).onDelete("restrict"),
    index("challenge_items_order_idx").on(
      table.challengeId,
      table.checkpointId,
      table.position,
    ),
    index("challenge_items_due_idx").on(table.challengeId, table.dueAt),
    check("challenge_items_key_check", sql`${table.semanticKey} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check("challenge_items_title_check", sql`char_length(btrim(${table.title})) between 1 and 200`),
    check("challenge_items_position_check", sql`${table.position} >= 0`),
    check(
      "challenge_items_schedule_check",
      sql`${table.opensAt} is null or ${table.dueAt} is null or ${table.dueAt} >= ${table.opensAt}`,
    ),
    check("challenge_items_metadata_object_check", sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
);

export const challengeFields = pgTable(
  "challenge_fields",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id").notNull(),
    entryTypeId: text("entry_type_id").notNull(),
    semanticKey: text("semantic_key").notNull(),
    label: text("label").notNull(),
    helpText: text("help_text"),
    kind: text("kind").notNull(),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
    numberScale: smallint("number_scale"),
    minScaled: bigint("min_scaled", { mode: "number" }),
    maxScaled: bigint("max_scaled", { mode: "number" }),
    stepScaled: bigint("step_scaled", { mode: "number" }),
    maxLength: integer("max_length"),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("challenge_fields_challenge_key_unique").on(
      table.challengeId,
      table.semanticKey,
    ),
    unique("challenge_fields_id_challenge_unique").on(table.id, table.challengeId),
    unique("challenge_fields_id_type_unique").on(table.id, table.entryTypeId),
    unique("challenge_fields_id_challenge_type_unique").on(
      table.id,
      table.challengeId,
      table.entryTypeId,
    ),
    foreignKey({
      name: "challenge_fields_type_challenge_fk",
      columns: [table.entryTypeId, table.challengeId],
      foreignColumns: [entryTypes.id, entryTypes.challengeId],
    }).onDelete("restrict"),
    index("challenge_fields_order_idx").on(table.entryTypeId, table.position),
    check("challenge_fields_key_check", sql`${table.semanticKey} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check("challenge_fields_label_check", sql`char_length(btrim(${table.label})) between 1 and 120`),
    check(
      "challenge_fields_kind_check",
      sql`${table.kind} in ('text', 'number', 'rating', 'choice', 'boolean', 'date')`,
    ),
    check("challenge_fields_position_check", sql`${table.position} >= 0`),
    check(
      "challenge_fields_numeric_config_check",
      sql`(
        ${table.kind} in ('number', 'rating')
        and ${table.numberScale} is not null
        and ${table.numberScale} between 0 and 6
        and (${table.minScaled} is null or ${table.maxScaled} is null or ${table.maxScaled} >= ${table.minScaled})
        and (${table.stepScaled} is null or ${table.stepScaled} > 0)
        and (${table.kind} <> 'rating' or (${table.minScaled} is not null and ${table.maxScaled} is not null and ${table.stepScaled} is not null))
      ) or (
        ${table.kind} not in ('number', 'rating')
        and ${table.numberScale} is null
        and ${table.minScaled} is null
        and ${table.maxScaled} is null
        and ${table.stepScaled} is null
      )`,
    ),
    check(
      "challenge_fields_text_config_check",
      sql`(${table.kind} = 'text' and (${table.maxLength} is null or ${table.maxLength} > 0))
        or (${table.kind} <> 'text' and ${table.maxLength} is null)`,
    ),
    check("challenge_fields_settings_object_check", sql`jsonb_typeof(${table.settings}) = 'object'`),
  ],
);

export const fieldOptions = pgTable(
  "field_options",
  {
    id: text("id").primaryKey(),
    fieldId: text("field_id")
      .notNull()
      .references(() => challengeFields.id, { onDelete: "restrict" }),
    semanticKey: text("semantic_key").notNull(),
    label: text("label").notNull(),
    position: integer("position").notNull().default(0),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("field_options_field_key_unique").on(table.fieldId, table.semanticKey),
    unique("field_options_id_field_unique").on(table.id, table.fieldId),
    index("field_options_order_idx").on(table.fieldId, table.position),
    check("field_options_key_check", sql`${table.semanticKey} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check("field_options_label_check", sql`char_length(btrim(${table.label})) between 1 and 120`),
    check("field_options_position_check", sql`${table.position} >= 0`),
  ],
);

export const entries = pgTable(
  "entries",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id").notNull(),
    entryTypeId: text("entry_type_id").notNull(),
    submissionMode: text("submission_mode").notNull(),
    itemId: text("item_id"),
    participantUserId: text("participant_user_id").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    submittedAt: timestamptz("submitted_at").defaultNow().notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    lastEditedByUserId: text("last_edited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    deletedAt: timestamptz("deleted_at"),
  },
  (table) => [
    unique("entries_id_challenge_type_unique").on(
      table.id,
      table.challengeId,
      table.entryTypeId,
    ),
    foreignKey({
      name: "entries_challenge_participant_fk",
      columns: [table.challengeId, table.participantUserId],
      foreignColumns: [challengeParticipants.challengeId, challengeParticipants.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "entries_type_challenge_mode_fk",
      columns: [table.entryTypeId, table.challengeId, table.submissionMode],
      foreignColumns: [entryTypes.id, entryTypes.challengeId, entryTypes.submissionMode],
    }).onDelete("restrict"),
    foreignKey({
      name: "entries_item_challenge_type_fk",
      columns: [table.itemId, table.challengeId, table.entryTypeId],
      foreignColumns: [challengeItems.id, challengeItems.challengeId, challengeItems.entryTypeId],
    }).onDelete("restrict"),
    uniqueIndex("entries_one_active_item_response_uidx")
      .on(table.itemId, table.participantUserId)
      .where(sql`${table.itemId} is not null and ${table.deletedAt} is null`),
    uniqueIndex("entries_one_active_daily_response_uidx")
      .on(
        table.challengeId,
        table.entryTypeId,
        table.participantUserId,
        table.occurredOn,
      )
      .where(sql`${table.submissionMode} = 'daily' and ${table.deletedAt} is null`),
    index("entries_participant_history_idx").on(
      table.challengeId,
      table.participantUserId,
      table.occurredOn,
    ),
    index("entries_challenge_active_idx").on(table.challengeId, table.deletedAt),
    index("entries_item_active_idx").on(table.itemId, table.deletedAt),
    check(
      "entries_item_mode_check",
      sql`(${table.submissionMode} = 'item' and ${table.itemId} is not null)
        or (${table.submissionMode} in ('daily', 'free') and ${table.itemId} is null)`,
    ),
    check(
      "entries_deleted_at_check",
      sql`${table.deletedAt} is null or ${table.deletedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const entryValues = pgTable(
  "entry_values",
  {
    entryId: text("entry_id").notNull(),
    challengeId: text("challenge_id").notNull(),
    entryTypeId: text("entry_type_id").notNull(),
    fieldId: text("field_id").notNull(),
    textValue: text("text_value"),
    numberScaled: bigint("number_scaled", { mode: "number" }),
    booleanValue: boolean("boolean_value"),
    dateValue: date("date_value", { mode: "string" }),
    optionId: text("option_id"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: "entry_values_pk", columns: [table.entryId, table.fieldId] }),
    unique("entry_values_entry_field_challenge_unique").on(
      table.entryId,
      table.fieldId,
      table.challengeId,
    ),
    foreignKey({
      name: "entry_values_entry_scope_fk",
      columns: [table.entryId, table.challengeId, table.entryTypeId],
      foreignColumns: [entries.id, entries.challengeId, entries.entryTypeId],
    }).onDelete("cascade"),
    foreignKey({
      name: "entry_values_field_scope_fk",
      columns: [table.fieldId, table.challengeId, table.entryTypeId],
      foreignColumns: [
        challengeFields.id,
        challengeFields.challengeId,
        challengeFields.entryTypeId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "entry_values_option_field_fk",
      columns: [table.optionId, table.fieldId],
      foreignColumns: [fieldOptions.id, fieldOptions.fieldId],
    }).onDelete("restrict"),
    index("entry_values_field_number_idx").on(table.fieldId, table.numberScaled),
    index("entry_values_field_option_idx").on(table.fieldId, table.optionId),
    check(
      "entry_values_exactly_one_value_check",
      sql`num_nonnulls(
        ${table.textValue},
        ${table.numberScaled},
        ${table.booleanValue},
        ${table.dateValue},
        ${table.optionId}
      ) = 1`,
    ),
  ],
);

export const challengeMetrics = pgTable(
  "challenge_metrics",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id").notNull(),
    entryTypeId: text("entry_type_id").notNull(),
    fieldId: text("field_id"),
    semanticKey: text("semantic_key").notNull(),
    label: text("label").notNull(),
    operation: text("operation").notNull(),
    groupBy: text("group_by").notNull().default("none"),
    decimalPlaces: smallint("decimal_places").notNull().default(2),
    visibleDuringChallenge: boolean("visible_during_challenge").notNull().default(true),
    position: integer("position").notNull().default(0),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("challenge_metrics_challenge_key_unique").on(
      table.challengeId,
      table.semanticKey,
    ),
    unique("challenge_metrics_id_challenge_unique").on(table.id, table.challengeId),
    foreignKey({
      name: "challenge_metrics_type_challenge_fk",
      columns: [table.entryTypeId, table.challengeId],
      foreignColumns: [entryTypes.id, entryTypes.challengeId],
    }).onDelete("restrict"),
    foreignKey({
      name: "challenge_metrics_field_scope_fk",
      columns: [table.fieldId, table.challengeId, table.entryTypeId],
      foreignColumns: [
        challengeFields.id,
        challengeFields.challengeId,
        challengeFields.entryTypeId,
      ],
    }).onDelete("restrict"),
    index("challenge_metrics_order_idx").on(table.challengeId, table.position),
    check("challenge_metrics_key_check", sql`${table.semanticKey} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check("challenge_metrics_label_check", sql`char_length(btrim(${table.label})) between 1 and 120`),
    check(
      "challenge_metrics_operation_check",
      sql`${table.operation} in ('sum', 'average', 'count', 'min', 'max', 'completion_rate')`,
    ),
    check(
      "challenge_metrics_group_by_check",
      sql`${table.groupBy} in ('none', 'participant', 'item', 'day', 'week')`,
    ),
    check(
      "challenge_metrics_field_requirement_check",
      sql`(${table.operation} in ('sum', 'average', 'min', 'max') and ${table.fieldId} is not null)
        or (${table.operation} = 'completion_rate' and ${table.fieldId} is null)
        or (${table.operation} = 'count')`,
    ),
    check(
      "challenge_metrics_format_check",
      sql`${table.decimalPlaces} between 0 and 6 and ${table.position} >= 0`,
    ),
    check("challenge_metrics_settings_object_check", sql`jsonb_typeof(${table.settings}) = 'object'`),
  ],
);

export const resultBlocks = pgTable(
  "result_blocks",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    metricId: text("metric_id"),
    sourceEntryId: text("source_entry_id"),
    sourceFieldId: text("source_field_id"),
    heading: text("heading"),
    bodySnapshot: text("body_snapshot"),
    valueSnapshot: jsonb("value_snapshot"),
    position: integer("position").notNull().default(0),
    visible: boolean("visible").notNull().default(true),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "result_blocks_metric_challenge_fk",
      columns: [table.metricId, table.challengeId],
      foreignColumns: [challengeMetrics.id, challengeMetrics.challengeId],
    }).onDelete("restrict"),
    foreignKey({
      name: "result_blocks_entry_value_challenge_fk",
      columns: [table.sourceEntryId, table.sourceFieldId, table.challengeId],
      foreignColumns: [entryValues.entryId, entryValues.fieldId, entryValues.challengeId],
    }).onDelete("restrict"),
    index("result_blocks_order_idx").on(table.challengeId, table.position),
    check("result_blocks_kind_check", sql`${table.kind} in ('metric', 'entry_value', 'text')`),
    check("result_blocks_position_check", sql`${table.position} >= 0`),
    check(
      "result_blocks_source_check",
      sql`(
          ${table.kind} = 'metric'
          and ${table.metricId} is not null
          and ${table.sourceEntryId} is null
          and ${table.sourceFieldId} is null
        ) or (
          ${table.kind} = 'entry_value'
          and ${table.metricId} is null
          and ${table.sourceEntryId} is not null
          and ${table.sourceFieldId} is not null
          and ${table.bodySnapshot} is not null
        ) or (
          ${table.kind} = 'text'
          and ${table.metricId} is null
          and ${table.sourceEntryId} is null
          and ${table.sourceFieldId} is null
          and ${table.bodySnapshot} is not null
        )`,
    ),
  ],
);

// Duplication is structural only. The service may clone challenge configuration,
// checkpoints, entry types, items, fields, options and metric definitions with new
// IDs. It must never clone participants, entries, values, curated result blocks,
// share tokens, sessions, invitations or any other personal data.
export const challengeDuplications = pgTable(
  "challenge_duplications",
  {
    groupId: text("group_id").notNull(),
    sourceChallengeId: text("source_challenge_id").notNull(),
    targetChallengeId: text("target_challenge_id").primaryKey(),
    copiedByUserId: text("copied_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "challenge_duplications_source_group_fk",
      columns: [table.sourceChallengeId, table.groupId],
      foreignColumns: [challenges.id, challenges.groupId],
    }).onDelete("restrict"),
    foreignKey({
      name: "challenge_duplications_target_group_fk",
      columns: [table.targetChallengeId, table.groupId],
      foreignColumns: [challenges.id, challenges.groupId],
    }).onDelete("cascade"),
    index("challenge_duplications_source_idx").on(table.sourceChallengeId, table.createdAt),
    check(
      "challenge_duplications_distinct_check",
      sql`${table.sourceChallengeId} <> ${table.targetChallengeId}`,
    ),
  ],
);

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
