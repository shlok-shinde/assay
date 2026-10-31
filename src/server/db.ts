// Postgres, for the deployments that have one. Nothing connects until a route asks, and with no
// DATABASE_URL every caller gets null, so the demo and a local build need no database at all.
import { Pool } from "pg";

let pool: Pool | null = null;

export const hasDatabase = () => !!process.env.DATABASE_URL;

export function database(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 });
  return pool;
}

const ready = new Map<string, Promise<void>>();

/** Creates a table the first time this instance needs it. */
export function ensureTable(name: string, ddl: string): Promise<void> {
  let p = ready.get(name);
  if (!p) {
    p = database()!
      .query(ddl)
      .then(() => undefined);
    p.catch(() => ready.delete(name));
    ready.set(name, p);
  }
  return p;
}
