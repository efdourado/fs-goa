-- A catalogue item is its own id: films and books no longer merge by title (or title and author), so the
-- person can keep several items with the same name.
DROP INDEX IF EXISTS "catalog_items_group_film_title_uidx";
DROP INDEX IF EXISTS "catalog_items_group_book_title_author_uidx";
