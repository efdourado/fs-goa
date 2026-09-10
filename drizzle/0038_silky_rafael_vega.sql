-- Drop the separate template blurb: a template now shows the same showcase
-- summary (the text under the headline in the Vitrine tab), with the challenge
-- description as the fallback. Nothing reads template_summary any more.
ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "challenges_template_summary_check";--> statement-breakpoint
ALTER TABLE "challenges" DROP COLUMN IF EXISTS "template_summary";
