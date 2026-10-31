// The browser side of a team workspace: sign-in calls, and the loop that keeps this browser's copy in step with the
// server. Pushes what changed here with the version last seen, pulls by cursor every few seconds while the tab is in
// view, and takes the server's row whenever it refuses one. Loaded only for team workspaces, so the demo never runs it.
import type { Hallmark, HallmarkBody, Role, Submission } from "@/lib/types";
import { isSyncedTable, type SyncedTable } from "@/lib/team-rules";
import { activeBrand, addTeamBrand, type Brand } from "./brands";
import { CHANGED_EVENT, FROM_SERVER } from "./capture";
import { db, withLock } from "./db";

export interface TeamStatus {
  enabled: boolean;
  email: boolean;
  signedIn?: string | null;
  workspaces?: { workspaceId: string; workspaceName: string; name: string; role: Role }[];
}

const api = (action: string, query = "") => `/api/team/${action}${query}`;

async function post<T>(action: string, body: unknown, role?: Role): Promise<T & { ok: boolean; message?: string }> {
  const r = await fetch(api(action), { method: "POST", headers: { "content-type": "application/json", ...(role ? { "x-assay-role": role } : {}) }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, message: "The server sent an unreadable answer." }))) as T & { ok: boolean; message?: string };
}

const failIfRefused = <T extends { ok: boolean; message?: string }>(r: T) => {
  if (!r.ok) throw new Error(r.message ?? "That didn't work.");
  return r;
};

export const teamStatus = (): Promise<TeamStatus> => fetch(api("status"), { cache: "no-store" }).then((r) => r.json() as Promise<TeamStatus>);
export const startWorkspace = async (workspaceName: string, name: string, email: string) => failIfRefused(await post<{ testLink?: string }>("start", { workspaceName, name, email }));
export const requestSignIn = async (email: string) => failIfRefused(await post<{ testLink?: string }>("signin", { email }));
export const signOut = async () => failIfRefused(await post("signout", {}));
export const invite = async (email: string, name: string, role: Role) => failIfRefused(await post<{ testLink?: string }>("invite", { workspaceId: team().workspaceId, email, name, role }));
export const removeMember = async (email: string) => failIfRefused(await post("remove-member", { workspaceId: team().workspaceId, email }));
export const deleteWorkspace = async () => failIfRefused(await post("delete-workspace", { workspaceId: team().workspaceId }));
export const listMembers = async () =>
  failIfRefused((await (await fetch(api("members", `?workspace=${team().workspaceId}`), { cache: "no-store" })).json()) as { ok: boolean; message?: string; members: { email: string; name: string; role: Role }[] }).members;
export const exportTeamWorkspace = async () => failIfRefused((await (await fetch(api("export", `?workspace=${team().workspaceId}`), { cache: "no-store" })).json()) as { ok: boolean; message?: string; workspace: string; rows: unknown[] });

/** Uses the emailed link, and returns the brand it opens. */
export async function verifyLink(token: string): Promise<Brand | null> {
  const r = failIfRefused(await post<{ workspaces: NonNullable<TeamStatus["workspaces"]>; joined: string | null }>("verify", { token }));
  const brands = r.workspaces.map((w) => addTeamBrand(w.workspaceId, w.workspaceName, w.name, w.role));
  return brands.find((b) => b.team?.workspaceId === r.joined) ?? brands[0] ?? null;
}

function team() {
  const t = activeBrand().team;
  if (!t) throw new Error("This isn't a team workspace.");
  return t;
}

// ---- Sync ----------------------------------------------------------------

export type SyncState = { phase: "synced" | "waiting" | "offline" | "signed-out"; waiting: number; refused?: string };
export const SYNC_EVENT = "assay:sync";

let state: SyncState = { phase: "waiting", waiting: 0 };
export const syncState = () => state;
const publish = (next: Partial<SyncState>) => {
  state = { ...state, ...next };
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: state }));
};

const versionKey = (tbl: string, rowId: string) => `${tbl}|${rowId}`;
const CURSOR = "cursor";
const PUSH_ROWS = 50;
const PUSH_CHARS = 3_500_000;
const CHUNK = 3_000_000;
const POLL_MS = 4000;

const currentRole = async () => ((await db.meta.get("role"))?.value as Role | undefined) ?? team().role;
const tableOf = (tbl: SyncedTable) => db[tbl] as unknown as { get(k: string): Promise<Record<string, unknown> | undefined> };

