-- Books that older versions filed under the film library (Screens). Before an Estante item added
-- later entered as a book, its catalogue item was saved as a film — and nothing showed it until
-- a challenge listed its libraries. An item that only book challenges (Estante, Clube de Leitura)
-- use belongs to Pages. Anything ambiguous is left alone: an item also used by a film challenge, one that
-- carries custom properties of the film library, or one whose title and author already exist as a book.
INSERT INTO "catalog_libraries" ("id", "group_id", "kind", "source", "created_by_user_id")
SELECT gen_random_uuid()::text, g.id, 'book', 'pages', g.owner_user_id
  FROM "groups" g
 WHERE EXISTS (
         SELECT 1 FROM "catalog_items" ci
          WHERE ci.group_id = g.id AND ci.kind = 'film' AND ci.archived_at IS NULL
            AND ci.author IS NOT NULL
       )
ON CONFLICT ("group_id", "kind") DO NOTHING;
--> statement-breakpoint
UPDATE "catalog_items" ci
   SET "kind" = 'book', "updated_at" = now()
 WHERE ci."kind" = 'film'
   AND ci."archived_at" IS NULL
   AND EXISTS (SELECT 1 FROM "challenge_items" it WHERE it.catalog_item_id = ci.id)
   AND NOT EXISTS (
         SELECT 1 FROM "challenge_items" it
           JOIN "challenges" c ON c.id = it.challenge_id
          WHERE it.catalog_item_id = ci.id
            AND NOT (coalesce(c.recipe_key, '') = ANY (ARRAY['bookshelf', 'library', 'reading_club', 'reading_daily']))
       )
   AND NOT EXISTS (SELECT 1 FROM "catalog_attribute_values" v WHERE v.catalog_item_id = ci.id)
   AND NOT EXISTS (
         SELECT 1 FROM "catalog_items" b
          WHERE b.group_id = ci.group_id AND b.kind = 'book' AND b.archived_at IS NULL
            AND b.normalized_title = ci.normalized_title
            AND lower(regexp_replace(btrim(coalesce(b.author, '')), '\s+', ' ', 'g'))
              = lower(regexp_replace(btrim(coalesce(ci.author, '')), '\s+', ' ', 'g'))
       );
--> statement-breakpoint
-- A book challenge now holding books is linked to Pages ...
INSERT INTO "challenge_libraries" ("challenge_id", "group_id", "kind", "position")
SELECT f.challenge_id, f.group_id, 'book',
       coalesce((SELECT max(x.position) + 1 FROM "challenge_libraries" x WHERE x.challenge_id = f.challenge_id), 0)
  FROM (
         SELECT DISTINCT c.id AS challenge_id, c.group_id
           FROM "challenges" c
           JOIN "challenge_items" it ON it.challenge_id = c.id AND it.archived_at IS NULL
           JOIN "catalog_items" ci ON ci.id = it.catalog_item_id AND ci.kind = 'book'
          WHERE c.recipe_key = ANY (ARRAY['bookshelf', 'library', 'reading_club', 'reading_daily'])
       ) f
 WHERE NOT EXISTS (SELECT 1 FROM "challenge_libraries" x WHERE x.challenge_id = f.challenge_id AND x.kind = 'book')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- ... and no longer to Screens once nothing in it comes from there.
DELETE FROM "challenge_libraries" cl
 USING "challenges" c
 WHERE c.id = cl.challenge_id
   AND cl.kind = 'film'
   AND c.recipe_key = ANY (ARRAY['bookshelf', 'library', 'reading_club', 'reading_daily'])
   AND NOT EXISTS (
         SELECT 1 FROM "challenge_items" it
           JOIN "catalog_items" ci ON ci.id = it.catalog_item_id
          WHERE it.challenge_id = cl.challenge_id AND it.archived_at IS NULL AND ci.kind = 'film'
       );
