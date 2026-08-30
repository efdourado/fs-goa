CREATE TABLE "invite_challenge_targets" (
	"invite_id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"challenge_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_id_group_unique" UNIQUE("id","group_id");--> statement-breakpoint
ALTER TABLE "invite_challenge_targets" ADD CONSTRAINT "invite_challenge_targets_invite_group_fk" FOREIGN KEY ("invite_id","group_id") REFERENCES "public"."group_invites"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_challenge_targets" ADD CONSTRAINT "invite_challenge_targets_challenge_group_fk" FOREIGN KEY ("challenge_id","group_id") REFERENCES "public"."challenges"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_challenge_targets_challenge_idx" ON "invite_challenge_targets" USING btree ("challenge_id");
