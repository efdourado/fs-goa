ALTER TABLE "challenge_metrics" DROP CONSTRAINT "challenge_metrics_operation_check";--> statement-breakpoint
ALTER TABLE "challenge_metrics" DROP CONSTRAINT "challenge_metrics_field_requirement_check";--> statement-breakpoint
ALTER TABLE "challenge_metrics" ADD CONSTRAINT "challenge_metrics_operation_check" CHECK ("challenge_metrics"."operation" in ('sum', 'average', 'count', 'min', 'max', 'completion_rate',
        'bayesian_average', 'spread', 'surprise', 'indicator_bias'));--> statement-breakpoint
ALTER TABLE "challenge_metrics" ADD CONSTRAINT "challenge_metrics_field_requirement_check" CHECK (("challenge_metrics"."operation" in ('sum', 'average', 'min', 'max',
            'bayesian_average', 'spread', 'surprise', 'indicator_bias') and "challenge_metrics"."field_id" is not null)
        or ("challenge_metrics"."operation" = 'completion_rate' and "challenge_metrics"."field_id" is null)
        or ("challenge_metrics"."operation" = 'count'));