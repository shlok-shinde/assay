// The demo's one real email: a fact-expiry alert a visitor sends to themselves. The template is fixed and
// the facts are the seeded ones, so nobody can use this to send their own words to anyone. It is limited to
// 2 per IP and 1 per address per day, and 20 in total. Limits live in Postgres when there is one, because each
// serverless instance has its own memory; without it they are per instance. Only hashes of IPs and addresses are stored.
import { createHash } from "node:crypto";
import { z } from "zod";
import { VELVRA_FACTS } from "@/seed/velvra";
import { database, ensureTable } from "./db";

export const DEMO_LIMITS = { perIp: 2, perAddress: 1, global: 20 };

export const demoAlertInput = z.object({ factId: z.string().max(20), email: z.string().trim().email().max(200) });

export function alertEmail(factId: string, today: string) {
  const fact = VELVRA_FACTS.find((f) => f.id === factId);
  if (!fact?.validTo) return null;
  const days = Math.round((Date.parse(fact.validTo) - Date.parse(today)) / 86_400_000);
  const when = days < 0 ? `expired ${-days} day${days === -1 ? "" : "s"} ago` : days === 0 ? "expires today" : `expires in ${days} day${days === 1 ? "" : "s"}`;
  return {
    subject: `Claim Ledger: ${fact.id} ${when}`,
    text: [
      `This is a demo of Assay, a brand-governance tool. Velvra is a fictional brand. You asked for this email yourself on the Assay site, and it was sent once.`,
      ``,
      `${fact.id}: ${fact.statement}`,
      `Owner: ${fact.owner}. Source: ${fact.source}.`,
      `Valid to ${fact.validTo}, so it ${when}.`,
      ``,
      `A real owner would renew this fact or retire it. Until then, drafts that use it get a finding.`,
    ].join("\n"),
  };
}

const hash = (s: string) => createHash("sha256").update(`assay-demo:${s}`).digest("hex");
const memory: { day: string; ip: string; address: string }[] = [];

/** Counts this send against the limits and records it, or says which limit stopped it. */
export async function claimDemoSend(ip: string, address: string, day: string): Promise<"ok" | "ip" | "address" | "global"> {
  const [i, a] = [hash(ip), hash(address.toLowerCase())];
  const db = database();
  if (!db) {
    const today = memory.filter((m) => m.day === day);
    if (today.length >= DEMO_LIMITS.global) return "global";
    if (today.filter((m) => m.ip === i).length >= DEMO_LIMITS.perIp) return "ip";
    if (today.some((m) => m.address === a)) return "address";
    memory.push({ day, ip: i, address: a });
    return "ok";
  }
  await ensureTable("demo_sends", "CREATE TABLE IF NOT EXISTS demo_sends (day date NOT NULL, ip text NOT NULL, address text NOT NULL, at timestamptz NOT NULL DEFAULT now())");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Row-free serialisation for this one counter. Transaction-scoped, so it is safe on a pooled connection.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('demo_sends'))");
    const { rows } = await client.query<{ total: number; by_ip: number; by_address: number }>(
      "SELECT count(*)::int total, count(*) FILTER (WHERE ip = $2)::int by_ip, count(*) FILTER (WHERE address = $3)::int by_address FROM demo_sends WHERE day = $1",
      [day, i, a],
    );
    const { total, by_ip, by_address } = rows[0];
    const stop = total >= DEMO_LIMITS.global ? "global" : by_ip >= DEMO_LIMITS.perIp ? "ip" : by_address >= DEMO_LIMITS.perAddress ? "address" : null;
    if (!stop) await client.query("INSERT INTO demo_sends (day, ip, address) VALUES ($1, $2, $3)", [day, i, a]);
    await client.query("COMMIT");
    return stop ?? "ok";
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
