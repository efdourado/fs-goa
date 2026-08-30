CREATE TABLE "group_member_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"invited_by_user_id" text,
	"role" text DEFAULT 'participant' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "group_member_requests_role_check" CHECK ("group_member_requests"."role" in ('admin', 'participant')),
	CONSTRAINT "group_member_requests_status_check" CHECK ("group_member_requests"."status" in ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "group_member_requests_responded_check" CHECK ("group_member_requests"."status" = 'pending' or "group_member_requests"."responded_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "group_member_requests" ADD CONSTRAINT "group_member_requests_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member_requests" ADD CONSTRAINT "group_member_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member_requests" ADD CONSTRAINT "group_member_requests_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_member_requests_one_pending_uidx" ON "group_member_requests" USING btree ("group_id","user_id") WHERE "group_member_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "group_member_requests_user_status_idx" ON "group_member_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "group_member_requests_group_status_idx" ON "group_member_requests" USING btree ("group_id","status");