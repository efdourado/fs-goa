CREATE TABLE "catalog_item_tags" (
	"catalog_item_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "catalog_item_tags_pk" PRIMARY KEY("catalog_item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"year" smallint,
	"runtime_minutes" integer,
	"page_count" integer,
	"created_by_user_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_group_kind_title_unique" UNIQUE("group_id","kind","normalized_title"),
	CONSTRAINT "catalog_items_id_group_unique" UNIQUE("id","group_id"),
	CONSTRAINT "catalog_items_kind_check" CHECK ("catalog_items"."kind" in ('film', 'book', 'other')),
	CONSTRAINT "catalog_items_title_check" CHECK (char_length(btrim("catalog_items"."title")) between 1 and 300),
	CONSTRAINT "catalog_items_normalized_title_check" CHECK (char_length("catalog_items"."normalized_title") between 1 and 300),
	CONSTRAINT "catalog_items_year_check" CHECK ("catalog_items"."year" is null or "catalog_items"."year" between 1870 and 2200),
	CONSTRAINT "catalog_items_runtime_check" CHECK ("catalog_items"."runtime_minutes" is null or "catalog_items"."runtime_minutes" between 1 and 100000),
	CONSTRAINT "catalog_items_pages_check" CHECK ("catalog_items"."page_count" is null or "catalog_items"."page_count" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "catalog_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"normalized_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_tags_group_kind_label_unique" UNIQUE("group_id","kind","normalized_label"),
	CONSTRAINT "catalog_tags_kind_check" CHECK ("catalog_tags"."kind" in ('genre', 'decade', 'mood', 'other')),
	CONSTRAINT "catalog_tags_label_check" CHECK (char_length(btrim("catalog_tags"."label")) between 1 and 80),
	CONSTRAINT "catalog_tags_normalized_label_check" CHECK (char_length("catalog_tags"."normalized_label") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "challenge_items" ADD COLUMN "catalog_item_id" text;--> statement-breakpoint
ALTER TABLE "challenge_items" ADD COLUMN "recommended_by_user_id" text;--> statement-breakpoint
ALTER TABLE "catalog_item_tags" ADD CONSTRAINT "catalog_item_tags_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item_tags" ADD CONSTRAINT "catalog_item_tags_tag_id_catalog_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."catalog_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_tags" ADD CONSTRAINT "catalog_tags_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_item_tags_tag_idx" ON "catalog_item_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "catalog_items_group_kind_idx" ON "catalog_items" USING btree ("group_id","kind");--> statement-breakpoint
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_recommended_by_user_id_users_id_fk" FOREIGN KEY ("recommended_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challenge_items_catalog_idx" ON "challenge_items" USING btree ("catalog_item_id");