-- Per-IP and per-account request counters (lib/rate-limit.ts): sign-up, login, feedback, public links and every write.
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limits_window_started_at_idx" ON "rate_limits" USING btree ("window_started_at");