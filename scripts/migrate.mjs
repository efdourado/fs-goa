import { existsSync } from "node:fs";
import process from "node:process";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL não foi definida.");
}

if (!existsSync("drizzle/meta/_journal.json")) {
  throw new Error("Migrações ausentes em drizzle/. Execute npm run db:generate.");
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log("Migrações PostgreSQL aplicadas.");
} finally {
  await pool.end();
}

