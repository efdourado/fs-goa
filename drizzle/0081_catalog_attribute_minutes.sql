-- A "minutes" property: a whole number of minutes, kept as a number and shown in hours ("2h12").
ALTER TABLE "catalog_attribute_defs" DROP CONSTRAINT IF EXISTS "catalog_attribute_defs_type_check";
ALTER TABLE "catalog_attribute_defs" ADD CONSTRAINT "catalog_attribute_defs_type_check" CHECK ("type" IN ('text', 'number', 'minutes', 'date', 'boolean'));
