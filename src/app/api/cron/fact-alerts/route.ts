// The daily job. Hobby cron can fire late or twice and never retries, so each alert is claimed by a unique row before it
// is sent, and a row whose send failed is tried again on the next run. Mail goes to each owner as one digest.
import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { alertsDue, ownerId } from "@/engine/health";
import type { BrandKit, Owner } from "@/lib/types";
import { database, hasDatabase } from "@/server/db";
import { emailEnabled, sendEmail } from "@/server/email";
import { ensureTeamSchema } from "@/server/team/schema";

function authorised(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export async function GET(request: Request) {
  await connection();
  if (!authorised(request)) return Response.json({ ok: false }, { status: 401 });
  if (!hasDatabase() || !emailEnabled()) return Response.json({ ok: true, skipped: "No database or email on this deployment." });
  await ensureTeamSchema();
  const db = database()!;
  const today = new Date().toISOString().slice(0, 10);
  const { rows: kits } = await db.query<{ workspace_id: string; ws: string; data: BrandKit }>("SELECT r.workspace_id, w.name ws, r.data FROM team_rows r JOIN team_workspaces w ON w.id = r.workspace_id WHERE r.tbl = 'kits' AND NOT r.deleted");
  let sent = 0;
  let failed = 0;
  for (const { workspace_id: ws, ws: name, data: kit } of kits) {
    const { rows: ownerRows } = await db.query<{ data: Owner }>("SELECT data FROM team_rows WHERE workspace_id = $1 AND tbl = 'owners' AND NOT deleted", [ws]);
    const owners = new Map(ownerRows.map((o) => [o.data.id, o.data]));
    const digests = new Map<string, { key: string; line: string }[]>();
    for (const due of alertsDue(kit.facts, today)) {
      const owner = owners.get(ownerId(due.fact.owner));
      if (!owner?.email || owner.simulated) continue;
      await db.query("INSERT INTO team_alerts (workspace_id, key, owner_email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [ws, due.key, owner.email]);
      const { rows } = await db.query("SELECT 1 FROM team_alerts WHERE workspace_id = $1 AND key = $2 AND sent_at IS NULL", [ws, due.key]);
      if (!rows.length) continue;
      const list = digests.get(owner.email) ?? [];
      const when = due.daysLeft < 0 ? `expired ${-due.daysLeft} day(s) ago` : due.daysLeft === 0 ? "expires today" : `expires in ${due.daysLeft} day(s)`;
      list.push({ key: due.key, line: `${due.fact.id}: ${due.fact.statement} (${when}, valid to ${due.fact.validTo})` });
      digests.set(owner.email, list);
    }
    for (const [email, items] of digests) {
      try {
        await sendEmail(email, `${name}: ${items.length} Claim Ledger fact${items.length === 1 ? "" : "s"} need you`, [`You own these facts in ${name}'s Claim Ledger:`, "", ...items.map((i) => i.line), "", "Renew or retire each one. Until then, drafts that use an expired fact get a finding."].join("\n"));
        await db.query("UPDATE team_alerts SET sent_at = now() WHERE workspace_id = $1 AND key = ANY($2)", [ws, items.map((i) => i.key)]);
        sent += items.length;
      } catch {
        failed += items.length;
      }
    }
  }
  return Response.json({ ok: true, sent, failed }, { headers: { "cache-control": "no-store" } });
}
