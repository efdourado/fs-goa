ALTER TABLE "challenges" DROP CONSTRAINT "challenges_meeting_url_check";--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "author" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "kind" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_one_personal_per_owner_uidx" ON "groups" USING btree ("owner_user_id") WHERE "groups"."kind" = 'personal' and "groups"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "challenges" DROP COLUMN "meeting_url";--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_author_check" CHECK ("catalog_items"."author" is null or char_length(btrim("catalog_items"."author")) between 1 and 200);--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_kind_check" CHECK ("groups"."kind" in ('standard', 'personal'));