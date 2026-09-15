ALTER TABLE "challenges" DROP CONSTRAINT "challenges_results_publication_check";--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_results_publication_check" CHECK ("challenges"."results_published_at" is null
        or ("challenges"."kind" = 'list' and "challenges"."status" = 'active')
        or ("challenges"."status" = 'closed' and "challenges"."results_published_at" >= "challenges"."closed_at"));