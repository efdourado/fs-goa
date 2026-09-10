import pg, { type PoolClient, type QueryResultRow } from "pg";
import { Pool as NeonPool } from "@neondatabase/serverless";
// Node 22+ (see package.json engines) exposes a global WebSocket, which
// `@neondatabase/serverless` uses automatically — no `ws` shim needed.

const pools = new Map<string, pg.Pool>();

function databaseUrl(): string {
  const url = typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;

  if (!url) {
    throw new Error("DATABASE_URL não foi definida para o PostgreSQL.");
  }

  return url;
}

/**
 * Neon is reached over its WebSocket proxy on 443 (`@neondatabase/serverless`,
 * a documented drop-in for `pg`). That's what Neon recommends on Vercel, and it
 * also means every DB-touching script works from networks that block 5432.
 * A non-Neon host (local Docker, self-hosted) stays on plain `pg`/5432.
 */
export function getPool(): pg.Pool {
  const url = databaseUrl();
  const cached = pools.get(url);
  if (cached) return cached;

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // A bare/socket connection string — treat as local.
  }
  const pool = host.endsWith(".neon.tech")
    ? (new NeonPool({ connectionString: url }) as unknown as pg.Pool)
    : new pg.Pool({
        connectionString: url,
        max: 5,
        idleTimeoutMillis: 20_000,
        connectionTimeoutMillis: 10_000,
      });
  pools.set(url, pool);
  return pool;
}

export async function withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function oneOrNull<T extends QueryResultRow>(
  client: Pick<PoolClient, "query">,
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const result = await client.query<T>(text, [...values]);
  return result.rows[0] ?? null;
}
