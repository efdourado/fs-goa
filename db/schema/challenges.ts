import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";

import { users } from "./accounts";
import { timestamptz } from "./columns";
import { groupMembers, groups } from "./groups";

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
    ruleSections: jsonb("rule_sections")
      .$type<Array<{ title: string; description: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    recipeKey: text("recipe_key"),
    recipeVersion: integer("recipe_version").notNull().default(1),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    timeZone: text("time_zone").notNull().default("UTC"),
    status: text("status").notNull().default("draft"),
    activatedAt: timestamptz("activated_at"),
    closedAt: timestamptz("closed_at"),
    resultsPublishedAt: timestamptz("results_published_at"),
    resultShareTokenHash: text("result_share_token_hash"),
    // The raw share token, kept alongside its hash so the admin console can always
    // show and copy the public URL. The hash stays the lookup key on /results.
    resultShareToken: text("result_share_token"),
    // The frozen document served at /results/<token>: title, dates, the
    // (already anonymized) participant list and result blocks as of the last
    // publish. Editing the draft afterwards never touches this until republish.
    resultsPublishedSnapshot: jsonb("results_published_snapshot"),
    // When true, the public /results page replaces participant names with
    // "Participante 1, 2…". In-group views keep real names.
    resultsAnon: boolean("results_anon").notNull().default(false),
    publishedAsTemplateAt: timestamptz("published_as_template_at"),
    templateSummary: text("template_summary"),
    deletedAt: timestamptz("deleted_at"),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("challenges_group_active_idx")
      .on(table.groupId)
      .where(sql`${table.deletedAt} is null`),
    index("challenges_template_idx")
      .on(table.publishedAsTemplateAt)
      .where(sql`${table.publishedAsTemplateAt} is not null and ${table.deletedAt} is null`),
    check("challenges_title_check", sql`char_length(btrim(${table.title})) between 1 and 160`),
    check(
      "challenges_template_summary_check",
      sql`${table.templateSummary} is null or char_length(btrim(${table.templateSummary})) between 1 and 280`,
    ),
    check(
      "challenges_rule_sections_check",
      sql`jsonb_typeof(${table.ruleSections}) = 'array' and jsonb_array_length(${table.ruleSections}) <= 20`,
    ),
    check(
      "challenges_date_range_check",
      sql`(${table.startDate} is null and ${table.endDate} is null)
        or (${table.startDate} is not null and ${table.endDate} is not null and ${table.endDate} >= ${table.startDate})`,
    ),
    check(
      "challenges_deleted_at_check",
      sql`${table.deletedAt} is null or ${table.deletedAt} >= ${table.createdAt}`,
    ),
    check("challenges_time_zone_check", sql`char_length(btrim(${table.timeZone})) between 1 and 100`),
    check("challenges_status_check", sql`${table.status} in ('draft', 'active', 'closed')`),
    check(
      "challenges_recipe_key_check",
      sql`${table.recipeKey} is null or ${table.recipeKey} in ('cine_free', 'cine_curated', 'reading_club', 'reading_daily')`,
    ),
    check("challenges_recipe_version_check", sql`${table.recipeVersion} >= 1`),
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
    check(
      "challenges_result_share_token_check",
      sql`${table.resultShareToken} is null or ${table.resultShareToken} ~ '^[A-Za-z0-9_-]{43}$'`,
    ),
    check(
      // One-directional: a raw token always has its lookup hash. Legacy rows may
      // still carry a hash-only publication from before the raw column existed.
      "challenges_result_share_pairing_check",
      sql`${table.resultShareToken} is null or ${table.resultShareTokenHash} is not null`,
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
