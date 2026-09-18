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
 * A workspace-defined library within the catalog: Screens/Pages are the
 * evolution of the original film/book catalog (`kind` stays exactly `'film'`/
 * `'book'` — nothing about their identity changes), Tables and further
 * libraries are created from now on with an opaque generated `kind`. `kind` is
 * the stable internal identity `catalog_items.kind` / `catalog_attribute_defs.kind`
 * point at; `label` is the user-facing, renamable display name. Renaming never
 * touches `kind`, so it never affects identity, metrics, or another
 * workspace's library of the same starting kind.
 */
export const catalogLibraries = pgTable(
  "catalog_libraries",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    // Which starting configuration this library began as. Presentation/defaults
    // only (About page copy, which properties get seeded at creation, the
    // locale-aware default label) — never used to gate behavior. Behavior
    // gates on `kind === 'film' | 'book'` or on actual property capability,
    // never on `source` or `label`.
    source: text("source").notNull(),
    // `null` = show the locale-aware default name for `source` (so a freshly
    // migrated or freshly created library reads correctly in every language
    // without a stored, frozen-in-one-language string). Set only once someone
    // actually renames it.
    label: text("label"),
    position: integer("position").notNull().default(0),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("catalog_libraries_group_kind_unique").on(table.groupId, table.kind),
    index("catalog_libraries_group_position_idx").on(table.groupId, table.position),
    check("catalog_libraries_source_check", sql`${table.source} in ('screens', 'pages', 'tables', 'custom')`),
    check("catalog_libraries_kind_check", sql`${table.kind} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check(
      "catalog_libraries_label_check",
      sql`${table.label} is null or char_length(btrim(${table.label})) between 1 and 80`,
    ),
    check("catalog_libraries_position_check", sql`${table.position} >= 0`),
  ],
);

/**
 * Overrides a native `catalog_items` column's label/visibility for one library
 * without moving its value: renaming or hiding `year` through the same editor
 * as a custom attribute never touches the `year` column itself. A property
 * with no row here uses its hardcoded i18n default label, is visible, and
 * sorts by the hardcoded default order — this table holds only overrides, so
 * migration creates zero rows. `title` can never be hidden (checked below):
 * every item needs a name, even if its label is customized.
 */
export const catalogNativePropertyConfigs = pgTable(
  "catalog_native_property_configs",
  {
    id: text("id").primaryKey(),
    libraryId: text("library_id")
      .notNull()
      .references(() => catalogLibraries.id, { onDelete: "cascade" }),
    propertyKey: text("property_key").notNull(),
    label: text("label"),
    hidden: boolean("hidden").notNull().default(false),
    position: integer("position"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("catalog_native_property_configs_library_key_unique").on(table.libraryId, table.propertyKey),
    check(
      "catalog_native_property_configs_key_check",
      sql`${table.propertyKey} in ('title', 'year', 'main_genre', 'runtime_minutes', 'author', 'page_count')`,
    ),
    check(
      "catalog_native_property_configs_label_check",
      sql`${table.label} is null or char_length(btrim(${table.label})) between 1 and 80`,
    ),
    check("catalog_native_property_configs_title_visible_check", sql`${table.propertyKey} <> 'title' or ${table.hidden} = false`),
  ],
);

/**
 * A reusable, non-account name for someone outside Goa who recommended an
 * item — "Ana from work". Scoped per workspace like `catalog_libraries`: a
 * name saved in one personal space or group never appears in another, and it
 * never auto-links to a real account even if a name matches (Phase 6 of
 * docs/flexible-catalogs.md).
 */
export const catalogRecommenders = pgTable(
  "catalog_recommenders",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("catalog_recommenders_id_group_unique").on(table.id, table.groupId),
    index("catalog_recommenders_group_idx").on(table.groupId),
    check("catalog_recommenders_name_check", sql`char_length(btrim(${table.displayName})) between 1 and 80`),
  ],
);

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
    // Films/series only — books use `pageCount` instead.
    runtimeMinutes: integer("runtime_minutes"),
    // How this item entered the library — independent of any challenge-
    // specific recommendation on `challenge_items` (Phase 6): a catalog-level
    // pick and a round's own pick are different assignments, and setting one
    // never silently overwrites the other. At most one of the three is set.
    recommendedByUserId: text("recommended_by_user_id").references(() => users.id, { onDelete: "set null" }),
    recommendedByExternalId: text("recommended_by_external_id"),
    originNote: text("origin_note"),
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
    // Every other kind (including the legacy `other`, now a library like any
    // other) has no title-based identity: a title match is only ever a
    // suggestion the person explicitly accepts or declines (see
    // `findPossibleCatalogItemMatches`/`createCatalogItem` in
    // `lib/goa/catalog.ts`), never a merge key enforced here.
    unique("catalog_items_id_group_unique").on(table.id, table.groupId),
    index("catalog_items_group_kind_idx").on(table.groupId, table.kind),
    foreignKey({
      name: "catalog_items_library_fk",
      columns: [table.groupId, table.kind],
      foreignColumns: [catalogLibraries.groupId, catalogLibraries.kind],
    }).onDelete("restrict"),
    foreignKey({
      name: "catalog_items_recommender_scope_fk",
      columns: [table.recommendedByExternalId, table.groupId],
      foreignColumns: [catalogRecommenders.id, catalogRecommenders.groupId],
    }).onDelete("set null"),
    check(
      "catalog_items_recommender_exclusive_check",
      sql`num_nonnulls(${table.recommendedByUserId}, ${table.recommendedByExternalId}, ${table.originNote}) <= 1`,
    ),
    check(
      "catalog_items_origin_note_check",
      sql`${table.originNote} is null or char_length(btrim(${table.originNote})) between 1 and 200`,
    ),
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
    // Hides the property from normal item forms and displays while keeping
    // every stored value — same meaning as
    // `catalog_native_property_configs.hidden`. Archiving, by contrast, is
    // refused once a value exists.
    hidden: boolean("hidden").notNull().default(false),
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
    foreignKey({
      name: "catalog_attribute_defs_library_fk",
      columns: [table.groupId, table.kind],
      foreignColumns: [catalogLibraries.groupId, catalogLibraries.kind],
    }).onDelete("restrict"),
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
