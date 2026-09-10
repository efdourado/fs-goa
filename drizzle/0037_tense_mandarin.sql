-- Cosmetic per-challenge flag: when false, the read-only checkpoint grid is
-- hidden on the challenge / result / template pages. The checkpoints stay —
-- metrics and the admin schedule editor are untouched.
--
-- (Hand-trimmed: `drizzle-kit generate` also re-emitted textually-equivalent
-- check constraints and one catalog index; those already match the database.)
ALTER TABLE "challenges" ADD COLUMN "show_schedule" boolean DEFAULT true NOT NULL;
