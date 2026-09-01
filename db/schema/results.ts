import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
} from "drizzle-orm/pg-core";

import { users } from "./accounts";
import { challengeFields, entryTypes } from "./challenge-definition";
import { challenges } from "./challenges";
import { timestamptz } from "./columns";
import { entryValues } from "./entries";

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
      sql`${table.operation} in ('sum', 'average', 'count', 'min', 'max', 'completion_rate',
        'bayesian_average', 'spread', 'surprise', 'indicator_bias')`,
    ),
    check(
      "challenge_metrics_group_by_check",
      sql`${table.groupBy} in ('none', 'participant', 'item', 'day', 'week')`,
    ),
    check(
      "challenge_metrics_field_requirement_check",
      sql`(${table.operation} in ('sum', 'average', 'min', 'max',
            'bayesian_average', 'spread', 'surprise', 'indicator_bias') and ${table.fieldId} is not null)
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
    sourceGroupId: text("source_group_id").notNull(),
    targetGroupId: text("target_group_id").notNull(),
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
      columns: [table.sourceChallengeId, table.sourceGroupId],
      foreignColumns: [challenges.id, challenges.groupId],
    }).onDelete("restrict"),
    foreignKey({
      name: "challenge_duplications_target_group_fk",
      columns: [table.targetChallengeId, table.targetGroupId],
      foreignColumns: [challenges.id, challenges.groupId],
    }).onDelete("cascade"),
    index("challenge_duplications_source_idx").on(table.sourceChallengeId, table.createdAt),
    check(
      "challenge_duplications_distinct_check",
      sql`${table.sourceChallengeId} <> ${table.targetChallengeId}`,
    ),
    check(
      "challenge_duplications_group_distinct_check",
      sql`${table.sourceGroupId} <> ${table.targetGroupId}`,
    ),
  ],
);
