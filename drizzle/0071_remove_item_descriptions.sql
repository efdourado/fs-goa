-- Remove the unconfigured built-in field and its values from old and new rounds.
-- User-defined library properties and checkpoint descriptions are independent.
ALTER TABLE challenge_items DROP COLUMN description;
