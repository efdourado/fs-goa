-- Per-person homepage organisation: a pin, a colour tag and a manual sort
-- position, private to each user. A missing row means "no preference".
-- Keyed by (user, challenge) like challenge_participants; both FKs cascade so
-- the row disappears with the challenge or the account.
CREATE TABLE "challenge_user_prefs" (
	"user_id" text NOT NULL,
	"challenge_id" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"color_tag" text,
	"sort_index" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_user_prefs_pk" PRIMARY KEY("user_id","challenge_id"),
	CONSTRAINT "challenge_user_prefs_color_tag_check" CHECK ("challenge_user_prefs"."color_tag" is null or "challenge_user_prefs"."color_tag" in ('green', 'blue', 'violet', 'coral', 'amber', 'rose'))
);
--> statement-breakpoint
ALTER TABLE "challenge_user_prefs" ADD CONSTRAINT "challenge_user_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_user_prefs" ADD CONSTRAINT "challenge_user_prefs_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challenge_user_prefs_pinned_idx" ON "challenge_user_prefs" USING btree ("user_id") WHERE "challenge_user_prefs"."pinned";
