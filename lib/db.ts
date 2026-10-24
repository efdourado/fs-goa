import pg, { type PoolClient, type QueryResultRow } from "pg";
import { Pool as NeonPool } from "@neondatabase/serverless";
// Node 22+ (see package.json engines) exposes a global WebSocket, which
// `@neondatabase/serverless` uses automatically — no `ws` shim needed.

const pools = new Map<string, pg.Pool>();

/**
 * How long the app waits on one query before giving up on it. The database itself stops a statement after 15s
 * (the role's `statement_timeout`, migration 0070); this is the backstop for when the answer never arrives at
 * all, a dropped socket or a stalled proxy.
 */
const QUERY_TIMEOUT_MS = 20_000;
const CONNECTION_TIMEOUT_MS = 10_000;

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
    ? (new NeonPool({
        connectionString: url,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
        query_timeout: QUERY_TIMEOUT_MS,
      }) as unknown as pg.Pool)
    : new pg.Pool({
        connectionString: url,
        max: 5,
        idleTimeoutMillis: 20_000,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
        query_timeout: QUERY_TIMEOUT_MS,
      });
  pools.set(url, pool);
  return pool;
}

/** Errors after which the connection can't be trusted: its ROLLBACK failed, or it already lost the server. */
const brokenConnections = new WeakSet<object>();

/**
 * Whether a failed connection must be thrown away rather than pooled. A Postgres error (a five-character
 * SQLSTATE) leaves the connection healthy, except for the classes that mean the server dropped it (08 connection
 * exception, 57P operator intervention). Anything else from the driver, a client-side timeout or a reset socket,
 * means a reply may still be on its way, and the next borrower would read it.
 */
export function isBrokenConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (brokenConnections.has(error)) return true;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code)) return code.startsWith("08") || code.startsWith("57P");
  // A Node socket error (`ECONNRESET`, `EPIPE`…); the app's own `ApiError` codes are lowercase and don't match.
  if (typeof code === "string" && /^E[A-Z]+$/u.test(code)) return true;
  const message = error instanceof Error ? error.message : "";
  return /Query read timeout|Connection terminated|timeout exceeded|socket hang up/iu.test(message);
}

export async function withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let broken: Error | undefined;
  try {
    return await work(client);
  } catch (error) {
    if (isBrokenConnectionError(error)) broken = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    // Passing the error destroys the connection instead of handing it to the next request.
    client.release(broken);
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
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is gone. The caller still hears the error that started it, not this one, and the
        // connection is destroyed on release.
        if (error && typeof error === "object") brokenConnections.add(error);
      }
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
