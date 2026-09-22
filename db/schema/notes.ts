import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { users } from "./accounts";
import { timestamptz } from "./columns";

/**
 * A private note in the person's own space — nothing to do with a group or a challenge (on purpose, for
 * now: this is a plainer, faster place to jot something down, not another layer of the round model). Two
 * kinds share one row: `text` renders `body` with the same quote/divider syntax as a Vitrine comment;
 * `checklist` ignores `body` and keeps its rows in `items` — small and personal enough that a jsonb array
 * beats a second table. Soft-deleted like everything else the person owns, with no separate bin screen yet.
 */
export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    colorTag: text("color_tag"),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    deletedAt: timestamptz("deleted_at"),
  },
  (table) => [
    index("notes_user_idx").on(table.userId, table.deletedAt, table.pinned),
    check("notes_kind_check", sql`${table.kind} in ('text', 'checklist')`),
    check("notes_title_check", sql`char_length(btrim(${table.title})) between 1 and 160`),
    check("notes_body_check", sql`${table.body} is null or char_length(${table.body}) <= 20000`),
    check("notes_items_array_check", sql`jsonb_typeof(${table.items}) = 'array'`),
    check(
      "notes_color_tag_check",
      sql`${table.colorTag} is null or ${table.colorTag} in ('green', 'blue', 'violet', 'coral', 'amber', 'rose')`,
    ),
  ],
);
