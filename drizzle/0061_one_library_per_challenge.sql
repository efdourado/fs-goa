-- One library per challenge. A stray extra link with no items behind it (left by an early version) is dropped
-- first, keeping the library the challenge's items come from (or its first link when it has none).
DELETE FROM "challenge_libraries" x
 WHERE EXISTS (SELECT 1 FROM "challenge_libraries" o WHERE o.challenge_id = x.challenge_id AND o.kind <> x.kind)
   AND NOT EXISTS (SELECT 1 FROM "challenge_items" it JOIN "catalog_items" ci ON ci.id = it.catalog_item_id
                    WHERE it.challenge_id = x.challenge_id AND ci.kind = x.kind)
   AND x.kind <> (SELECT o.kind FROM "challenge_libraries" o WHERE o.challenge_id = x.challenge_id
                   ORDER BY EXISTS (SELECT 1 FROM "challenge_items" it JOIN "catalog_items" ci ON ci.id = it.catalog_item_id
                                     WHERE it.challenge_id = o.challenge_id AND ci.kind = o.kind) DESC, o.position, o.kind
                   LIMIT 1);--> statement-breakpoint
ALTER TABLE "challenge_libraries" ADD CONSTRAINT "challenge_libraries_one_per_challenge" UNIQUE("challenge_id");