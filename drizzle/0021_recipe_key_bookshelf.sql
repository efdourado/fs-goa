-- The "Estante" recipe (rate a list of books, no pages, no period) needs its own
-- recipe_key. Widen the CHECK to allow 'bookshelf'.
ALTER TABLE "challenges" DROP CONSTRAINT "challenges_recipe_key_check";--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_recipe_key_check" CHECK ("challenges"."recipe_key" is null or "challenges"."recipe_key" in ('cinema', 'library', 'bookshelf', 'cine_free', 'cine_curated', 'reading_club', 'reading_daily'));
