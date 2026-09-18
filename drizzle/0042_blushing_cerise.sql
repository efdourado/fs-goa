-- Phase 1 of docs/flexible-catalogs.md: a workspace-scoped "library" layer on
-- top of the existing film/book/other catalog. Existing catalog_items and
-- catalog_attribute_defs keep their `kind` and every identity/data/challenge
-- link untouched; this only adds a library row alongside them and, once
-- backfilled below, a composite FK from their `(group_id, kind)` to
-- `catalog_libraries(group_id, kind)` in place of the old fixed 3-value CHECK.
-- `other` becomes a library like any other (source = 'custom') and, per the
-- companion identity-loosening change, stops silently merging same-title
-- items by year (its old dedup unique index is dropped below) — film/book
-- matching is completely unchanged.
CREATE TABLE "catalog_libraries" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"label" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_libraries_group_kind_unique" UNIQUE("group_id","kind"),
	CONSTRAINT "catalog_libraries_source_check" CHECK ("catalog_libraries"."source" in ('screens', 'pages', 'tables', 'custom')),
	CONSTRAINT "catalog_libraries_kind_check" CHECK ("catalog_libraries"."kind" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "catalog_libraries_label_check" CHECK ("catalog_libraries"."label" is null or char_length(btrim("catalog_libraries"."label")) between 1 and 80),
	CONSTRAINT "catalog_libraries_position_check" CHECK ("catalog_libraries"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_native_property_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"library_id" text NOT NULL,
	"property_key" text NOT NULL,
	"label" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_native_property_configs_library_key_unique" UNIQUE("library_id","property_key"),
	CONSTRAINT "catalog_native_property_configs_key_check" CHECK ("catalog_native_property_configs"."property_key" in ('title', 'year', 'main_genre', 'runtime_minutes', 'author', 'page_count')),
	CONSTRAINT "catalog_native_property_configs_label_check" CHECK ("catalog_native_property_configs"."label" is null or char_length(btrim("catalog_native_property_configs"."label")) between 1 and 80),
	CONSTRAINT "catalog_native_property_configs_title_visible_check" CHECK ("catalog_native_property_configs"."property_key" <> 'title' or "catalog_native_property_configs"."hidden" = false)
);
--> statement-breakpoint
ALTER TABLE "catalog_attribute_defs" DROP CONSTRAINT "catalog_attribute_defs_kind_check";--> statement-breakpoint
ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_items_kind_check";--> statement-breakpoint
DROP INDEX "catalog_items_group_other_title_year_uidx";--> statement-breakpoint
ALTER TABLE "catalog_libraries" ADD CONSTRAINT "catalog_libraries_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_libraries" ADD CONSTRAINT "catalog_libraries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- One library per (group, kind) already in use by an existing item or
-- attribute def, so the FKs added below never fail. `created_by_user_id` is
-- the workspace owner — nobody "created" this library, it already existed
-- implicitly. `label` stays null: the app shows the locale-aware default for
-- `source` until someone renames it.
INSERT INTO "catalog_libraries" ("id", "group_id", "kind", "source", "created_by_user_id")
SELECT gen_random_uuid()::text,
       used.group_id,
       used.kind,
       CASE used.kind WHEN 'film' THEN 'screens' WHEN 'book' THEN 'pages' ELSE 'custom' END,
       g.owner_user_id
  FROM (
         SELECT DISTINCT group_id, kind FROM "catalog_items"
         UNION
         SELECT DISTINCT group_id, kind FROM "catalog_attribute_defs"
       ) used
  JOIN "groups" g ON g.id = used.group_id
 ON CONFLICT ("group_id", "kind") DO NOTHING;--> statement-breakpoint
ALTER TABLE "catalog_native_property_configs" ADD CONSTRAINT "catalog_native_property_configs_library_id_catalog_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."catalog_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_libraries_group_position_idx" ON "catalog_libraries" USING btree ("group_id","position");--> statement-breakpoint
ALTER TABLE "catalog_attribute_defs" ADD CONSTRAINT "catalog_attribute_defs_library_fk" FOREIGN KEY ("group_id","kind") REFERENCES "public"."catalog_libraries"("group_id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_library_fk" FOREIGN KEY ("group_id","kind") REFERENCES "public"."catalog_libraries"("group_id","kind") ON DELETE restrict ON UPDATE no action;