/** Writes rows from the server without noting them as local changes. */
async function applyFromServer(rows: { tbl: string; rowId: string; data: unknown; version: number; deleted?: boolean }[]) {
  const known = rows.filter((r) => isSyncedTable(r.tbl));
  if (!known.length) return;
  const tables = [...new Set(known.map((r) => r.tbl as SyncedTable))].map((t) => db[t]);
  await db.transaction("rw", [...tables, db.syncState], async (tx) => {
    (tx.idbtrans as unknown as Record<string, unknown>)[FROM_SERVER] = true;
    for (const r of known) {
      const table = db[r.tbl as SyncedTable] as unknown as { put(v: unknown): Promise<unknown>; delete(k: string): Promise<unknown> };
      if (r.deleted || !r.data) await table.delete(r.rowId);
      else await table.put(r.data);
      await db.syncState.put({ key: versionKey(r.tbl, r.rowId), value: r.version });
    }
  });
}

async function uploadBlob(hash: string, workspaceId: string, role: Role) {
  const known = versionKey("blob", hash);
  if (await db.syncState.get(known)) return;
  const row = await db.blobs.get(hash);
  if (!row) return;
  const total = Math.ceil(row.dataUrl.length / CHUNK) || 1;
  for (let idx = 0; idx < total; idx++) failIfRefused(await post("blob", { workspaceId, hash, idx, total, data: row.dataUrl.slice(idx * CHUNK, (idx + 1) * CHUNK) }, role));
  await db.syncState.put({ key: known, value: 1 });
}

async function downloadBlob(hash: string, workspaceId: string) {
  if (await db.blobs.get(hash)) return;
  let dataUrl = "";
  for (let idx = 0, total = 1; idx < total; idx++) {
    const r = await fetch(api("blob", `?workspace=${workspaceId}&hash=${hash}&idx=${idx}`), { cache: "no-store" });
    if (!r.ok) return;
    const part = (await r.json()) as { total: number; data: string };
    total = part.total;
    dataUrl += part.data;
  }
  await db.blobs.put({ hash, dataUrl, at: new Date().toISOString() });
}

const blobHashOf = (tbl: string, row: Record<string, unknown> | undefined): string | undefined =>
  tbl === "versions" ? (row?.image as { blob?: string } | undefined)?.blob : tbl === "books" ? (row?.blob as string | undefined) : undefined;

/** Sends everything waiting, in the order it happened. Refused rows are replaced by the server's copy, and the reason is reported. */
export async function pushChanges() {
  const { workspaceId } = team();
  const role = await currentRole();
  // Each round reports its own refusals, so the same one twice is said twice.
  if (state.refused) publish({ refused: undefined });
  for (;;) {
    const waiting = await db.syncRows.orderBy("seq").limit(PUSH_ROWS * 4).toArray();
    if (!waiting.length) break;
    publish({ waiting: await db.syncRows.count() });
    // Several writes to a row are one change: its state now.
    const seen = new Set<string>();
    const changes: { tbl: string; rowId: string; base: number; data: Record<string, unknown> | null }[] = [];
    let chars = 0;
    let lastSeq = 0;
    for (const w of waiting) {
      const k = versionKey(w.tbl, w.rowId);
      if (!seen.has(k)) {
        if (changes.length >= PUSH_ROWS) break;
        const data = isSyncedTable(w.tbl) ? ((await tableOf(w.tbl).get(w.rowId)) ?? null) : null;
        const size = data ? JSON.stringify(data).length : 0;
        if (changes.length && chars + size > PUSH_CHARS) break;
        const hash = blobHashOf(w.tbl, data ?? undefined);
        if (hash) await uploadBlob(hash, workspaceId, role);
        changes.push({ tbl: w.tbl, rowId: w.rowId, base: (await db.syncState.get(k))?.value ?? 0, data });
        seen.add(k);
        chars += size;
      }
      lastSeq = w.seq!;
    }
    const r = failIfRefused(await post<{ results: ({ tbl: string; rowId: string; ok: true; version: number; data: unknown } | { tbl: string; rowId: string; ok: false; problem: string; version: number; data: unknown; deleted: boolean })[] }>("sync", { workspaceId, changes }, role));
    const refused = r.results.find((x) => !x.ok);
    // The server may have filled in names and hashes, so its row replaces ours either way.
    await applyFromServer(r.results.map((x) => ({ tbl: x.tbl, rowId: x.rowId, data: x.data, version: x.version, deleted: x.ok ? !x.data : x.deleted || !x.data })));
    await db.syncRows.where("seq").belowOrEqual(lastSeq).delete();
    publish({ refused: refused && !refused.ok ? refused.problem : undefined, waiting: await db.syncRows.count() });
  }
}

