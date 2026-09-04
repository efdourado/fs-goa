import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
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
    // Books use author as part of identity; films leave it null. `year` remains
    // mutable metadata for either kind.
    author: text("author"),
    year: smallint("year"),
    // One primary classification, not an open-ended tag list. It is a scalar
    // label (so values such as "ficção científica" remain valid).
    mainGenre: text("main_genre"),
    pageCount: integer("page_count"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // A film/series is the same catalog object when its normalized title matches.
    // `year` is mutable metadata (the latest release/season), never identity.
    uniqueIndex("catalog_items_group_film_title_uidx")
      .on(table.groupId, table.normalizedTitle)
      .where(sql`${table.kind} = 'film' and ${table.archivedAt} is null`),
    // For books the author disambiguates equal titles. Case/outer whitespace are
    // presentation details and therefore do not split the identity.
    uniqueIndex("catalog_items_group_book_title_author_uidx")
      .on(
        table.groupId,
        table.normalizedTitle,
        sql`lower(regexp_replace(btrim(coalesce(${table.author}, '')), '\s+', ' ', 'g'))`,
      )
      .where(sql`${table.kind} = 'book' and ${table.archivedAt} is null`),
    // `other` is retained for legacy/custom structures and keeps the old year
    // disambiguation because no domain-specific identity is available for it.
    uniqueIndex("catalog_items_group_other_title_year_uidx").on(
      table.groupId,
      table.normalizedTitle,
      sql`coalesce(${table.year}, -1)`,
    ).where(sql`${table.kind} = 'other' and ${table.archivedAt} is null`),
    unique("catalog_items_id_group_unique").on(table.id, table.groupId),
    index("catalog_items_group_kind_idx").on(table.groupId, table.kind),
    check("catalog_items_kind_check", sql`${table.kind} in ('film', 'book', 'other')`),
    check("catalog_items_title_check", sql`char_length(btrim(${table.title})) between 1 and 300`),
    check(
      "catalog_items_author_check",
      sql`${table.author} is null or char_length(btrim(${table.author})) between 1 and 200`,
    ),
    check("catalog_items_normalized_title_check", sql`char_length(${table.normalizedTitle}) between 1 and 300`),
    check("catalog_items_year_check", sql`${table.year} is null or ${table.year} between 1870 and 2200`),
    check(
      "catalog_items_main_genre_check",
      sql`${table.mainGenre} is null or char_length(btrim(${table.mainGenre})) between 1 and 80`,
    ),
    check("catalog_items_pages_check", sql`${table.pageCount} is null or ${table.pageCount} between 1 and 1000000`),
  ],
);

/**
 * A group- (or personal-workspace-) defined catalog attribute: "diretor" on
 * films, "editora" on books, whatever a group actually wants to track instead
 * of the fixed year/genre/author/pages columns above. Same mold as
 * `challenge_fields` — named, typed, ordered, soft-archived, never a JSON blob.
 * Scoped per `(group_id, kind)`: a personal workspace's film attributes never
 * apply to a standard group's, and a group's film attributes never apply to
 * its books.
 */
export const catalogAttributeDefs = pgTable(
  "catalog_attribute_defs",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    semanticKey: text("semantic_key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    position: integer("position").notNull().default(0),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("catalog_attribute_defs_group_kind_key_unique").on(table.groupId, table.kind, table.semanticKey),
    unique("catalog_attribute_defs_id_group_unique").on(table.id, table.groupId),
    index("catalog_attribute_defs_order_idx").on(table.groupId, table.kind, table.position),
    check("catalog_attribute_defs_kind_check", sql`${table.kind} in ('film', 'book', 'other')`),
    check("catalog_attribute_defs_type_check", sql`${table.type} in ('text', 'number', 'date', 'boolean')`),
    check("catalog_attribute_defs_key_check", sql`${table.semanticKey} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check("catalog_attribute_defs_label_check", sql`char_length(btrim(${table.label})) between 1 and 80`),
    check("catalog_attribute_defs_position_check", sql`${table.position} >= 0`),
  ],
);

/** One typed value of one attribute on one catalog item — exactly one column set, like `entry_values`. */
export const catalogAttributeValues = pgTable(
  "catalog_attribute_values",
  {
    catalogItemId: text("catalog_item_id").notNull(),
    attributeDefId: text("attribute_def_id").notNull(),
    groupId: text("group_id").notNull(),
    textValue: text("text_value"),
    numberValue: integer("number_value"),
    dateValue: date("date_value", { mode: "string" }),
    booleanValue: boolean("boolean_value"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: "catalog_attribute_values_pk", columns: [table.catalogItemId, table.attributeDefId] }),
    foreignKey({
      name: "catalog_attribute_values_item_scope_fk",
      columns: [table.catalogItemId, table.groupId],
      foreignColumns: [catalogItems.id, catalogItems.groupId],
    }).onDelete("cascade"),
    foreignKey({
      name: "catalog_attribute_values_def_scope_fk",
      columns: [table.attributeDefId, table.groupId],
      foreignColumns: [catalogAttributeDefs.id, catalogAttributeDefs.groupId],
    }).onDelete("restrict"),
    check(
      "catalog_attribute_values_exactly_one_check",
      sql`num_nonnulls(${table.textValue}, ${table.numberValue}, ${table.dateValue}, ${table.booleanValue}) = 1`,
    ),
  ],
);
