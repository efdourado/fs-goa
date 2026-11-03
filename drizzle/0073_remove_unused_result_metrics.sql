-- Old generated calculations were stored while Results used only its automatic story pages.
-- Retire those definitions rather than turning them into newly visible extra pages.
-- Rating definitions remain available internally: they determine which rating fields are combined.
UPDATE challenge_metrics
   SET archived_at = now(), updated_at = now(),
       settings = coalesce(settings, '{}'::jsonb) || '{"retiredResultDefinition":true}'::jsonb
 WHERE archived_at IS NULL
   AND coalesce(settings->>'resultPage', 'false') <> 'true'
   AND coalesce(settings->>'isRating', 'false') <> 'true';
--> statement-breakpoint
-- Frozen legacy blocks must not reintroduce the retired summaries through the fallback showcase.
UPDATE result_blocks b SET visible = false
 WHERE b.metric_id IN (
   SELECT id FROM challenge_metrics
    WHERE archived_at IS NOT NULL AND settings->>'retiredResultDefinition' = 'true'
 );
