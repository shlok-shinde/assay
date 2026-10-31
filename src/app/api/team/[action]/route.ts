// Team workspaces. Off unless the deployment has a database: every action then says so and nothing connects.
import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { z } from "zod";
import { database, hasDatabase } from "@/server/db";
import { emailEnabled, sendEmail } from "@/server/email";
import { clientIp } from "@/server/ratelimit";
import { clearCookie, consumeLink, createLink, createSession, membership, memberships, revokeSession, sessionCookie, sessionEmail, underLimit, type Membership } from "@/server/team/auth";
import { ensureTeamSchema } from "@/server/team/schema";
import { CHUNK_CHARS, exportRows, getChunk, hasBlob, issueHallmark, pull, push, putChunk } from "@/server/team/sync";
import type { HallmarkBody, Role } from "@/lib/types";

const noStore = { "cache-control": "no-store" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...noStore, ...headers } });
const problem = (message: string, status = 400) => json({ ok: false, message }, status);

const ROLE = z.enum(["creator", "reviewer", "compliance", "admin"]);
const EMAIL = z.string().trim().toLowerCase().email().max(200);
const NAME = z.string().trim().min(1).max(80);

const origin = (request: Request) => process.env.APP_ORIGIN || new URL(request.url).origin;
const secure = (request: Request) => origin(request).startsWith("https:");

/** Writes need a same-origin browser request, so another site can't act with someone's cookie. */
function sameOrigin(request: Request) {
  const from = request.headers.get("origin");
  if (!from) return false;
  try {
    const host = new URL(from).host;
    return host === new URL(request.url).host || host === new URL(origin(request)).host;
  } catch {
    return false;
  }
}

/** Test runs read the link from the response. Never on a real deployment, whatever the variable says. */
const showLinks = () => process.env.TEAM_TEST_LINKS === "1" && !process.env.VERCEL;

async function deliver(request: Request, email: string, token: string, subject: string, intro: string) {
  const link = `${origin(request)}/team/verify#${token}`;
  if (emailEnabled()) await sendEmail(email, subject, `${intro}\n\n${link}\n\nThis link works once and expires in 30 minutes. If you weren't expecting it, you can ignore this email.`);
  return showLinks() ? { testLink: link } : {};
}

const canDeliver = () => emailEnabled() || showLinks();

/** The signed-in member, and the role they act as: an admin may take any desk, everyone else only their own. */
async function acting(request: Request, workspaceId: string): Promise<{ email: string; member: Membership; role: Role } | Response> {
  const email = await sessionEmail(request);
  if (!email) return problem("Sign in first.", 401);
  const member = await membership(email, workspaceId);
  if (!member) return problem("You aren't a member of this workspace.", 403);
  const asked = ROLE.safeParse(request.headers.get("x-assay-role"));
  return { email, member, role: member.role === "admin" && asked.success ? asked.data : member.role };
}

export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  await connection();
  const { action } = await params;
  if (!hasDatabase()) return json({ enabled: false, email: false });
  await ensureTeamSchema();
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace") ?? "";

  if (action === "status") {
    const email = await sessionEmail(request);
    return json({ enabled: true, email: canDeliver(), signedIn: email, workspaces: email ? await memberships(email) : [] });
  }
  const who = await acting(request, workspaceId);
  if (who instanceof Response) return who;

  if (action === "sync") return json({ ok: true, role: who.member.role, name: who.member.name, ...(await pull(workspaceId, Number(url.searchParams.get("cursor")) || 0)) });
  if (action === "blob") {
    const hash = url.searchParams.get("hash") ?? "";
    if (url.searchParams.has("exists")) return json({ ok: true, exists: await hasBlob(workspaceId, hash) });
    const chunk = await getChunk(workspaceId, hash, Number(url.searchParams.get("idx")) || 0);
    return chunk ? json({ ok: true, ...chunk }) : problem("No such file.", 404);
  }
  if (action === "members") {
    const { rows } = await database()!.query("SELECT email, name, role FROM team_members WHERE workspace_id = $1 ORDER BY joined_at", [workspaceId]);
    return json({ ok: true, members: rows });
  }
  if (action === "export") {
    if (who.member.role !== "admin") return problem("Only a Brand Admin can export the workspace.", 403);
    return json({ ok: true, workspace: who.member.workspaceName, rows: await exportRows(workspaceId) });
  }
  return problem("Unknown action.", 404);
}

