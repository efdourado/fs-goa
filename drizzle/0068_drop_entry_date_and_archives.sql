-- Deleting deletes. Every row the old "delete" only archived (fields, choices, metrics, response types, stages, a
-- challenge's items, library properties) leaves the database now, with what hung from it. The Lixeira (challenges,
-- groups, catalogue items, responses) keeps its contents; a deleted library with nothing left in it goes.
-- And the "ask when each response happened" setting is gone, with the dates it collected on item responses.

-- An item response's own date came from that setting: it is dated by when it was saved now. Day-keyed
-- responses, stage-bound ones and check-in visits keep theirs.
UPDATE "entries" e SET "occurred_on" = NULL
  FROM "entry_types" et
 WHERE et."id" = e."entry_type_id" AND e."item_id" IS NOT NULL AND e."parent_entry_id" IS NULL
   AND e."checkpoint_id" IS NULL AND e."occurred_on" IS NOT NULL
   AND e."cardinality" NOT IN ('once_per_day', 'once_per_item_day')
   AND coalesce(et."schedule_policy", '') <> 'checkpoint';--> statement-breakpoint

-- Choices removed from a choice field, with the answers that picked them.
DELETE FROM "result_blocks" rb USING "entry_values" ev, "field_options" o
 WHERE o."archived_at" IS NOT NULL AND ev."option_id" = o."id"
   AND rb."source_entry_id" = ev."entry_id" AND rb."source_field_id" = ev."field_id";--> statement-breakpoint
DELETE FROM "entry_values" ev USING "field_options" o WHERE o."archived_at" IS NOT NULL AND ev."option_id" = o."id";--> statement-breakpoint
DELETE FROM "field_options" WHERE "archived_at" IS NOT NULL;--> statement-breakpoint

-- What goes: removed response types, a challenge's removed items (not those waiting in the Lixeira with their
-- catalogue item), every response about either (with a check-in's records), removed fields and the fields of
-- removed types, and the metrics that read any of them.
CREATE TEMP TABLE "purge_types" AS SELECT "id" FROM "entry_types" WHERE "archived_at" IS NOT NULL;--> statement-breakpoint
CREATE TEMP TABLE "purge_items" AS
  SELECT it."id" FROM "challenge_items" it
   WHERE it."archived_at" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "catalog_items" ci WHERE ci."id" = it."catalog_item_id" AND ci."archived_at" IS NOT NULL);--> statement-breakpoint
CREATE TEMP TABLE "purge_entries" AS
  SELECT "id" FROM "entries"
   WHERE "entry_type_id" IN (SELECT "id" FROM "purge_types") OR "item_id" IN (SELECT "id" FROM "purge_items");--> statement-breakpoint
INSERT INTO "purge_entries"
  SELECT "id" FROM "entries"
   WHERE "parent_entry_id" IN (SELECT "id" FROM "purge_entries") AND "id" NOT IN (SELECT "id" FROM "purge_entries");--> statement-breakpoint
CREATE TEMP TABLE "purge_fields" AS
  SELECT "id" FROM "challenge_fields" WHERE "archived_at" IS NOT NULL OR "entry_type_id" IN (SELECT "id" FROM "purge_types");--> statement-breakpoint
CREATE TEMP TABLE "purge_metrics" AS
  SELECT "id" FROM "challenge_metrics"
   WHERE "archived_at" IS NOT NULL
      OR "field_id" IN (SELECT "id" FROM "purge_fields")
      OR "entry_type_id" IN (SELECT "id" FROM "purge_types");--> statement-breakpoint

DELETE FROM "result_blocks" WHERE "source_entry_id" IN (SELECT "id" FROM "purge_entries");--> statement-breakpoint
DELETE FROM "trash_items" WHERE "entity_kind" = 'entry' AND "entity_id" IN (SELECT "id" FROM "purge_entries");--> statement-breakpoint
DELETE FROM "entries" WHERE "parent_entry_id" IS NOT NULL AND "id" IN (SELECT "id" FROM "purge_entries");--> statement-breakpoint
DELETE FROM "entries" WHERE "id" IN (SELECT "id" FROM "purge_entries");--> statement-breakpoint

