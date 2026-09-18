-- Phase 5 of docs/flexible-catalogs.md: an item's opens_at/due_at can now be
-- date-only, not just a precise instant. Existing rows default to 'datetime'
-- (unchanged display), and nothing about due_at ever blocking entries changes
-- — it never did (saveEntry doesn't read it).
ALTER TABLE "challenge_items" ADD COLUMN "schedule_precision" text DEFAULT 'datetime' NOT NULL;--> statement-breakpoint
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_schedule_precision_check" CHECK ("challenge_items"."schedule_precision" in ('date', 'datetime'));