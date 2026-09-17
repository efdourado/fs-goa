ALTER TABLE "result_blocks" DROP CONSTRAINT "result_blocks_source_check";--> statement-breakpoint
ALTER TABLE "result_blocks" ADD CONSTRAINT "result_blocks_source_check" CHECK ((
          "result_blocks"."kind" = 'metric'
          and "result_blocks"."metric_id" is not null
          and "result_blocks"."source_entry_id" is null
          and "result_blocks"."source_field_id" is null
        ) or (
          "result_blocks"."kind" = 'entry_value'
          and "result_blocks"."metric_id" is null
          and "result_blocks"."source_entry_id" is not null
          and "result_blocks"."source_field_id" is not null
          and "result_blocks"."body_snapshot" is not null
        ) or (
          "result_blocks"."kind" = 'text'
          and "result_blocks"."metric_id" is null
          and "result_blocks"."source_entry_id" is null
          and "result_blocks"."source_field_id" is null
          and "result_blocks"."body_snapshot" is not null
        ) or (
          "result_blocks"."kind" in ('ranking', 'affinity')
          and "result_blocks"."metric_id" is null
          and "result_blocks"."source_entry_id" is null
          and "result_blocks"."source_field_id" is null
        ));