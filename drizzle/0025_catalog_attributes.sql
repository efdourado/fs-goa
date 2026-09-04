-- Typed catalog attributes: a group (or personal workspace) can name and type
-- its own catalog columns ("diretor" instead of "ano") the same way it already
-- builds entry fields — never a JSON blob, never a global schema change.
CREATE TABLE "catalog_attribute_defs" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"kind" text NOT NULL,
	"semantic_key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_attribute_defs_group_kind_key_unique" UNIQUE("group_id","kind","semantic_key"),
	CONSTRAINT "catalog_attribute_defs_id_group_unique" UNIQUE("id","group_id"),
	CONSTRAINT "catalog_attribute_defs_kind_check" CHECK ("catalog_attribute_defs"."kind" in ('film', 'book', 'other')),
	CONSTRAINT "catalog_attribute_defs_type_check" CHECK ("catalog_attribute_defs"."type" in ('text', 'number', 'date', 'boolean')),
	CONSTRAINT "catalog_attribute_defs_key_check" CHECK ("catalog_attribute_defs"."semantic_key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "catalog_attribute_defs_label_check" CHECK (char_length(btrim("catalog_attribute_defs"."label")) between 1 and 80),
	CONSTRAINT "catalog_attribute_defs_position_check" CHECK ("catalog_attribute_defs"."position" >= 0)
);--> statement-breakpoint
CREATE TABLE "catalog_attribute_values" (
	"catalog_item_id" text NOT NULL,
	"attribute_def_id" text NOT NULL,
	"group_id" text NOT NULL,
	"text_value" text,
	"number_value" integer,
	"date_value" date,
	"boolean_value" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_attribute_values_pk" PRIMARY KEY("catalog_item_id","attribute_def_id"),
	CONSTRAINT "catalog_attribute_values_exactly_one_check" CHECK (num_nonnulls("catalog_attribute_values"."text_value", "catalog_attribute_values"."number_value", "catalog_attribute_values"."date_value", "catalog_attribute_values"."boolean_value") = 1)
);--> statement-breakpoint
ALTER TABLE "catalog_attribute_defs" ADD CONSTRAINT "catalog_attribute_defs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_attribute_defs" ADD CONSTRAINT "catalog_attribute_defs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_attribute_values" ADD CONSTRAINT "catalog_attribute_values_item_scope_fk" FOREIGN KEY ("catalog_item_id","group_id") REFERENCES "public"."catalog_items"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_attribute_values" ADD CONSTRAINT "catalog_attribute_values_def_scope_fk" FOREIGN KEY ("attribute_def_id","group_id") REFERENCES "public"."catalog_attribute_defs"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_attribute_defs_order_idx" ON "catalog_attribute_defs" USING btree ("group_id","kind","position");