/** Brings in everything newer than the cursor. Rows with a local change waiting are left for the push to settle. */
export async function pullChanges(): Promise<number> {
  const { workspaceId } = team();
  let applied = 0;
  for (;;) {
    const cursor = (await db.syncState.get(CURSOR))?.value ?? 0;
    const r = await fetch(api("sync", `?workspace=${workspaceId}&cursor=${cursor}`), { cache: "no-store" });
    if (r.status === 401) throw new SignedOut();
    if (r.status === 403) throw new SignedOut("You aren't a member of this workspace any more. Ask its Brand Admin to invite you again.");
    if (!r.ok) throw new Error("sync failed");
    const page = (await r.json()) as { rows: { tbl: string; rowId: string; data: Record<string, unknown> | null; version: number; deleted: boolean }[]; cursor: number; more: boolean; role: Role; name: string };
    if (page.role !== team().role || page.name !== team().name) addTeamBrand(workspaceId, activeBrand().name, page.name, page.role);
    const pending = new Set((await db.syncRows.toArray()).map((w) => versionKey(w.tbl, w.rowId)));
    for (const row of page.rows) {
      const hash = blobHashOf(row.tbl, row.data ?? undefined);
      if (hash) await downloadBlob(hash, workspaceId);
    }
    await applyFromServer(page.rows.filter((row) => !pending.has(versionKey(row.tbl, row.rowId))));
    await db.syncState.put({ key: CURSOR, value: page.cursor });
    applied += page.rows.length;
    if (!page.more) return applied;
  }
}

class SignedOut extends Error {
  constructor(message = "Sign in again to open this workspace.") {
    super(message);
  }
}

/** One round, one at a time across this browser's tabs for this workspace. */
export function syncNow(): Promise<void> {
  return withLock("sync", async () => {
    try {
      await pushChanges();
      await pullChanges();
      publish({ phase: "synced", waiting: await db.syncRows.count() });
    } catch (e) {
      publish({ phase: e instanceof SignedOut ? "signed-out" : "offline", waiting: await db.syncRows.count() });
    }
  });
}

let started = false;

/** Keeps syncing while the tab is in view. A local write goes out straight away rather than at the next tick. */
export function startSync() {
  if (started) return;
  started = true;
  const tick = () => {
    if (document.visibilityState === "visible") void syncNow();
  };
  window.setInterval(tick, POLL_MS);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("online", tick);
  window.addEventListener(CHANGED_EVENT, tick);
  tick();
}

/** A new browser's first look at a workspace: everything on the server, before anything shows. False if there's nothing yet. */
export async function bootstrapWorkspace(): Promise<boolean> {
  try {
    await pullChanges();
  } catch (e) {
    // Offline, this browser's own copy still opens, and the loop catches up later. A browser with no copy has nothing to show.
    if (e instanceof SignedOut || !(await db.kits.count())) throw e;
  }
  const meta = await db.meta.get("role");
  if (!meta || team().role !== "admin") await db.meta.put({ key: "role", value: team().role });
  return (await db.kits.count()) > 0;
}

/**
 * Asks the server to issue the Hallmark. It must extend the newest record, so on "another was first" this catches up and
 * returns null, and the caller seals again on the new newest. Everything waiting goes first, because the server checks
 * the workflow against what it has.
 */
export async function claimHallmark(body: HallmarkBody, id: string): Promise<Hallmark | null> {
  const { workspaceId } = team();
  // The same lock as the loop, so a tick can't send these rows a second time and collide with itself.
  return withLock("sync", async () => {
    await pushChanges();
    const r = await post<{ hallmark: Hallmark; submission: Submission; versions: { hallmark: number; submission: number }; status?: number; problem?: string }>("hallmark", { workspaceId, id, body }, await currentRole());
    if (r.ok) {
      await applyFromServer([
        { tbl: "hallmarks", rowId: r.hallmark.id, data: r.hallmark, version: r.versions.hallmark },
        { tbl: "submissions", rowId: r.submission.id, data: r.submission, version: r.versions.submission },
      ]);
      return r.hallmark;
    }
    if (/first/.test(r.problem ?? "")) {
      await pullChanges();
      return null;
    }
    throw new Error(r.problem ?? r.message ?? "The server refused this approval.");
  });
}
