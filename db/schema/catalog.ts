import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
} from "drizzle-orm/pg-core";

import { users } from "./accounts";
import { timestamptz } from "./columns";
import { groups } from "./groups";

/**
 * The group's living catalog: a film or book has ONE identity that survives
 * across challenge rounds. `challenge_items` (the per-round row) points here via
 * `catalog_item_id`. `normalized_title` is the human-insensitive match key so two
 * spellings of the same title don't become two catalog rows.
 */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    year: smallint("year"),
    runtimeMinutes: integer("runtime_minutes"),
    pageCount: integer("page_count"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("catalog_items_group_kind_title_unique").on(table.groupId, table.kind, table.normalizedTitle),
    unique("catalog_items_id_group_unique").on(table.id, table.groupId),
    index("catalog_items_group_kind_idx").on(table.groupId, table.kind),
    check("catalog_items_kind_check", sql`${table.kind} in ('film', 'book', 'other')`),
    check("catalog_items_title_check", sql`char_length(btrim(${table.title})) between 1 and 300`),
    check("catalog_items_normalized_title_check", sql`char_length(${table.normalizedTitle}) between 1 and 300`),
    check("catalog_items_year_check", sql`${table.year} is null or ${table.year} between 1870 and 2200`),
    check("catalog_items_runtime_check", sql`${table.runtimeMinutes} is null or ${table.runtimeMinutes} between 1 and 100000`),
    check("catalog_items_pages_check", sql`${table.pageCount} is null or ${table.pageCount} between 1 and 1000000`),
  ],
);

export const catalogTags = pgTable(
  "catalog_tags",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("catalog_tags_group_kind_label_unique").on(table.groupId, table.kind, table.normalizedLabel),
    check("catalog_tags_kind_check", sql`${table.kind} in ('genre', 'decade', 'mood', 'other')`),
    check("catalog_tags_label_check", sql`char_length(btrim(${table.label})) between 1 and 80`),
    check("catalog_tags_normalized_label_check", sql`char_length(${table.normalizedLabel}) between 1 and 80`),
  ],
);

export const catalogItemTags = pgTable(
  "catalog_item_tags",
  {
    catalogItemId: text("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => catalogTags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ name: "catalog_item_tags_pk", columns: [table.catalogItemId, table.tagId] }),
    index("catalog_item_tags_tag_idx").on(table.tagId),
  ],
);
