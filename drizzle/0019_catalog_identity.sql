-- A soft, date-only goal for a round item, always inside the challenge period.
-- It helps organize batches ("the first four films in week one") and never
-- blocks a log.
ALTER TABLE "challenge_items" ADD COLUMN "target_date" date;--> statement-breakpoint
CREATE INDEX "challenge_items_target_date_idx" ON "challenge_items" USING btree ("challenge_id","target_date");--> statement-breakpoint

ALTER TABLE "catalog_items" ADD COLUMN "main_genre" text;--> statement-breakpoint

-- The old model had no notion of a primary genre. Keep one deterministic value
-- (alphabetically by its normalized label) before removing the tag subsystem.
UPDATE "catalog_items" AS ci
   SET "main_genre" = picked.label,
       "updated_at" = now()
  FROM (
    SELECT DISTINCT ON (cit."catalog_item_id")
           cit."catalog_item_id", btrim(ct."label") AS label
      FROM "catalog_item_tags" AS cit
      JOIN "catalog_tags" AS ct ON ct."id" = cit."tag_id"
     WHERE ct."kind" = 'genre'
     ORDER BY cit."catalog_item_id", ct."normalized_label", ct."id"
  ) AS picked
 WHERE ci."id" = picked."catalog_item_id";--> statement-breakpoint

DROP TABLE "catalog_item_tags";--> statement-breakpoint
DROP TABLE "catalog_tags";--> statement-breakpoint

ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_items_runtime_check";--> statement-breakpoint
ALTER TABLE "catalog_items" DROP COLUMN "runtime_minutes";--> statement-breakpoint
DROP INDEX "catalog_items_group_kind_title_year_uidx";--> statement-breakpoint

-- Films and series are identified by normalized title. Consolidate pre-existing
-- year variants into the oldest row, advance `year` to the latest known release,
-- and repoint every round before deleting duplicates.
WITH ranked AS (
  SELECT ci."id",
         first_value(ci."id") OVER (
           PARTITION BY ci."group_id", ci."normalized_title"
           ORDER BY ci."created_at", ci."id"
         ) AS canonical_id
    FROM "catalog_items" AS ci
   WHERE ci."kind" = 'film' AND ci."archived_at" IS NULL
)
UPDATE "challenge_items" AS item
   SET "catalog_item_id" = ranked.canonical_id,
       "updated_at" = now()
  FROM ranked
 WHERE item."catalog_item_id" = ranked."id"
   AND ranked."id" <> ranked.canonical_id;--> statement-breakpoint

WITH ranked AS (
  SELECT ci.*,
         first_value(ci."id") OVER (
           PARTITION BY ci."group_id", ci."normalized_title"
           ORDER BY ci."created_at", ci."id"
         ) AS canonical_id
    FROM "catalog_items" AS ci
   WHERE ci."kind" = 'film' AND ci."archived_at" IS NULL
), merged AS (
  SELECT canonical_id,
         max("year") AS latest_year,
         (array_agg("main_genre" ORDER BY ("id" = canonical_id) DESC, "created_at", "id")
           FILTER (WHERE "main_genre" IS NOT NULL))[1] AS main_genre,
         (array_agg("page_count" ORDER BY ("id" = canonical_id) DESC, "created_at", "id")
           FILTER (WHERE "page_count" IS NOT NULL))[1] AS page_count
    FROM ranked
   GROUP BY canonical_id
)
UPDATE "catalog_items" AS ci
   SET "year" = merged.latest_year,
       "main_genre" = coalesce(ci."main_genre", merged.main_genre),
       "page_count" = coalesce(ci."page_count", merged.page_count),
       "updated_at" = now()
  FROM merged
 WHERE ci."id" = merged.canonical_id;--> statement-breakpoint

WITH ranked AS (
  SELECT ci."id",
         first_value(ci."id") OVER (
           PARTITION BY ci."group_id", ci."normalized_title"
           ORDER BY ci."created_at", ci."id"
         ) AS canonical_id
    FROM "catalog_items" AS ci
   WHERE ci."kind" = 'film' AND ci."archived_at" IS NULL
)
DELETE FROM "catalog_items" AS ci
 USING ranked
 WHERE ci."id" = ranked."id" AND ranked."id" <> ranked.canonical_id;--> statement-breakpoint

