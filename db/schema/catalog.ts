import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
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