DELETE FROM "result_blocks" WHERE "metric_id" IN (SELECT "id" FROM "purge_metrics");--> statement-breakpoint
DELETE FROM "challenge_metrics" WHERE "id" IN (SELECT "id" FROM "purge_metrics");--> statement-breakpoint
DELETE FROM "result_blocks" WHERE "source_field_id" IN (SELECT "id" FROM "purge_fields");--> statement-breakpoint
DELETE FROM "entry_values" WHERE "field_id" IN (SELECT "id" FROM "purge_fields");--> statement-breakpoint
DELETE FROM "field_options" WHERE "field_id" IN (SELECT "id" FROM "purge_fields");--> statement-breakpoint
DELETE FROM "challenge_fields" WHERE "id" IN (SELECT "id" FROM "purge_fields");--> statement-breakpoint

UPDATE "challenge_items" SET "entry_type_id" = NULL WHERE "entry_type_id" IN (SELECT "id" FROM "purge_types");--> statement-breakpoint
UPDATE "entry_types" SET "parent_type_id" = NULL WHERE "parent_type_id" IN (SELECT "id" FROM "purge_types");--> statement-breakpoint
DELETE FROM "entry_types" WHERE "id" IN (SELECT "id" FROM "purge_types");--> statement-breakpoint
DELETE FROM "challenge_items" WHERE "id" IN (SELECT "id" FROM "purge_items");--> statement-breakpoint

DROP TABLE "purge_metrics";--> statement-breakpoint
DROP TABLE "purge_fields";--> statement-breakpoint
DROP TABLE "purge_entries";--> statement-breakpoint
DROP TABLE "purge_items";--> statement-breakpoint
DROP TABLE "purge_types";--> statement-breakpoint

-- Removed stages: their items and responses stay, with no stage.
UPDATE "challenge_items" SET "checkpoint_id" = NULL
 WHERE "checkpoint_id" IN (SELECT "id" FROM "challenge_checkpoints" WHERE "archived_at" IS NOT NULL);--> statement-breakpoint
UPDATE "entries" SET "checkpoint_id" = NULL
 WHERE "checkpoint_id" IN (SELECT "id" FROM "challenge_checkpoints" WHERE "archived_at" IS NOT NULL);--> statement-breakpoint
DELETE FROM "challenge_checkpoints" WHERE "archived_at" IS NOT NULL;--> statement-breakpoint

-- Removed library properties (their values were already erased).
DELETE FROM "catalog_attribute_values"
 WHERE "attribute_def_id" IN (SELECT "id" FROM "catalog_attribute_defs" WHERE "archived_at" IS NOT NULL);--> statement-breakpoint
DELETE FROM "catalog_attribute_defs" WHERE "archived_at" IS NOT NULL;--> statement-breakpoint

-- A deleted library with no catalogue item left, not even in the Lixeira.
DELETE FROM "catalog_attribute_values"
 WHERE "attribute_def_id" IN (
   SELECT d."id" FROM "catalog_attribute_defs" d
     JOIN "catalog_libraries" l ON l."group_id" = d."group_id" AND l."kind" = d."kind"
    WHERE l."archived_at" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "catalog_items" ci WHERE ci."group_id" = l."group_id" AND ci."kind" = l."kind"));--> statement-breakpoint
DELETE FROM "catalog_attribute_defs" d USING "catalog_libraries" l
 WHERE l."group_id" = d."group_id" AND l."kind" = d."kind" AND l."archived_at" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "catalog_items" ci WHERE ci."group_id" = l."group_id" AND ci."kind" = l."kind");--> statement-breakpoint
DELETE FROM "catalog_libraries" l
 WHERE l."archived_at" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "catalog_items" ci WHERE ci."group_id" = l."group_id" AND ci."kind" = l."kind");--> statement-breakpoint

ALTER TABLE "challenges" DROP COLUMN "collects_entry_date";
