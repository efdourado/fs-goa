-- Films/series get a runtime back, mirroring `page_count` for books.
ALTER TABLE "catalog_items" ADD COLUMN "runtime_minutes" integer;
