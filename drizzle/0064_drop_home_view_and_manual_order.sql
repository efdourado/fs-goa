-- Home is no longer arranged by hand: one fixed separated view (your own challenges first), no saved view and no manual order.
ALTER TABLE "challenge_user_prefs" DROP COLUMN "sort_index";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_view";
