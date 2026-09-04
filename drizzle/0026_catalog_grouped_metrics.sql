-- A metric can now bucket by the catalog dimensions people actually asked for
-- ("best movies of 2026", "best authors") instead of only participant/item.
ALTER TABLE "challenge_metrics" DROP CONSTRAINT "challenge_metrics_group_by_check";--> statement-breakpoint
ALTER TABLE "challenge_metrics" ADD CONSTRAINT "challenge_metrics_group_by_check" CHECK ("challenge_metrics"."group_by" in ('none', 'participant', 'item', 'day', 'week',
        'catalog_year', 'catalog_author', 'catalog_genre'));
