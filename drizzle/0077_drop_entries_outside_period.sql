-- A log can only be dated inside its challenge's period (entries.ts, assertInPeriod). Before that check a challenge
-- past its end (or reopened without new dates) still took days outside it: those logs are removed. Undated logs and
-- challenges without dates are untouched. Showcase blocks quoting a removed log go first (they restrict the delete),
-- then the records inside a check-in, then the logs themselves; their values cascade.
DELETE FROM result_blocks b
 USING entries e, challenges c
 WHERE b.source_entry_id = e.id AND c.id = e.challenge_id AND e.occurred_on IS NOT NULL
   AND ((c.start_date IS NOT NULL AND e.occurred_on < c.start_date) OR (c.end_date IS NOT NULL AND e.occurred_on > c.end_date));
--> statement-breakpoint
DELETE FROM entries child
 USING entries parent, challenges c
 WHERE child.parent_entry_id = parent.id AND c.id = parent.challenge_id AND parent.occurred_on IS NOT NULL
   AND ((c.start_date IS NOT NULL AND parent.occurred_on < c.start_date) OR (c.end_date IS NOT NULL AND parent.occurred_on > c.end_date));
--> statement-breakpoint
DELETE FROM entries e
 USING challenges c
 WHERE c.id = e.challenge_id AND e.occurred_on IS NOT NULL
   AND ((c.start_date IS NOT NULL AND e.occurred_on < c.start_date) OR (c.end_date IS NOT NULL AND e.occurred_on > c.end_date));
--> statement-breakpoint
-- An empty note (a check-in saved with nothing typed) is no answer: the app no longer stores one, so the old empty
-- text values go. The log itself stays; only the blank value is removed.
DELETE FROM result_blocks b
 USING entry_values v, challenge_fields f
 WHERE b.source_entry_id = v.entry_id AND b.source_field_id = v.field_id
   AND f.id = v.field_id AND f.kind = 'text' AND btrim(v.text_value, E' \t\r\n') = '';
--> statement-breakpoint
DELETE FROM entry_values v
 USING challenge_fields f
 WHERE f.id = v.field_id AND f.kind = 'text' AND btrim(v.text_value, E' \t\r\n') = '';
