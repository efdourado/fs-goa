-- A challenge item linked to the catalogue carries the catalogue item's name, so it takes as long a name as
-- the catalogue does (300). Copies left behind by earlier renames then catch up once, and from now on a
-- rename on either side reaches both.
ALTER TABLE "challenge_items" DROP CONSTRAINT IF EXISTS "challenge_items_title_check";
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 300);
--> statement-breakpoint
UPDATE "challenge_items" AS i
   SET "title" = c."title", "updated_at" = now()
  FROM "catalog_items" AS c
 WHERE i."catalog_item_id" = c."id" AND i."title" IS DISTINCT FROM c."title";
