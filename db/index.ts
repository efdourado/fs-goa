import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não foi definida para o PostgreSQL.");
  return drizzle(url, { schema });
}
