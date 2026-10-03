-- The front page shows the two most recently featured templates; anything featured before them drops its mark,
-- so a template's "Take off the front page" option only shows while it's really there.
UPDATE "challenges" SET "template_featured_at" = NULL
 WHERE "template_featured_at" IS NOT NULL
   AND "id" NOT IN (SELECT "id" FROM "challenges" WHERE "template_featured_at" IS NOT NULL ORDER BY "template_featured_at" DESC LIMIT 2);
