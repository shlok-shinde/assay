// Sign-in for team workspaces: single-use links by email, stored only as hashes, and opaque sessions in Postgres so
// they can be revoked. The link opens a page that POSTs on a button click, so a mail scanner that fetches every link
// can't use it up. Limits live in Postgres because each serverless instance has its own memory.
import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@/lib/types";
import { database } from "../db";

const LINK_MINUTES = 30;
const SESSION_DAYS = 30;
export const COOKIE = "assay_team";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

export type LinkPurpose = "create" | "signin" | "invite";

export interface LinkInput {
  email: string;
  purpose: LinkPurpose;
  workspaceId?: string;
  workspaceName?: string;
  name?: string;
  role?: Role;
}

export async function createLink(input: LinkInput): Promise<string> {
  const token = newToken();
  await database()!.query(
    `INSERT INTO team_links (token_hash, email, purpose, workspace_id, workspace_name, name, role, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '${LINK_MINUTES} minutes')`,
    [hash(token), input.email.toLowerCase(), input.purpose, input.workspaceId ?? null, input.workspaceName ?? null, input.name ?? null, input.role ?? null],
  );
  return token;
}

/** Uses up a link, once. The UPDATE decides, so two clicks can't both succeed. */
export async function consumeLink(token: string) {
  const { rows } = await database()!.query<{ email: string; purpose: LinkPurpose; workspace_id: string | null; workspace_name: string | null; name: string | null; role: Role | null }>(
    "UPDATE team_links SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email, purpose, workspace_id, workspace_name, name, role",
    [hash(token)],
  );
  return rows[0] ?? null;
}

export async function createSession(email: string): Promise<string> {
  const token = newToken();
  await database()!.query(`INSERT INTO team_sessions (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [hash(token), email.toLowerCase()]);
  return token;
}

export const sessionCookie = (token: string, secure: boolean) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? "; Secure" : ""}`;
export const clearCookie = (secure: boolean) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

export function sessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || null;
}

/** The signed-in address, or null. Checked on every request, so revoking takes effect at once. */
export async function sessionEmail(request: Request): Promise<string | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const { rows } = await database()!.query<{ email: string }>("SELECT email FROM team_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()", [hash(token)]);
  return rows[0]?.email ?? null;
}

export async function revokeSession(request: Request) {
  const token = sessionToken(request);
  if (token) await database()!.query("UPDATE team_sessions SET revoked_at = now() WHERE token_hash = $1", [hash(token)]);
}

export interface Membership {
  workspaceId: string;
  workspaceName: string;
  name: string;
  role: Role;
}

export async function memberships(email: string): Promise<Membership[]> {
  const { rows } = await database()!.query<{ id: string; ws: string; name: string; role: Role }>(
    "SELECT w.id, w.name ws, m.name, m.role FROM team_members m JOIN team_workspaces w ON w.id = m.workspace_id WHERE m.email = $1 ORDER BY m.joined_at",
    [email],
  );
  return rows.map((r) => ({ workspaceId: r.id, workspaceName: r.ws, name: r.name, role: r.role }));
}

export async function membership(email: string, workspaceId: string): Promise<Membership | null> {
  return (await memberships(email)).find((m) => m.workspaceId === workspaceId) ?? null;
}

/** Counts against a limit, in Postgres. False when it is used up. */
export async function underLimit(key: string, limit: number, windowMinutes: number): Promise<boolean> {
  const { rows } = await database()!.query<{ n: number }>(
    `INSERT INTO team_limits (key, window_start, n) VALUES ($1, to_timestamp(floor(extract(epoch from now()) / ($2::int * 60)) * ($2::int * 60)), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET n = team_limits.n + 1 RETURNING n`,
    [hash(key), windowMinutes],
  );
  return rows[0].n <= limit;
}
