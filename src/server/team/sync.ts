// Row sync for team workspaces. Clients pull by cursor and push with the version they last saw: compare-and-swap, so a
// stale client can't overwrite a newer decision. Row locks and transaction-scoped advisory locks only, never session
// locks, because DATABASE_URL goes through a connection pooler.
import type { PoolClient } from "pg";
import { hashJson } from "@/engine/hash";
import { checkChange, isSyncedTable, MAX_ROW_BYTES, type Actor } from "@/lib/team-rules";
import type { Hallmark, HallmarkBody, Submission } from "@/lib/types";
import { submissionMoveProblem } from "@/lib/policy";
import { database } from "../db";

export interface Change {
  tbl: string;
  rowId: string;
  base: number;
  data: Record<string, unknown> | null;
}

export type ChangeResult = { tbl: string; rowId: string; ok: true; version: number; data: unknown } | { tbl: string; rowId: string; ok: false; problem: string; version: number; data: unknown; deleted: boolean };

async function inTransaction<T>(run: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await database()!.connect();
  try {
    await client.query("BEGIN");
    const out = await run(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const PAGE = 200;

export async function pull(workspaceId: string, cursor: number) {
  const { rows } = await database()!.query<{ tbl: string; row_id: string; data: unknown; version: number; seq: string; deleted: boolean }>(
    "SELECT tbl, row_id, data, version, seq, deleted FROM team_rows WHERE workspace_id = $1 AND seq > $2 ORDER BY seq LIMIT $3",
    [workspaceId, cursor, PAGE + 1],
  );
  const page = rows.slice(0, PAGE);
  return {
    rows: page.map((r) => ({ tbl: r.tbl, rowId: r.row_id, data: r.data, version: r.version, seq: Number(r.seq), deleted: r.deleted })),
    cursor: page.length ? Number(page[page.length - 1].seq) : cursor,
    more: rows.length > PAGE,
  };
}

async function submissionOf(c: PoolClient, workspaceId: string, tbl: string, rowId: string, data: Record<string, unknown> | null, before: Record<string, unknown> | null) {
  const id = tbl === "submissions" ? rowId : ((data?.submissionId ?? before?.submissionId) as string | undefined);
  if (!id) return null;
  const { rows } = await c.query<{ data: Submission }>("SELECT data FROM team_rows WHERE workspace_id = $1 AND tbl = 'submissions' AND row_id = $2 AND NOT deleted", [workspaceId, id]);
  return rows[0]?.data ?? null;
}

/** Applies a batch in order, each row on its own terms: one refused row doesn't undo the others. */
export async function push(workspaceId: string, actor: Actor, changes: Change[]): Promise<ChangeResult[]> {
  const results: ChangeResult[] = [];
  for (const change of changes) results.push(await inTransaction((c) => applyChange(c, workspaceId, actor, change)));
  return results;
}

async function applyChange(c: PoolClient, workspaceId: string, actor: Actor, change: Change): Promise<ChangeResult> {
  const { tbl, rowId, base } = change;
  const refuse = (problem: string, version = 0, data: unknown = null, deleted = true): ChangeResult => ({ tbl, rowId, ok: false, problem, version, data, deleted });
  if (!isSyncedTable(tbl)) return refuse("That table doesn't sync.");
  if (change.data && JSON.stringify(change.data).length > MAX_ROW_BYTES) return refuse("That record is too large to sync.");

  const { rows } = await c.query<{ data: Record<string, unknown> | null; version: number; deleted: boolean }>("SELECT data, version, deleted FROM team_rows WHERE workspace_id = $1 AND tbl = $2 AND row_id = $3 FOR UPDATE", [workspaceId, tbl, rowId]);
  const current = rows[0];
  if (current && current.version !== base) return refuse("Someone else changed this first.", current.version, current.data, current.deleted);
  if (!current && base !== 0) return refuse("This record no longer exists on the server.");

  const before = current && !current.deleted ? current.data : null;
  const submission = await submissionOf(c, workspaceId, tbl, rowId, change.data, before);
  const verdict = checkChange(tbl, before, change.data, actor, submission);
  if (!verdict.ok) return refuse(verdict.problem, current?.version ?? 0, current?.data ?? null, current?.deleted ?? true);

  let data = verdict.data ?? change.data;
  if (tbl === "rulebooks" && data) data = { ...data, hash: await hashJson(data.snapshot) };
  const version = (current?.version ?? 0) + 1;
  await c.query(
    `INSERT INTO team_rows (workspace_id, tbl, row_id, data, version, seq, deleted) VALUES ($1, $2, $3, $4, $5, nextval('team_seq'), $6)
     ON CONFLICT (workspace_id, tbl, row_id) DO UPDATE SET data = EXCLUDED.data, version = EXCLUDED.version, seq = EXCLUDED.seq, deleted = EXCLUDED.deleted`,
    [workspaceId, tbl, rowId, data ? JSON.stringify(data) : null, version, !data],
  );
  return { tbl, rowId, ok: true, version, data };
}

export type HallmarkResult = { ok: true; hallmark: Hallmark; submission: Submission; versions: { hallmark: number; submission: number } } | { ok: false; status: 403 | 409; problem: string };

/**
 * Issues a Hallmark. One at a time per workspace: the chain must extend the newest record, or the client is told to
 * catch up and seal again. The number is assigned here, and the hash is recomputed, so a client can't claim either.
 */
export async function issueHallmark(workspaceId: string, actor: Actor, body: HallmarkBody, id: string): Promise<HallmarkResult> {
  if (actor.role !== "reviewer" && actor.role !== "admin") return { ok: false, status: 403, problem: "Only a reviewer can approve." };
  return inTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hallmark:${workspaceId}`]);
    const { rows: sub } = await c.query<{ data: Submission; version: number }>("SELECT data, version FROM team_rows WHERE workspace_id = $1 AND tbl = 'submissions' AND row_id = $2 AND NOT deleted FOR UPDATE", [workspaceId, body.submissionId]);
    if (!sub[0]) return { ok: false, status: 409, problem: "The server hasn't received this draft yet. Try again in a moment." };
    const problem = submissionMoveProblem("reviewer", sub[0].data.status, "approved");
    if (problem) return { ok: false, status: 403, problem };
    const { rows: waiting } = await c.query("SELECT 1 FROM team_rows WHERE workspace_id = $1 AND tbl = 'findings' AND NOT deleted AND data->>'submissionId' = $2 AND data->>'status' = 'sent_to_compliance' LIMIT 1", [workspaceId, body.submissionId]);
    if (waiting.length) return { ok: false, status: 403, problem: "Compliance still has claims to decide." };
    const { rows: last } = await c.query<{ data: Hallmark }>("SELECT data FROM team_rows WHERE workspace_id = $1 AND tbl = 'hallmarks' AND NOT deleted ORDER BY (data->>'seq')::int DESC LIMIT 1", [workspaceId]);
    const prevHash = last[0]?.data.hash;
    if (prevHash ? body.prevHash !== prevHash : !/^0+$/.test(body.prevHash)) return { ok: false, status: 409, problem: "Another Hallmark was issued first." };
    const hallmark: Hallmark = { ...body, id, seq: (last[0]?.data.seq ?? 0) + 1, hash: await hashJson(body) };
    await c.query("INSERT INTO team_rows (workspace_id, tbl, row_id, data, version, seq) VALUES ($1, 'hallmarks', $2, $3, 1, nextval('team_seq'))", [workspaceId, id, JSON.stringify(hallmark)]);
    const submission: Submission = { ...sub[0].data, status: "approved", updatedAt: body.issuedAt };
    const version = sub[0].version + 1;
    await c.query("UPDATE team_rows SET data = $1, version = $2, seq = nextval('team_seq') WHERE workspace_id = $3 AND tbl = 'submissions' AND row_id = $4", [JSON.stringify(submission), version, workspaceId, body.submissionId]);
    return { ok: true, hallmark, submission, versions: { hallmark: 1, submission: version } };
  });
}

// ---- Files. In chunks, because Vercel caps a request and a response at 4.5 MB. ----------

export const CHUNK_CHARS = 3 * 1024 * 1024;
const MAX_WORKSPACE_FILE_CHARS = 200 * 1024 * 1024;

export async function putChunk(workspaceId: string, hash: string, idx: number, total: number, data: string): Promise<string | null> {
  const db = database()!;
  const { rows } = await db.query<{ used: string }>("SELECT coalesce(sum(length(data)), 0) used FROM team_blob_chunks WHERE workspace_id = $1", [workspaceId]);
  if (Number(rows[0].used) + data.length > MAX_WORKSPACE_FILE_CHARS) return "This workspace has used its file storage.";
  await db.query("INSERT INTO team_blob_chunks (workspace_id, hash, idx, total, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING", [workspaceId, hash, idx, total, data]);
  return null;
}

export async function getChunk(workspaceId: string, hash: string, idx: number) {
  const { rows } = await database()!.query<{ total: number; data: string }>("SELECT total, data FROM team_blob_chunks WHERE workspace_id = $1 AND hash = $2 AND idx = $3", [workspaceId, hash, idx]);
  return rows[0] ?? null;
}

export async function hasBlob(workspaceId: string, hash: string): Promise<boolean> {
  const { rows } = await database()!.query<{ n: number; total: number }>("SELECT count(*)::int n, max(total) total FROM team_blob_chunks WHERE workspace_id = $1 AND hash = $2", [workspaceId, hash]);
  return rows[0].n > 0 && rows[0].n === rows[0].total;
}

export async function exportRows(workspaceId: string) {
  const { rows } = await database()!.query("SELECT tbl, row_id, data, version FROM team_rows WHERE workspace_id = $1 AND NOT deleted ORDER BY seq", [workspaceId]);
  return rows;
}
