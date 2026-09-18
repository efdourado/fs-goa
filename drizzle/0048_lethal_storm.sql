-- Phase 1 completion (docs/flexible-catalogs.md): a custom property can be hidden
-- (out of normal forms and displays, values kept) instead of only archived.
ALTER TABLE "catalog_attribute_defs" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;