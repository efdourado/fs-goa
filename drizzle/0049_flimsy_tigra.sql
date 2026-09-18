-- A challenge's libraries are now stored (challenge_libraries) instead of being inferred
-- from whichever items exist, so one challenge can combine several libraries.
CREATE TABLE "challenge_libraries" (
	"challenge_id" text NOT NULL,
	"group_id" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_libraries_pk" PRIMARY KEY("challenge_id","kind"),
	CONSTRAINT "challenge_libraries_position_check" CHECK ("challenge_libraries"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "challenge_libraries" ADD CONSTRAINT "challenge_libraries_challenge_fk" FOREIGN KEY ("challenge_id","group_id") REFERENCES "public"."challenges"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_libraries" ADD CONSTRAINT "challenge_libraries_library_fk" FOREIGN KEY ("group_id","kind") REFERENCES "public"."catalog_libraries"("group_id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challenge_libraries_library_idx" ON "challenge_libraries" USING btree ("group_id","kind");
--> statement-breakpoint
-- Existing challenges: every library their items already come from, in first-item order.
INSERT INTO "challenge_libraries" ("challenge_id", "group_id", "kind", "position")
SELECT f.challenge_id, f.group_id, f.kind,
       (row_number() OVER (PARTITION BY f.challenge_id ORDER BY f.first_position, f.kind) - 1)::integer
  FROM (
    SELECT it.challenge_id, c.group_id, ci.kind, min(it.position) AS first_position
      FROM "challenge_items" it
      JOIN "catalog_items" ci ON ci.id = it.catalog_item_id
      JOIN "challenges" c ON c.id = it.challenge_id
     GROUP BY it.challenge_id, c.group_id, ci.kind
  ) f;
--> statement-breakpoint
-- Existing challenges with no items yet: the film/book library their recipe tracks, when it exists.
INSERT INTO "challenge_libraries" ("challenge_id", "group_id", "kind", "position")
SELECT c.id, c.group_id, k.kind, 0
  FROM "challenges" c
  JOIN (VALUES ('cinema', 'film'), ('cine_free', 'film'), ('cine_curated', 'film'),
               ('library', 'book'), ('bookshelf', 'book'), ('reading_club', 'book'), ('reading_daily', 'book'))
       AS k(recipe_key, kind) ON k.recipe_key = c.recipe_key
  JOIN "catalog_libraries" cl ON cl.group_id = c.group_id AND cl.kind = k.kind
 WHERE NOT EXISTS (SELECT 1 FROM "challenge_libraries" x WHERE x.challenge_id = c.id);
