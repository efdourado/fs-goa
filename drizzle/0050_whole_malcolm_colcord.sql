-- A catalog item can carry its own scheduled date and time (a match's kickoff), so every
-- challenge that uses the item reads the same date; a challenge may also choose whether
-- its entry forms ask "when did it happen" (null = follow the recipe's default).
ALTER TABLE "catalog_native_property_configs" DROP CONSTRAINT "catalog_native_property_configs_key_check";--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "scheduled_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "scheduled_precision" text DEFAULT 'datetime' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "scheduled_time_zone" text;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "collects_entry_date" boolean;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_scheduled_precision_check" CHECK ("catalog_items"."scheduled_precision" in ('date', 'datetime'));--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_scheduled_shape_check" CHECK (("catalog_items"."scheduled_at" is not null or ("catalog_items"."scheduled_end_at" is null and "catalog_items"."scheduled_time_zone" is null))
          and ("catalog_items"."scheduled_end_at" is null or "catalog_items"."scheduled_end_at" >= "catalog_items"."scheduled_at"));--> statement-breakpoint
ALTER TABLE "catalog_native_property_configs" ADD CONSTRAINT "catalog_native_property_configs_key_check" CHECK ("catalog_native_property_configs"."property_key" in ('title', 'year', 'main_genre', 'runtime_minutes', 'author', 'page_count', 'scheduled_at'));