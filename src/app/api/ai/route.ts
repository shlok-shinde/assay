import { runTask } from "@/server/ai/run";
import { sharedPool } from "@/server/ai/keys";
import { allow, clientIp } from "@/server/ratelimit";

export async function POST(request: Request) {
  if (!allow(clientIp(request.headers))) {
    return Response.json({ ok: false, reason: "throttled", message: "Too many AI requests from this address; wait a minute." }, { status: 429 });
  }
  let body: { task?: unknown; input?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "bad_request", message: "Body must be JSON" }, { status: 400 });
  }
  if (typeof body.task !== "string") return Response.json({ ok: false, reason: "bad_request", message: "Missing task" }, { status: 400 });
  const result = await runTask(body.task, body.input, sharedPool());
  const status = result.ok ? 200 : result.reason === "bad_request" ? 400 : result.reason === "too_large" ? 413 : 200;
  return Response.json(result, { status, headers: { "cache-control": "no-store" } });
}
