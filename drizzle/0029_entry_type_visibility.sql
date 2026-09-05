-- Who sees another participant's entry of a given type, and when.
ALTER TABLE "entry_types" ADD COLUMN "visibility_policy" text NOT NULL DEFAULT 'group_realtime';--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_visibility_policy_check" CHECK ("entry_types"."visibility_policy" in ('group_realtime', 'after_own', 'after_close', 'author_only'));
