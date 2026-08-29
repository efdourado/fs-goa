ALTER TABLE "challenge_duplications" RENAME COLUMN "group_id" TO "source_group_id";--> statement-breakpoint
ALTER TABLE "challenge_duplications" DROP CONSTRAINT "challenge_duplications_source_group_fk";
--> statement-breakpoint
ALTER TABLE "challenge_duplications" DROP CONSTRAINT "challenge_duplications_target_group_fk";
--> statement-breakpoint
ALTER TABLE "challenge_duplications" ADD COLUMN "target_group_id" text;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "rule_sections" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "challenge_duplications" SET "target_group_id" = "source_group_id" WHERE "target_group_id" IS NULL;--> statement-breakpoint
ALTER TABLE "challenge_duplications" ALTER COLUMN "target_group_id" SET NOT NULL;--> statement-breakpoint
UPDATE "challenges"
   SET "rule_sections" = jsonb_build_array(
     jsonb_build_object('title', 'Regras do desafio', 'description', btrim("rules"))
   )
 WHERE "rules" IS NOT NULL AND btrim("rules") <> '';--> statement-breakpoint
ALTER TABLE "challenge_duplications" ADD CONSTRAINT "challenge_duplications_source_group_fk" FOREIGN KEY ("source_challenge_id","source_group_id") REFERENCES "public"."challenges"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_duplications" ADD CONSTRAINT "challenge_duplications_target_group_fk" FOREIGN KEY ("target_challenge_id","target_group_id") REFERENCES "public"."challenges"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_duplications" ADD CONSTRAINT "challenge_duplications_group_distinct_check" CHECK ("challenge_duplications"."source_group_id" <> "challenge_duplications"."target_group_id") NOT VALID;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_rule_sections_check" CHECK (jsonb_typeof("challenges"."rule_sections") = 'array' and jsonb_array_length("challenges"."rule_sections") <= 20);
