import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { count, eq, and, or, asc, desc, sql, inArray, isNull, isNotNull, ne, gte, lte, sum } from "drizzle-orm";
export { schema };
export { parseEmailList, seedManagers, seedTestData, TEST_INTERPRETERS, type AnyDb } from "./seed-data";

let cached: ReturnType<typeof createDb> | undefined;

function createDb(url: string) {
  const client = postgres(url, { max: 5 });
  return { db: drizzle(client, { schema }), client };
}

/** Conexión compartida a Postgres usando DATABASE_URL. */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  cached ??= createDb(url);
  return cached.db;
}

/** Cierra la conexión (útil en scripts que terminan). */
export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.client.end();
    cached = undefined;
  }
}

export type Db = ReturnType<typeof getDb>;
