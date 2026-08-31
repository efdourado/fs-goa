import process from "node:process";
import crypto from "node:crypto";
import pg from "pg";

// Backfills `catalog_items` for challenges that already have `challenge_items`
// (i.e. `entry_types.submission_mode = 'item'`, the cinema vertical). Idempotent:
// only touches rows where `challenge_items.catalog_item_id IS NULL`. Run once per
// database after migration 0010, like `db:migrate`.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL não foi definida.");

// Keep in sync with normalizeTitle() in lib/goa/catalog.ts
function normalizeTitle(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const { rows } = await pool.query(
    `SELECT i.id, i.title, c.group_id, c.created_by_user_id
       FROM challenge_items i
       JOIN challenges c ON c.id = i.challenge_id
       JOIN entry_types et ON et.challenge_id = c.id AND et.submission_mode = 'item' AND et.archived_at IS NULL
      WHERE i.catalog_item_id IS NULL AND i.archived_at IS NULL`,
  );

  let linked = 0;
  let created = 0;
  for (const row of rows) {
    const normalized = normalizeTitle(row.title);
    if (!normalized) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let existing = await client.query(
        `SELECT id FROM catalog_items
          WHERE group_id = $1 AND kind = 'film' AND normalized_title = $2 AND archived_at IS NULL`,
        [row.group_id, normalized],
      );
      let catalogId = existing.rows[0]?.id;
      if (!catalogId) {
        catalogId = crypto.randomUUID();
        await client.query(
          `INSERT INTO catalog_items
            (id, group_id, kind, title, normalized_title, created_by_user_id, created_at, updated_at)
           VALUES ($1, $2, 'film', $3, $4, $5, now(), now())`,
          [catalogId, row.group_id, row.title.trim().slice(0, 300), normalized, row.created_by_user_id],
        );
        created += 1;
      }
      await client.query("UPDATE challenge_items SET catalog_item_id = $2, updated_at = now() WHERE id = $1", [row.id, catalogId]);
      linked += 1;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(`Acervo: ${created} itens criados, ${linked} itens de desafio ligados.`);
} finally {
  await pool.end();
}
