import { connection } from "next/server";
import { alertEmail, claimDemoSend, demoAlertInput } from "@/server/demo-alert";
import { emailEnabled, sendEmail } from "@/server/email";
import { clientIp } from "@/server/ratelimit";

const STOPPED = {
  ip: "This address has sent its two demo emails today.",
  address: "That inbox has already had its demo email today.",
  global: "The demo has sent all of today's emails. Try again tomorrow.",
};

export async function GET() {
  await connection();
  return Response.json({ enabled: emailEnabled() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!emailEnabled()) return Response.json({ ok: false, reason: "off", message: "Email is not set up on this deployment." }, { status: 503 });
  // Only this site's own page may ask.
  const origin = request.headers.get("origin");
  const allowed = process.env.APP_ORIGIN ?? new URL(request.url).origin;
  if (origin !== allowed) return Response.json({ ok: false, reason: "origin", message: "Send this from the Assay site." }, { status: 403 });
  const parsed = demoAlertInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "bad_request", message: "Enter a valid email address." }, { status: 400 });
  const today = new Date().toISOString().slice(0, 10);
  const mail = alertEmail(parsed.data.factId, today);
  if (!mail) return Response.json({ ok: false, reason: "bad_request", message: "That fact has no expiry date." }, { status: 400 });
  const claim = await claimDemoSend(clientIp(request.headers), parsed.data.email, today);
  if (claim !== "ok") return Response.json({ ok: false, reason: "limit", message: STOPPED[claim] }, { status: 429 });
  try {
    await sendEmail(parsed.data.email, mail.subject, mail.text);
  } catch (e) {
    console.error("Demo alert failed", (e as Error).message);
    return Response.json({ ok: false, reason: "send", message: "The mail server refused this one. Nothing was sent." }, { status: 502 });
  }
  return Response.json({ ok: true, subject: mail.subject });
}
