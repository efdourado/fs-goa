-- Coral (orange/red) and rose (pink) leave Home's colour tags: whoever picked them gets no tag.
UPDATE "challenge_user_prefs" SET "color_tag" = NULL, "updated_at" = now() WHERE "color_tag" IN ('coral', 'rose');--> statement-breakpoint
ALTER TABLE "challenge_user_prefs" DROP CONSTRAINT "challenge_user_prefs_color_tag_check";--> statement-breakpoint
ALTER TABLE "challenge_user_prefs" ADD CONSTRAINT "challenge_user_prefs_color_tag_check" CHECK ("challenge_user_prefs"."color_tag" is null or "challenge_user_prefs"."color_tag" in ('green', 'blue', 'violet', 'amber'));
