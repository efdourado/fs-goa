-- Phase 7 of docs/flexible-catalogs.md: `tables` is a ready-made challenge on a
-- Tables library (three 0-5 ratings + an optional comment).
ALTER TABLE "challenges" DROP CONSTRAINT "challenges_recipe_key_check";--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_recipe_key_check" CHECK ("challenges"."recipe_key" is null or "challenges"."recipe_key" in ('cinema', 'library', 'bookshelf', 'habit', 'custom', 'tables', 'cine_free', 'cine_curated', 'reading_club', 'reading_daily'));