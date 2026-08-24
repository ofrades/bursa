import { drizzle } from "drizzle-orm/d1";
import { env } from "../env";

export type Db = ReturnType<typeof makeDb>;

let _db: Db | null = null;

function makeDb(d1: D1Database) {
  // drizzle 1.0 rc dropped `schema` from SQLite driver configs (and the
  // relational query API is unused here), so the client takes no config.
  return drizzle(d1);
}

/**
 * Drizzle client over the Cloudflare D1 binding. Memoized per isolate;
 * migrations are applied at deploy time by alchemy (see alchemy.run.ts),
 * so there is no runtime migration step.
 */
export function getDb(): Db {
  _db ??= makeDb(env.DB);
  return _db;
}

export function getD1Database(): D1Database {
  return env.DB;
}
