-- The "Hábito" recipe: a personalized daily check-in with no catalog at all
-- (no film, no book) — the fields and metrics are entirely up to whoever builds
-- it. Widen the CHECK to allow 'habit'.
ALTER TABLE "challenges" DROP CONSTRAINT "challenges_recipe_key_check";--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_recipe_key_check" CHECK ("challenges"."recipe_key" is null or "challenges"."recipe_key" in ('cinema', 'library', 'bookshelf', 'habit', 'cine_free', 'cine_curated', 'reading_club', 'reading_daily'));
