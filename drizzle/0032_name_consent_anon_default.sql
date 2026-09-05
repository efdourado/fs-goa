-- V1 §12: publication is anonymous by default, and each participant separately
-- authorises their name in an external showcase (starts unchecked, revocable).
ALTER TABLE "challenge_participants" ADD COLUMN "name_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ALTER COLUMN "results_anon" SET DEFAULT true;--> statement-breakpoint
-- Bring not-yet-published challenges to the new default; leave published ones on
-- whatever the admin already chose.
UPDATE "challenges" SET "results_anon" = true WHERE "results_published_at" IS NULL AND "results_anon" = false;
