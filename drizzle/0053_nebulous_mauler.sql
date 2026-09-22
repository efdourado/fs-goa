CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"color_tag" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "notes_kind_check" CHECK ("notes"."kind" in ('text', 'checklist')),
	CONSTRAINT "notes_title_check" CHECK (char_length(btrim("notes"."title")) between 1 and 160),
	CONSTRAINT "notes_body_check" CHECK ("notes"."body" is null or char_length("notes"."body") <= 20000),
	CONSTRAINT "notes_items_array_check" CHECK (jsonb_typeof("notes"."items") = 'array'),
	CONSTRAINT "notes_color_tag_check" CHECK ("notes"."color_tag" is null or "notes"."color_tag" in ('green', 'blue', 'violet', 'coral', 'amber', 'rose'))
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_user_idx" ON "notes" USING btree ("user_id","deleted_at","pinned");