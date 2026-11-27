-- A number property can name its unit ("km", "min"): shown beside the value, never converted.
ALTER TABLE "catalog_attribute_defs" ADD COLUMN IF NOT EXISTS "unit" text;
ALTER TABLE "catalog_attribute_defs" DROP CONSTRAINT IF EXISTS "catalog_attribute_defs_unit_check";
ALTER TABLE "catalog_attribute_defs" ADD CONSTRAINT "catalog_attribute_defs_unit_check" CHECK ("unit" IS NULL OR char_length(btrim("unit")) BETWEEN 1 AND 12);
