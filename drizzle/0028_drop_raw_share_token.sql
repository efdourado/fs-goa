-- The public showcase link is a bearer token: keep only its hash in the row.
-- The full token is returned once, at publish time, and never persisted.
ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "challenges_result_share_token_check";--> statement-breakpoint
ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "challenges_result_share_pairing_check";--> statement-breakpoint
ALTER TABLE "challenges" DROP COLUMN IF EXISTS "result_share_token";
