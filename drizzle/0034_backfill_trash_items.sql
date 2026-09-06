-- V1 §13 follow-up: rows that were already soft-deleted before `trash_items`
-- existed are invisible to the new bin UI. Backfill an explicit bin record for
-- each — groups, challenges and entries with a real `deleted_at`. Catalogue
-- items are deliberately skipped: `archived_at` there also covers automatic
-- orphan-archiving, which belongs under "Arquivados", not the bin.
INSERT INTO "trash_items" (id, entity_kind, entity_id, scope_type, scope_id, deleted_by_user_id, deleted_at)
SELECT gen_random_uuid()::text, 'group', g.id,
       'personal', g.id,
       g.deleted_by_user_id, g.deleted_at
  FROM "groups" g
 WHERE g.deleted_at IS NOT NULL AND g.kind = 'standard'
ON CONFLICT (entity_kind, entity_id) DO NOTHING;--> statement-breakpoint
INSERT INTO "trash_items" (id, entity_kind, entity_id, scope_type, scope_id, deleted_by_user_id, deleted_at)
SELECT gen_random_uuid()::text, 'challenge', c.id,
       CASE WHEN g.kind = 'personal' THEN 'personal' ELSE 'group' END,
       c.group_id,
       c.deleted_by_user_id, c.deleted_at
  FROM "challenges" c JOIN "groups" g ON g.id = c.group_id
 WHERE c.deleted_at IS NOT NULL
ON CONFLICT (entity_kind, entity_id) DO NOTHING;--> statement-breakpoint
-- Only entries a person removed on their own. One that was swept away with its
-- item (or with a pruned catalogue row) must stay *without* a bin record, so
-- restoring that parent brings it back — `restoreTrashItem` uses exactly the
-- absence of a `trash_items` row to tell the two apart.
INSERT INTO "trash_items" (id, entity_kind, entity_id, scope_type, scope_id, deleted_at)
SELECT gen_random_uuid()::text, 'entry', e.id,
       CASE WHEN g.kind = 'personal' THEN 'personal' ELSE 'group' END,
       c.group_id,
       e.deleted_at
  FROM "entries" e
  JOIN "challenges" c ON c.id = e.challenge_id
  JOIN "groups" g ON g.id = c.group_id
  LEFT JOIN "challenge_items" it ON it.id = e.item_id
 WHERE e.deleted_at IS NOT NULL
   AND c.deleted_at IS NULL
   AND (it.id IS NULL OR it.archived_at IS NULL)
ON CONFLICT (entity_kind, entity_id) DO NOTHING;
