ALTER TABLE "challenges" ADD COLUMN "result_share_token" text;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "results_published_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_result_share_token_check" CHECK ("challenges"."result_share_token" is null or "challenges"."result_share_token" ~ '^[A-Za-z0-9_-]{43}$');--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_result_share_pairing_check" CHECK ("challenges"."result_share_token" is null or "challenges"."result_share_token_hash" is not null);