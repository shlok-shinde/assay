import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { hasDatabase } from "@/server/db";
import { allLabels, labelInput, labelProgress, saveLabel } from "@/server/labels";
import { allow, clientIp } from "@/server/ratelimit";

const noStore = { "cache-control": "no-store" };

function isOwner(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

/** A labeller's progress. With the deployment's secret and ?export=1, every answer, for golden/labels/. */
export async function GET(request: Request) {
  await connection();
  if (!hasDatabase()) return Response.json({ enabled: false }, { headers: noStore });
  const url = new URL(request.url);
  if (url.searchParams.get("export")) {
    if (!isOwner(request)) return Response.json({ enabled: true, message: "Not allowed." }, { status: 401, headers: noStore });
    return Response.json({ enabled: true, answers: await allLabels() }, { headers: noStore });
  }
  const coder = url.searchParams.get("coder") ?? "";
  if (!/^[a-z0-9-]{4,40}$/.test(coder)) return Response.json({ enabled: true, counts: {}, mine: [] }, { headers: noStore });
  return Response.json({ enabled: true, ...(await labelProgress(coder)) }, { headers: noStore });
}

export async function POST(request: Request) {
  if (!hasDatabase()) return Response.json({ ok: false, reason: "off", message: "Answers can't be saved here. Use Download my answers." }, { status: 503 });
  if (!allow(`label:${clientIp(request.headers)}`, 60)) return Response.json({ ok: false, reason: "throttled", message: "Too fast. Wait a moment." }, { status: 429 });
  const parsed = labelInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "bad_request", message: "That answer doesn't match this set of drafts." }, { status: 400 });
  await saveLabel(parsed.data);
  return Response.json({ ok: true });
}
