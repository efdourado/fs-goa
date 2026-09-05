-- V1 §9: median + consensus join the metric operations; a metric can group by
-- checkpoint (week / session). V1 §9–11: personal-ranking and affinity blocks in
-- the showcase.

ALTER TABLE "challenge_metrics" DROP CONSTRAINT IF EXISTS "challenge_metrics_operation_check";--> statement-breakpoint
ALTER TABLE "challenge_metrics" ADD CONSTRAINT "challenge_metrics_operation_check" CHECK ("challenge_metrics"."operation" in ('sum', 'average', 'count', 'min', 'max', 'median', 'completion_rate', 'bayesian_average', 'spread', 'consensus', 'surprise', 'indicator_bias'));--> statement-breakpoint

ALTER TABLE "challenge_metrics" DROP CONSTRAINT IF EXISTS "challenge_metrics_group_by_check";--> statement-breakpoint
ALTER TABLE "challenge_metrics" ADD CONSTRAINT "challenge_metrics_group_by_check" CHECK ("challenge_metrics"."group_by" in ('none', 'participant', 'item', 'checkpoint', 'day', 'week', 'catalog_year', 'catalog_author', 'catalog_genre'));--> statement-breakpoint

ALTER TABLE "challenge_metrics" DROP CONSTRAINT IF EXISTS "challenge_metrics_field_requirement_check";--> statement-breakpoint
ALTER TABLE "challenge_metrics" ADD CONSTRAINT "challenge_metrics_field_requirement_check" CHECK (
  ("challenge_metrics"."operation" in ('sum', 'average', 'min', 'max', 'median',
        'bayesian_average', 'spread', 'consensus', 'surprise', 'indicator_bias') and "challenge_metrics"."field_id" is not null)
  or ("challenge_metrics"."operation" = 'completion_rate' and "challenge_metrics"."field_id" is null)
  or ("challenge_metrics"."operation" = 'count')
);--> statement-breakpoint

ALTER TABLE "result_blocks" DROP CONSTRAINT IF EXISTS "result_blocks_kind_check";--> statement-breakpoint
ALTER TABLE "result_blocks" ADD CONSTRAINT "result_blocks_kind_check" CHECK ("result_blocks"."kind" in ('metric', 'entry_value', 'text', 'ranking', 'affinity'));--> statement-breakpoint

ALTER TABLE "result_blocks" DROP CONSTRAINT IF EXISTS "result_blocks_source_check";--> statement-breakpoint
ALTER TABLE "result_blocks" ADD CONSTRAINT "result_blocks_source_check" CHECK (
  ("result_blocks"."kind" = 'metric' and "result_blocks"."metric_id" is not null and "result_blocks"."source_entry_id" is null and "result_blocks"."source_field_id" is null)
  or ("result_blocks"."kind" = 'entry_value' and "result_blocks"."metric_id" is null and "result_blocks"."source_entry_id" is not null and "result_blocks"."source_field_id" is not null and "result_blocks"."body_snapshot" is not null)
  or ("result_blocks"."kind" = 'text' and "result_blocks"."metric_id" is null and "result_blocks"."source_entry_id" is null and "result_blocks"."source_field_id" is null and "result_blocks"."body_snapshot" is not null)
  or ("result_blocks"."kind" in ('ranking', 'affinity') and "result_blocks"."metric_id" is null and "result_blocks"."source_entry_id" is null and "result_blocks"."source_field_id" is null and "result_blocks"."value_snapshot" is not null)
);
