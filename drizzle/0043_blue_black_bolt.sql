-- Phase 3 of docs/flexible-catalogs.md: a `custom` recipe builds a challenge on
-- one of the workspace's own libraries instead of the fixed film/book catalog.
ALTER TABLE "challenges" DROP CONSTRAINT "challenges_recipe_key_check";--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_recipe_key_check" CHECK ("challenges"."recipe_key" is null or "challenges"."recipe_key" in ('cinema', 'library', 'bookshelf', 'habit', 'custom', 'cine_free', 'cine_curated', 'reading_club', 'reading_daily'));