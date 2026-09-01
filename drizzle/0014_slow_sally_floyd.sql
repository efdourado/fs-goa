ALTER TABLE "entry_types" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Backfill: one primary per challenge. Prefer progress, then check-in, then
-- rating, then completion — never an expectation type; ties broken by id.
UPDATE "entry_types" SET "is_primary" = true WHERE "id" IN (
  SELECT DISTINCT ON ("challenge_id") "id" FROM "entry_types"
   WHERE "archived_at" IS NULL
   ORDER BY "challenge_id",
     CASE "purpose"
       WHEN 'progress' THEN 0 WHEN 'checkin' THEN 1 WHEN 'rating' THEN 2
       WHEN 'completion' THEN 3 WHEN 'expectation' THEN 5 ELSE 4 END,
     "created_at", "id"
);--> statement-breakpoint

CREATE UNIQUE INDEX "entry_types_one_primary_uidx" ON "entry_types" USING btree ("challenge_id") WHERE "entry_types"."is_primary";
