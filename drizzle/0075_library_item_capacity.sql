CREATE FUNCTION enforce_catalog_library_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.archived_at IS NULL AND OLD.group_id = NEW.group_id AND OLD.kind = NEW.kind THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Serialize capacity checks within the workspace. Each read at READ COMMITTED
  -- sees writes committed by the previous holder and earlier rows in this batch.
  PERFORM pg_advisory_xact_lock(hashtextextended('goa:catalog-capacity:' || NEW.group_id, 0));
  IF EXISTS (
    SELECT 1 FROM catalog_items
    WHERE group_id = NEW.group_id AND kind = NEW.kind AND archived_at IS NULL
    LIMIT 1 OFFSET 1199
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'catalog_items_library_capacity',
      MESSAGE = 'A library can hold at most 1200 active items.';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER catalog_items_library_capacity
  BEFORE INSERT OR UPDATE OF group_id, kind, archived_at ON catalog_items
  FOR EACH ROW EXECUTE FUNCTION enforce_catalog_library_capacity();
