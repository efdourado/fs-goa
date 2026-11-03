-- Archived definitions are excluded from calculations and copies. Purge only those with no
-- visible publication dependency, removing their dependent blocks first (the only FK consumers).
DELETE FROM result_blocks b
 WHERE b.metric_id IN (
   SELECT m.id FROM challenge_metrics m WHERE m.archived_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM result_blocks live WHERE live.metric_id = m.id AND live.visible)
 );
--> statement-breakpoint
DELETE FROM challenge_metrics m WHERE m.archived_at IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM result_blocks b WHERE b.metric_id = m.id);
--> statement-breakpoint
-- Remove unused definitions generated since 0073. Explicit pages, rating sources and actual
-- publication dependencies are kept; entry values and fields are never deleted here.
DELETE FROM result_blocks b
 WHERE b.metric_id IN (
   SELECT m.id FROM challenge_metrics m
    WHERE coalesce(m.settings->>'resultPage', 'false') <> 'true'
      AND coalesce(m.settings->>'isRating', 'false') <> 'true'
      AND NOT EXISTS (SELECT 1 FROM result_blocks live WHERE live.metric_id = m.id AND live.visible)
 );
--> statement-breakpoint
DELETE FROM challenge_metrics m
 WHERE coalesce(m.settings->>'resultPage', 'false') <> 'true'
   AND coalesce(m.settings->>'isRating', 'false') <> 'true'
   AND NOT EXISTS (SELECT 1 FROM result_blocks b WHERE b.metric_id = m.id);
--> statement-breakpoint
-- This flag belonged only to the removed field-metric generator.
UPDATE challenge_fields SET settings = settings - 'autoMetrics' WHERE settings ? 'autoMetrics';
