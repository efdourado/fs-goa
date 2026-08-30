ALTER TABLE "challenges" DROP CONSTRAINT "challenges_date_range_check";--> statement-breakpoint
ALTER TABLE "challenges" ALTER COLUMN "start_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ALTER COLUMN "end_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_date_range_check" CHECK (("challenges"."start_date" is null and "challenges"."end_date" is null)
        or ("challenges"."start_date" is not null and "challenges"."end_date" is not null and "challenges"."end_date" >= "challenges"."start_date"));