// The team tables. Created once per instance on the unpooled connection, because a pooler can't hold a schema change's
// session, and serialised with a transaction-scoped lock so two instances starting together don't collide.
import { Client } from "pg";

const DDL = `
CREATE TABLE IF NOT EXISTS team_workspaces (id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS team_members (workspace_id text NOT NULL REFERENCES team_workspaces ON DELETE CASCADE, email text NOT NULL, name text NOT NULL, role text NOT NULL, joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, email));
CREATE TABLE IF NOT EXISTS team_links (token_hash text PRIMARY KEY, email text NOT NULL, purpose text NOT NULL, workspace_id text, workspace_name text, name text, role text, expires_at timestamptz NOT NULL, used_at timestamptz);
CREATE TABLE IF NOT EXISTS team_sessions (token_hash text PRIMARY KEY, email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS team_limits (key text NOT NULL, window_start timestamptz NOT NULL, n integer NOT NULL, PRIMARY KEY (key, window_start));
CREATE TABLE IF NOT EXISTS team_rows (workspace_id text NOT NULL REFERENCES team_workspaces ON DELETE CASCADE, tbl text NOT NULL, row_id text NOT NULL, data jsonb, version integer NOT NULL, seq bigint NOT NULL, deleted boolean NOT NULL DEFAULT false, PRIMARY KEY (workspace_id, tbl, row_id));
CREATE INDEX IF NOT EXISTS team_rows_seq ON team_rows (workspace_id, seq);
CREATE SEQUENCE IF NOT EXISTS team_seq;
CREATE TABLE IF NOT EXISTS team_blob_chunks (workspace_id text NOT NULL REFERENCES team_workspaces ON DELETE CASCADE, hash text NOT NULL, idx integer NOT NULL, total integer NOT NULL, data text NOT NULL, PRIMARY KEY (workspace_id, hash, idx));
CREATE TABLE IF NOT EXISTS team_alerts (workspace_id text NOT NULL REFERENCES team_workspaces ON DELETE CASCADE, key text NOT NULL, owner_email text NOT NULL, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, key));
`;

let ready: Promise<void> | null = null;

export function ensureTeamSchema(): Promise<void> {
  ready ??= (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, connectionTimeoutMillis: 8_000 });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('team_schema'))");
      await client.query(DDL);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      await client.end();
    }
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
