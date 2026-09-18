-- Phase 6 of docs/flexible-catalogs.md: a reusable, workspace-scoped external
-- recommender ("Ana from work") alongside the existing member/origin-note
-- pair, on both catalog_items (new — how an item entered the library) and
-- challenge_items (existing, now with a third option and a real exclusivity
-- CHECK instead of app-only enforcement). Verified no existing row violates
-- it before adding.
CREATE TABLE "catalog_recommenders" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"display_name" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_recommenders_id_group_unique" UNIQUE("id","group_id"),
	CONSTRAINT "catalog_recommenders_name_check" CHECK (char_length(btrim("catalog_recommenders"."display_name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "recommended_by_user_id" text;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "recommended_by_external_id" text;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "origin_note" text;--> statement-breakpoint
ALTER TABLE "challenge_items" ADD COLUMN "recommended_by_external_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "recommendations_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_recommenders" ADD CONSTRAINT "catalog_recommenders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_recommenders" ADD CONSTRAINT "catalog_recommenders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_recommenders_group_idx" ON "catalog_recommenders" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_recommended_by_user_id_users_id_fk" FOREIGN KEY ("recommended_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_recommender_scope_fk" FOREIGN KEY ("recommended_by_external_id","group_id") REFERENCES "public"."catalog_recommenders"("id","group_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_recommended_by_external_id_catalog_recommenders_id_fk" FOREIGN KEY ("recommended_by_external_id") REFERENCES "public"."catalog_recommenders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_recommender_exclusive_check" CHECK (num_nonnulls("catalog_items"."recommended_by_user_id", "catalog_items"."recommended_by_external_id", "catalog_items"."origin_note") <= 1);--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_origin_note_check" CHECK ("catalog_items"."origin_note" is null or char_length(btrim("catalog_items"."origin_note")) between 1 and 200);--> statement-breakpoint
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_recommender_exclusive_check" CHECK (num_nonnulls("challenge_items"."recommended_by_user_id", "challenge_items"."recommended_by_external_id", "challenge_items"."origin_note") <= 1);