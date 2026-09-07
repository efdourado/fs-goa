-- Reintroduces the raw public-showcase token dropped in 0028. The hash still
-- backs the /results/<token> lookup; the raw token lets the link be shown again
-- (admin + participants) instead of only once at publish time. Both columns are
-- written together on publish/rotate and cleared together on unpublish.
ALTER TABLE "challenges" ADD COLUMN "result_share_token" text;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_raw_share_token_check" CHECK ("challenges"."result_share_token" is null or ("challenges"."results_published_at" is not null and "challenges"."result_share_token" ~ '^[A-Za-z0-9_-]{43}$'));
