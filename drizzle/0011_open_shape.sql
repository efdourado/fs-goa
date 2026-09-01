ALTER TABLE "entries" DROP CONSTRAINT "entries_item_challenge_type_fk";--> statement-breakpoint
ALTER TABLE "challenge_items" DROP CONSTRAINT "challenge_items_id_challenge_type_unique";--> statement-breakpoint
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_id_challenge_unique" UNIQUE("id","challenge_id");--> statement-breakpoint
ALTER TABLE "challenge_items" ALTER COLUMN "entry_type_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_item_challenge_fk" FOREIGN KEY ("item_id","challenge_id") REFERENCES "public"."challenge_items"("id","challenge_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP INDEX "entries_one_active_item_response_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_item_response_uidx" ON "entries" USING btree ("item_id","entry_type_id","participant_user_id") WHERE "entries"."item_id" is not null and "entries"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_items_group_kind_title_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_group_kind_title_year_uidx" ON "catalog_items" USING btree ("group_id","kind","normalized_title",coalesce("year", -1));