-- Books use normalized title + normalized author. This merges different-edition
-- years of the same work but keeps equal titles by different authors separate.
WITH ranked AS (
  SELECT ci."id",
         first_value(ci."id") OVER (
           PARTITION BY ci."group_id", ci."normalized_title",
             lower(regexp_replace(btrim(coalesce(ci."author", '')), '\s+', ' ', 'g'))
           ORDER BY ci."created_at", ci."id"
         ) AS canonical_id
    FROM "catalog_items" AS ci
   WHERE ci."kind" = 'book' AND ci."archived_at" IS NULL
)
UPDATE "challenge_items" AS item
   SET "catalog_item_id" = ranked.canonical_id,
       "updated_at" = now()
  FROM ranked
 WHERE item."catalog_item_id" = ranked."id"
   AND ranked."id" <> ranked.canonical_id;--> statement-breakpoint

WITH ranked AS (
  SELECT ci.*,
         first_value(ci."id") OVER (
           PARTITION BY ci."group_id", ci."normalized_title",
             lower(regexp_replace(btrim(coalesce(ci."author", '')), '\s+', ' ', 'g'))
           ORDER BY ci."created_at", ci."id"
         ) AS canonical_id
    FROM "catalog_items" AS ci
   WHERE ci."kind" = 'book' AND ci."archived_at" IS NULL
), merged AS (
  SELECT canonical_id,
         min("year") AS publication_year,
         (array_agg("main_genre" ORDER BY ("id" = canonical_id) DESC, "created_at", "id")
           FILTER (WHERE "main_genre" IS NOT NULL))[1] AS main_genre,
         (array_agg("page_count" ORDER BY ("id" = canonical_id) DESC, "created_at", "id")
           FILTER (WHERE "page_count" IS NOT NULL))[1] AS page_count
    FROM ranked
   GROUP BY canonical_id
)
UPDATE "catalog_items" AS ci
   SET "year" = merged.publication_year,
       "main_genre" = coalesce(ci."main_genre", merged.main_genre),
       "page_count" = coalesce(ci."page_count", merged.page_count),
       "updated_at" = now()
  FROM merged
 WHERE ci."id" = merged.canonical_id;--> statement-breakpoint

WITH ranked AS (
  SELECT ci."id",
         first_value(ci."id") OVER (
           PARTITION BY ci."group_id", ci."normalized_title",
             lower(regexp_replace(btrim(coalesce(ci."author", '')), '\s+', ' ', 'g'))
           ORDER BY ci."created_at", ci."id"
         ) AS canonical_id
    FROM "catalog_items" AS ci
   WHERE ci."kind" = 'book' AND ci."archived_at" IS NULL
)
DELETE FROM "catalog_items" AS ci
 USING ranked
 WHERE ci."id" = ranked."id" AND ranked."id" <> ranked.canonical_id;--> statement-breakpoint

CREATE UNIQUE INDEX "catalog_items_group_film_title_uidx"
  ON "catalog_items" USING btree ("group_id","normalized_title")
  WHERE "catalog_items"."kind" = 'film' and "catalog_items"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_group_book_title_author_uidx"
  ON "catalog_items" USING btree (
    "group_id","normalized_title",
    lower(regexp_replace(btrim(coalesce("author", '')), '\s+', ' ', 'g'))
  ) WHERE "catalog_items"."kind" = 'book' and "catalog_items"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_group_other_title_year_uidx"
  ON "catalog_items" USING btree ("group_id","normalized_title",coalesce("year", -1))
  WHERE "catalog_items"."kind" = 'other' and "catalog_items"."archived_at" is null;--> statement-breakpoint

ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_main_genre_check"
  CHECK ("catalog_items"."main_genre" is null or char_length(btrim("catalog_items"."main_genre")) between 1 and 80);--> statement-breakpoint

ALTER TABLE "challenges" DROP CONSTRAINT "challenges_recipe_key_check";--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_recipe_key_check"
  CHECK ("challenges"."recipe_key" is null or "challenges"."recipe_key" in ('cinema', 'library', 'cine_free', 'cine_curated', 'reading_club', 'reading_daily'));
