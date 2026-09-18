-- Phase 4 of docs/flexible-catalogs.md: an entry type can now be `shared`
-- (one value for the whole item, not one per participant) instead of only
-- `individual`. Existing rows default to `individual` with their participant
-- untouched — nothing about today's per-participant entries changes.
DROP INDEX "entries_one_active_item_response_uidx";--> statement-breakpoint
DROP INDEX "entries_one_active_item_day_uidx";--> statement-breakpoint
DROP INDEX "entries_one_active_daily_response_uidx";--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "participant_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "answer_scope" text DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_types" ADD COLUMN "answer_scope" text DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_types" ADD COLUMN "shared_edit_policy" text;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_shared_item_response_uidx" ON "entries" USING btree ("item_id","entry_type_id") WHERE "entries"."answer_scope" = 'shared' and "entries"."item_id" is not null and "entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_item_response_uidx" ON "entries" USING btree ("item_id","entry_type_id","participant_user_id") WHERE "entries"."cardinality" = 'once_per_item' and "entries"."answer_scope" = 'individual' and "entries"."item_id" is not null and "entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_item_day_uidx" ON "entries" USING btree ("item_id","entry_type_id","participant_user_id","occurred_on") WHERE "entries"."cardinality" = 'once_per_item_day' and "entries"."answer_scope" = 'individual' and "entries"."item_id" is not null and "entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_daily_response_uidx" ON "entries" USING btree ("challenge_id","entry_type_id","participant_user_id","occurred_on") WHERE "entries"."cardinality" = 'once_per_day' and "entries"."answer_scope" = 'individual' and "entries"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_answer_scope_participant_check" CHECK (("entries"."answer_scope" = 'shared' and "entries"."participant_user_id" is null)
          or ("entries"."answer_scope" = 'individual' and "entries"."participant_user_id" is not null));--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_answer_scope_check" CHECK ("entry_types"."answer_scope" in ('individual', 'shared'));--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_shared_edit_policy_check" CHECK ("entry_types"."shared_edit_policy" is null or "entry_types"."shared_edit_policy" in ('members_fill_admin_corrects', 'members_can_edit'));--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_shared_edit_policy_presence_check" CHECK (("entry_types"."answer_scope" = 'shared') = ("entry_types"."shared_edit_policy" is not null));--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_shared_scope_check" CHECK ("entry_types"."answer_scope" = 'individual' or ("entry_types"."cardinality" = 'once_per_item' and "entry_types"."target_policy" <> 'none'));