const startInput = z.object({ email: EMAIL, name: NAME, workspaceName: NAME });
const signinInput = z.object({ email: EMAIL });
const verifyInput = z.object({ token: z.string().min(20).max(100) });
const inviteInput = z.object({ workspaceId: z.string(), email: EMAIL, name: NAME, role: ROLE });
const pushInput = z.object({ workspaceId: z.string(), changes: z.array(z.object({ tbl: z.string().max(30), rowId: z.string().max(200), base: z.number().int().min(0), data: z.record(z.string(), z.unknown()).nullable() })).max(200) });
const hallmarkInput = z.object({ workspaceId: z.string(), id: z.string().max(100), body: z.looseObject({ submissionId: z.string(), prevHash: z.string(), issuedAt: z.string() }) });
const chunkInput = z.object({ workspaceId: z.string(), hash: z.string().regex(/^[0-9a-f]{64}$/), idx: z.number().int().min(0).max(100), total: z.number().int().min(1).max(100), data: z.string().max(CHUNK_CHARS) });

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  await connection();
  const { action } = await params;
  if (!hasDatabase()) return problem("Team workspaces aren't set up on this deployment.", 503);
  if (!sameOrigin(request)) return problem("This request came from another site.", 403);
  await ensureTeamSchema();
  const body = await request.json().catch(() => null);
  const ip = clientIp(request.headers);

  if (action === "start") {
    const input = startInput.safeParse(body);
    if (!input.success) return problem("Give a workspace name, your name and a valid email address.");
    if (!canDeliver()) return problem("Email isn't set up on this deployment, so sign-in links can't be sent.", 503);
    if (!(await underLimit(`start:${ip}`, 5, 60)) || !(await underLimit(`mail:${input.data.email}`, 5, 60))) return problem("Too many requests. Try again in an hour.", 429);
    const token = await createLink({ purpose: "create", email: input.data.email, name: input.data.name, workspaceName: input.data.workspaceName });
    return json({ ok: true, ...(await deliver(request, input.data.email, token, `Create your Assay workspace: ${input.data.workspaceName}`, "Open this link to create the workspace and sign in:")) });
  }
  if (action === "signin") {
    const input = signinInput.safeParse(body);
    if (!input.success) return problem("Give a valid email address.");
    if (!canDeliver()) return problem("Email isn't set up on this deployment, so sign-in links can't be sent.", 503);
    if (!(await underLimit(`signin:${ip}`, 10, 60)) || !(await underLimit(`mail:${input.data.email}`, 5, 60))) return problem("Too many requests. Try again in an hour.", 429);
    // The same answer whether or not the address is a member, so this can't be used to find out who is.
    let extra = {};
    if ((await memberships(input.data.email)).length) {
      const token = await createLink({ purpose: "signin", email: input.data.email });
      extra = await deliver(request, input.data.email, token, "Sign in to Assay", "Open this link to sign in:");
    }
    return json({ ok: true, ...extra });
  }
  if (action === "verify") {
    const input = verifyInput.safeParse(body);
    if (!input.success) return problem("That link isn't valid.");
    if (!(await underLimit(`verify:${ip}`, 30, 15))) return problem("Too many tries. Wait a few minutes.", 429);
    const link = await consumeLink(input.data.token);
    if (!link) return problem("That link has expired or was already used. Ask for a new one.", 410);
    let workspaceId = link.workspace_id;
    if (link.purpose === "create") {
      workspaceId = randomUUID();
      await database()!.query("INSERT INTO team_workspaces (id, name) VALUES ($1, $2)", [workspaceId, link.workspace_name]);
      await database()!.query("INSERT INTO team_members (workspace_id, email, name, role) VALUES ($1, $2, $3, 'admin')", [workspaceId, link.email, link.name]);
    } else if (link.purpose === "invite") {
      await database()!.query("INSERT INTO team_members (workspace_id, email, name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, email) DO UPDATE SET role = EXCLUDED.role", [workspaceId, link.email, link.name, link.role]);
    }
    const session = await createSession(link.email);
    return json({ ok: true, email: link.email, workspaces: await memberships(link.email), joined: workspaceId }, 200, { "set-cookie": sessionCookie(session, secure(request)) });
  }
  if (action === "signout") {
    await revokeSession(request);
    return json({ ok: true }, 200, { "set-cookie": clearCookie(secure(request)) });
  }

  const workspaceId = (body as { workspaceId?: unknown } | null)?.workspaceId;
  if (typeof workspaceId !== "string") return problem("Which workspace?");
  const who = await acting(request, workspaceId);
  if (who instanceof Response) return who;
  const actor = { role: who.role, name: who.member.name };

  if (action === "sync") {
    const input = pushInput.safeParse(body);
    if (!input.success) return problem("That update isn't valid.");
    return json({ ok: true, results: await push(workspaceId, actor, input.data.changes) });
  }
  if (action === "hallmark") {
    const input = hallmarkInput.safeParse(body);
    if (!input.success) return problem("That Hallmark isn't valid.");
    const result = await issueHallmark(workspaceId, actor, input.data.body as unknown as HallmarkBody, input.data.id);
    return result.ok ? json(result) : json(result, result.status);
  }
  if (action === "blob") {
    const input = chunkInput.safeParse(body);
    if (!input.success) return problem("That file part isn't valid.");
    const refused = await putChunk(workspaceId, input.data.hash, input.data.idx, input.data.total, input.data.data);
    return refused ? problem(refused, 413) : json({ ok: true });
  }
  if (action === "invite") {
    const input = inviteInput.safeParse(body);
    if (!input.success) return problem("Give a name, a valid email address and a role.");
    if (who.member.role !== "admin") return problem("Only a Brand Admin can invite people.", 403);
    if (!canDeliver()) return problem("Email isn't set up on this deployment, so invitations can't be sent.", 503);
    if (!(await underLimit(`invite:${workspaceId}`, 30, 60 * 24))) return problem("That's the most invitations for today.", 429);
    const token = await createLink({ purpose: "invite", email: input.data.email, name: input.data.name, role: input.data.role, workspaceId });
    return json({ ok: true, ...(await deliver(request, input.data.email, token, `Join ${who.member.workspaceName} on Assay`, `${who.member.name} invited you to review brand content in ${who.member.workspaceName}. Open this link to join:`)) });
  }
  if (action === "remove-member") {
    const input = signinInput.safeParse(body);
    if (!input.success) return problem("Which address?");
    if (who.member.role !== "admin") return problem("Only a Brand Admin can remove people.", 403);
    if (input.data.email === who.email) return problem("You can't remove yourself.");
    await database()!.query("DELETE FROM team_members WHERE workspace_id = $1 AND email = $2", [workspaceId, input.data.email]);
    return json({ ok: true });
  }
  if (action === "delete-workspace") {
    if (who.member.role !== "admin") return problem("Only a Brand Admin can delete the workspace.", 403);
    await database()!.query("DELETE FROM team_workspaces WHERE id = $1", [workspaceId]);
    return json({ ok: true });
  }
  return problem("Unknown action.", 404);
}
