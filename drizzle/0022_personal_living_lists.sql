-- A personal challenge with no start/end is a living list ("films I've seen",
-- "books I've read") — it is born active and never closes. Heal any that were
-- created before this rule and are stuck in draft.
UPDATE "challenges" c
   SET status = 'active',
       activated_at = COALESCE(c.activated_at, now()),
       updated_at = now()
  FROM "groups" g
 WHERE g.id = c.group_id
   AND g.kind = 'personal'
   AND c.status = 'draft'
   AND c.start_date IS NULL
   AND c.end_date IS NULL
   AND c.deleted_at IS NULL;
