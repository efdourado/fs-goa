-- An admin can ban a member: removed, their content erased, and no invite brings them back until unbanned.
ALTER TABLE "group_members" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "banned_by_user_id" text;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_banned_by_user_id_users_id_fk" FOREIGN KEY ("banned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;