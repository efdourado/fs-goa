ALTER TABLE "challenges" ADD COLUMN "tracking_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
