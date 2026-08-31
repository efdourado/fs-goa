CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"route" text,
	"app_version" text,
	"locale" text,
	"template_kind" text,
	"user_role" text,
	"form_version" smallint DEFAULT 1 NOT NULL,
	"area" text NOT NULL,
	"goal" text NOT NULL,
	"succeeded" boolean,
	"ease" smallint,
	"friction" text,
	"impact" text NOT NULL,
	"workaround" text,
	"wish" text,
	"contact_email" text,
	"contact_ok" boolean DEFAULT false NOT NULL,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_area_check" CHECK (char_length(btrim("feedback"."area")) between 1 and 400),
	CONSTRAINT "feedback_goal_check" CHECK (char_length(btrim("feedback"."goal")) between 1 and 400),
	CONSTRAINT "feedback_ease_check" CHECK ("feedback"."ease" is null or "feedback"."ease" between 1 and 5),
	CONSTRAINT "feedback_impact_check" CHECK ("feedback"."impact" in ('blocked', 'effort', 'minor', 'idea')),
	CONSTRAINT "feedback_friction_check" CHECK ("feedback"."friction" is null or char_length("feedback"."friction") <= 4000),
	CONSTRAINT "feedback_wish_check" CHECK ("feedback"."wish" is null or char_length("feedback"."wish") <= 4000),
	CONSTRAINT "feedback_workaround_check" CHECK ("feedback"."workaround" is null or char_length("feedback"."workaround") <= 4000),
	CONSTRAINT "feedback_contact_email_check" CHECK ("feedback"."contact_email" is null or (char_length("feedback"."contact_email") <= 254 and "feedback"."contact_email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
);
--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "meeting_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_created_idx" ON "feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "feedback_user_created_idx" ON "feedback" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_meeting_url_check" CHECK ("challenges"."meeting_url" is null or (char_length(btrim("challenges"."meeting_url")) between 1 and 2000 and "challenges"."meeting_url" ~ '^https://'));