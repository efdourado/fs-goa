import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./accounts";
import {
  challengeFields,
  challengeItems,
  entryTypes,
  fieldOptions,
} from "./challenge-definition";
import { challengeCheckpoints, challengeParticipants } from "./challenges";
import { timestamptz } from "./columns";

export const entries = pgTable(
  "entries",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id").notNull(),
    entryTypeId: text("entry_type_id").notNull(),
    submissionMode: text("submission_mode").notNull(),
    // Denormalized from the entry type (like `submission_mode`) so the partial
    // unique indexes below can key off it. Set once, at insert.
    cardinality: text("cardinality"),
    itemId: text("item_id"),
    checkpointId: text("checkpoint_id"),
    participantUserId: text("participant_user_id").notNull(),
    // Nullable: a plain round entry ("I watched it, no date in mind") can skip
    // the date. Day-keyed cardinalities (`once_per_day`, `once_per_item_day`)
    // still always carry one — the entry API fills today when it's omitted.
    occurredOn: date("occurred_on", { mode: "string" }),
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
      name: "entries_item_challenge_fk",
      columns: [table.itemId, table.challengeId],
      foreignColumns: [challengeItems.id, challengeItems.challengeId],
    }).onDelete("restrict"),
    foreignKey({
      name: "entries_checkpoint_challenge_fk",
      columns: [table.checkpointId, table.challengeId],
      foreignColumns: [challengeCheckpoints.id, challengeCheckpoints.challengeId],
    }).onDelete("restrict"),
    uniqueIndex("entries_one_active_item_response_uidx")
      .on(table.itemId, table.entryTypeId, table.participantUserId)
      .where(
        sql`${table.cardinality} = 'once_per_item' and ${table.itemId} is not null and ${table.deletedAt} is null`,
      ),
    uniqueIndex("entries_one_active_item_day_uidx")
      .on(table.itemId, table.entryTypeId, table.participantUserId, table.occurredOn)
      .where(
        sql`${table.cardinality} = 'once_per_item_day' and ${table.itemId} is not null and ${table.deletedAt} is null`,
      ),
    uniqueIndex("entries_one_active_daily_response_uidx")
      .on(
        table.challengeId,
        table.entryTypeId,
        table.participantUserId,
        table.occurredOn,
      )
      .where(sql`${table.cardinality} = 'once_per_day' and ${table.deletedAt} is null`),
    index("entries_participant_history_idx").on(
      table.challengeId,
      table.participantUserId,
      table.occurredOn,
    ),
    index("entries_challenge_active_idx").on(table.challengeId, table.deletedAt),
    index("entries_item_active_idx").on(table.itemId, table.deletedAt),
    check(
      "entries_item_target_check",
      sql`${table.submissionMode} <> 'item' or ${table.itemId} is not null`,
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

