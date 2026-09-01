-- 1. Add the new columns (all nullable except recipe_version).
ALTER TABLE "challenges" ADD COLUMN "recipe_key" text;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "recipe_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "cardinality" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "checkpoint_id" text;--> statement-breakpoint
ALTER TABLE "entry_types" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "entry_types" ADD COLUMN "target_policy" text;--> statement-breakpoint
ALTER TABLE "entry_types" ADD COLUMN "cardinality" text;--> statement-breakpoint
ALTER TABLE "entry_types" ADD COLUMN "schedule_policy" text;--> statement-breakpoint

-- 2. Backfill the four orthogonal axes from `submission_mode` + the challenge period.
UPDATE "entry_types" et SET
  "purpose" = CASE et."submission_mode" WHEN 'item' THEN 'rating' ELSE 'checkin' END,
  "target_policy" = CASE et."submission_mode" WHEN 'item' THEN 'required' ELSE 'none' END,
  "cardinality" = CASE et."submission_mode"
    WHEN 'item' THEN 'once_per_item'
    WHEN 'daily' THEN 'once_per_day'
    ELSE 'repeatable' END,
  "schedule_policy" = CASE
    WHEN et."submission_mode" = 'item' THEN 'while_active'
    WHEN et."submission_mode" = 'daily' AND c."start_date" IS NOT NULL THEN 'checkpoint'
    ELSE 'free' END
FROM "challenges" c
WHERE c."id" = et."challenge_id" AND et."purpose" IS NULL;--> statement-breakpoint

-- 3. Denormalize cardinality onto existing entries so the partial unique indexes cover them.
UPDATE "entries" e SET "cardinality" = COALESCE(et."cardinality",
  CASE e."submission_mode" WHEN 'daily' THEN 'once_per_day' WHEN 'item' THEN 'once_per_item' ELSE 'repeatable' END)
FROM "entry_types" et
WHERE et."id" = e."entry_type_id" AND e."cardinality" IS NULL;--> statement-breakpoint

-- 4. Tag existing challenges with the recipe that matches their entry type.
UPDATE "challenges" c SET "recipe_key" = sub.recipe
FROM (
  SELECT et."challenge_id",
    CASE
      WHEN bool_or(et."submission_mode" = 'item') THEN 'cine_free'
      WHEN bool_or(et."submission_mode" = 'daily') THEN 'reading_daily'
      ELSE NULL
    END AS recipe
  FROM "entry_types" et
  GROUP BY et."challenge_id"
) sub
WHERE sub."challenge_id" = c."id" AND c."recipe_key" IS NULL AND sub.recipe IS NOT NULL;--> statement-breakpoint

-- 5. Swap the entry-shape CHECK and the cardinality-scoped unique indexes.
ALTER TABLE "entries" DROP CONSTRAINT "entries_item_mode_check";--> statement-breakpoint
DROP INDEX "entries_one_active_item_response_uidx";--> statement-breakpoint
DROP INDEX "entries_one_active_daily_response_uidx";--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_item_target_check" CHECK ("entries"."submission_mode" <> 'item' or "entries"."item_id" is not null);--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_checkpoint_challenge_fk" FOREIGN KEY ("checkpoint_id","challenge_id") REFERENCES "public"."challenge_checkpoints"("id","challenge_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_item_response_uidx" ON "entries" USING btree ("item_id","entry_type_id","participant_user_id") WHERE "entries"."cardinality" = 'once_per_item' and "entries"."item_id" is not null and "entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_item_day_uidx" ON "entries" USING btree ("item_id","entry_type_id","participant_user_id","occurred_on") WHERE "entries"."cardinality" = 'once_per_item_day' and "entries"."item_id" is not null and "entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_daily_response_uidx" ON "entries" USING btree ("challenge_id","entry_type_id","participant_user_id","occurred_on") WHERE "entries"."cardinality" = 'once_per_day' and "entries"."deleted_at" is null;--> statement-breakpoint

-- 6. Value CHECKs on the new columns.
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_recipe_key_check" CHECK ("challenges"."recipe_key" is null or "challenges"."recipe_key" in ('cine_free', 'cine_curated', 'reading_club', 'reading_daily'));--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_recipe_version_check" CHECK ("challenges"."recipe_version" >= 1);--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_purpose_check" CHECK ("entry_types"."purpose" is null or "entry_types"."purpose" in ('progress', 'completion', 'expectation', 'rating', 'checkin'));--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_target_policy_check" CHECK ("entry_types"."target_policy" is null or "entry_types"."target_policy" in ('required', 'optional', 'none'));--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_cardinality_check" CHECK ("entry_types"."cardinality" is null or "entry_types"."cardinality" in ('once_per_item', 'once_per_item_day', 'repeatable', 'once_per_day'));--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_schedule_policy_check" CHECK ("entry_types"."schedule_policy" is null or "entry_types"."schedule_policy" in ('free', 'while_active', 'checkpoint'));
