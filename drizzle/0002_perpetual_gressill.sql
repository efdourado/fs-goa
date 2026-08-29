ALTER TABLE "challenges" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challenges_group_active_idx" ON "challenges" USING btree ("group_id") WHERE "challenges"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "groups_owner_active_idx" ON "groups" USING btree ("owner_user_id") WHERE "groups"."deleted_at" is null and "groups"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_deleted_at_check" CHECK ("challenges"."deleted_at" is null or "challenges"."deleted_at" >= "challenges"."created_at");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_deleted_at_check" CHECK ("groups"."deleted_at" is null or "groups"."deleted_at" >= "groups"."created_at");