import { existsSync } from "node:fs";
import process from "node:process";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL não foi definida.");
}

if (!existsSync("drizzle/meta/_journal.json")) {
  throw new Error("Migrações ausentes em drizzle/. Execute npm run db:generate.");
}

/**
 * Neon is reachable two ways: raw Postgres on 5432, or the serverless driver
 * tunnelling over WSS on 443. Lots of networks (some office wifi, VPNs) block
 * 5432, so for a `*.neon.tech` host we always take the 443 path — it works
 * everywhere HTTPS works, including Vercel's build step. Anything else
 * (local Docker, a self-hosted Postgres) stays on plain `pg`.
 */
const host = new URL(databaseUrl).hostname;
const isNeon = host.endsWith(".neon.tech");

async function migrateViaNeon() {
  const { neonConfig, Pool } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
  // Node 22+ ships a global WebSocket; older runtimes need the `ws` shim.
  if (typeof globalThis.WebSocket === "undefined") {
    neonConfig.webSocketConstructor = (await import("ws")).default;
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

async function migrateViaPg() {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

console.log(`Migrando ${host}${isNeon ? " (Neon, via WSS/443)" : ""}…`);
await (isNeon ? migrateViaNeon() : migrateViaPg());
console.log("Migrações PostgreSQL aplicadas (nada a fazer se já estavam em dia).");
