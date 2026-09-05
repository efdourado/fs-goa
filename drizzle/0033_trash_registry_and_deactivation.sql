-- V1 §13/§14 — the recoverable-deletion pass.
--   * trash_items         — explicit "moved to the bin" registry. No FK to a
--     content table: the row is deleted in the same transaction as a restore or
--     a permanent delete. `archived_at` stays reserved for "archive".
--   * system_audit_events — operational breadcrumbs for irreversible actions,
--     with no private content and no content foreign keys (audit_events' FKs
--     make a content-scoped row impossible to write right before deleting it).
--   * users.deactivated_at — reversible "deactivate account", kept apart from an
--     admin ban (disabled_at).
CREATE TABLE "trash_items" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"deleted_by_user_id" text,
	"reason" text,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trash_items_entity_unique" UNIQUE("entity_kind","entity_id"),
	CONSTRAINT "trash_items_entity_kind_check" CHECK ("trash_items"."entity_kind" in ('group', 'challenge', 'catalog_item', 'entry')),
	CONSTRAINT "trash_items_scope_type_check" CHECK ("trash_items"."scope_type" in ('personal', 'group'))
);
--> statement-breakpoint
CREATE TABLE "system_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id_hash" text NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_audit_events_action_check" CHECK (char_length(btrim("system_audit_events"."action")) between 1 and 100),
	CONSTRAINT "system_audit_events_counts_object_check" CHECK (jsonb_typeof("system_audit_events"."counts") = 'object')
);
--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_audit_events" ADD CONSTRAINT "system_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trash_items_scope_idx" ON "trash_items" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "system_audit_events_created_idx" ON "system_audit_events" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;
