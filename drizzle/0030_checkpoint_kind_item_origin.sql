-- A checkpoint now carries how it should be presented: a day, a week, a themed
-- session, or a one-off milestone. "Week" is a presentation of a checkpoint,
-- never its own entity.
ALTER TABLE "challenge_checkpoints" ADD COLUMN "kind" text DEFAULT 'session' NOT NULL;--> statement-breakpoint
ALTER TABLE "challenge_checkpoints" ADD CONSTRAINT "challenge_checkpoints_kind_check" CHECK ("challenge_checkpoints"."kind" in ('day', 'week', 'session', 'milestone'));--> statement-breakpoint
-- Where an imported item came from when no group member recommended it
-- ("list found online"). Free text — never a fake participant.
ALTER TABLE "challenge_items" ADD COLUMN "origin_note" text;--> statement-breakpoint
ALTER TABLE "challenge_items" ADD CONSTRAINT "challenge_items_origin_note_check" CHECK ("challenge_items"."origin_note" is null or char_length(btrim("challenge_items"."origin_note")) between 1 and 200);--> statement-breakpoint
-- Rounds generated day-by-day should read as days, not generic sessions.
UPDATE "challenge_checkpoints" SET "kind" = 'day' WHERE "semantic_key" ~ '^dia_[0-9]+$';
