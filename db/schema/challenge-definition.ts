import { sql } from "drizzle-orm";
import {
  bigint,
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
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./accounts";
import { catalogItems } from "./catalog";
import { challengeCheckpoints, challenges } from "./challenges";
import { timestamptz } from "./columns";

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
    // Four orthogonal axes that `submission_mode` used to collapse. Nullable while
    // legacy rows catch up; the app falls back to the `submission_mode` default.
    purpose: text("purpose"),
    targetPolicy: text("target_policy"),
    cardinality: text("cardinality"),
    schedulePolicy: text("schedule_policy"),
    // The type the single-type surfaces default to (detail's flat `fields`, the
    // metrics tab). Exactly one per challenge; set by the recipe at creation.
    isPrimary: boolean("is_primary").notNull().default(false),
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
    uniqueIndex("entry_types_one_primary_uidx")
      .on(table.challengeId)
      .where(sql`${table.isPrimary}`),
    check("entry_types_key_check", sql`${table.semanticKey} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check("entry_types_name_check", sql`char_length(btrim(${table.name})) between 1 and 120`),
    check(
      "entry_types_submission_mode_check",
      sql`${table.submissionMode} in ('item', 'daily', 'free')`,
    ),
    check(
      "entry_types_purpose_check",
      sql`${table.purpose} is null or ${table.purpose} in ('progress', 'completion', 'expectation', 'rating', 'checkin')`,
    ),
    check(
      "entry_types_target_policy_check",
      sql`${table.targetPolicy} is null or ${table.targetPolicy} in ('required', 'optional', 'none')`,
    ),
    check(
      "entry_types_cardinality_check",
      sql`${table.cardinality} is null or ${table.cardinality} in ('once_per_item', 'once_per_item_day', 'repeatable', 'once_per_day')`,
    ),
    check(
      "entry_types_schedule_policy_check",
      sql`${table.schedulePolicy} is null or ${table.schedulePolicy} in ('free', 'while_active', 'checkpoint')`,
    ),
  ],
);

export const challengeItems = pgTable(
  "challenge_items",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id").notNull(),
    checkpointId: text("checkpoint_id"),
    // A round item is now type-agnostic: it names the film in this round; the
    // entry carries the entry type ("registro", "expectativa"…). Legacy rows keep
    // their value, new cine items are inserted NULL.
    entryTypeId: text("entry_type_id"),
    catalogItemId: text("catalog_item_id").references(() => catalogItems.id, { onDelete: "restrict" }),
    recommendedByUserId: text("recommended_by_user_id").references(() => users.id, { onDelete: "set null" }),
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
    unique("challenge_items_id_challenge_unique").on(table.id, table.challengeId),
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
    index("challenge_items_catalog_idx").on(table.catalogItemId),
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

