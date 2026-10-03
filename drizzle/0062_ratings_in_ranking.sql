-- Rating fields now say whether they count toward the ranking (settings.inRanking); new ones don't unless asked.
-- Every rating that already existed did count, so it keeps counting: no challenge's ranking changes.
UPDATE "challenge_fields" f
   SET "settings" = f."settings" || '{"inRanking": true}'::jsonb
  FROM "entry_types" t
 WHERE t.id = f.entry_type_id AND f.kind = 'rating' AND coalesce(t.purpose, 'rating') <> 'expectation'
   AND NOT (f."settings" ? 'inRanking');
