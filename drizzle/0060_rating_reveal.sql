ALTER TABLE "entry_types" DROP CONSTRAINT "entry_types_visibility_policy_check";--> statement-breakpoint
ALTER TABLE "challenge_items" ADD COLUMN "revealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "challenge_items" ADD COLUMN "revealed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_revealed_by_user_id_users_id_fk" FOREIGN KEY ("revealed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_visibility_policy_check" CHECK ("entry_types"."visibility_policy" in ('group_realtime', 'after_own', 'after_close', 'author_only', 'until_reveal'));