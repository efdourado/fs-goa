-- Home's colour tags are gone (a viewer only pins a challenge now): the colour column and its check go with them.
ALTER TABLE "challenge_user_prefs" DROP CONSTRAINT IF EXISTS "challenge_user_prefs_color_tag_check";--> statement-breakpoint
ALTER TABLE "challenge_user_prefs" DROP COLUMN IF EXISTS "color_tag";
