import pg, { type PoolClient, type QueryResultRow } from "pg";

const pools = new Map<string, pg.Pool>();

function databaseUrl(): string {
  const url = typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;

  if (!url) {
    throw new Error("DATABASE_URL não foi definida para o PostgreSQL.");
  }

  return url;
}

export function getPool(): pg.Pool {
  const url = databaseUrl();
  const cached = pools.get(url);
  if (cached) return cached;

  const pool = new pg.Pool({
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
