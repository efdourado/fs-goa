-- The per-item goal date added in 0019 is dropped: a challenge no longer needs
-- a mandatory period, and a soft per-item date turned out to be noise. Undated
-- challenges (habit lists, personal reading logs) are first-class again.
DROP INDEX IF EXISTS "challenge_items_target_date_idx";--> statement-breakpoint
ALTER TABLE "challenge_items" DROP COLUMN IF EXISTS "target_date";
