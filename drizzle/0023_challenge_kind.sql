-- A living list stops being a condition we derive (personal + no dates) and
-- becomes a real category: `challenges.kind`. `round` is the familiar
-- draft/active/closed lifecycle; `list` is a personal running list that is
-- always active and never closes.
ALTER TABLE "challenges" ADD COLUMN "kind" text DEFAULT 'round' NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_kind_check" CHECK ("challenges"."kind" in ('round', 'list'));--> statement-breakpoint

-- Backfill: any personal, undated, not-closed challenge is a living list —
-- heal it to active in the same breath, regardless of whether 0022 already ran.
UPDATE "challenges" c
   SET kind = 'list',
       status = 'active',
       activated_at = coalesce(c.activated_at, now()),
       updated_at = now()
  FROM "groups" g
 WHERE g.id = c.group_id
   AND g.kind = 'personal'
   AND c.start_date IS NULL
   AND c.end_date IS NULL
   AND c.status <> 'closed';--> statement-breakpoint

ALTER TABLE "challenges" ADD CONSTRAINT "challenges_kind_status_check" CHECK ("challenges"."kind" = 'round' OR "challenges"."status" = 'active');
