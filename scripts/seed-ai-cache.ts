// pnpm seed:ai fills src/seed/ai-cache.json with real AI answers for the text of every sample, so a judge sees AI
// findings even when the AI is down or over its limit. Each entry keeps its model and date, and the app labels it
// as a saved result. It calls a deployment's own /api/ai at 15 calls a minute, so no key is needed here.
// Run it after the last change to the rulebook: a rule change alters the keys, and src/seed/ai-cache.test.ts fails.
import { writeFileSync } from "node:fs";
import { runCheck, type AiClient, type CacheStore, type SegmentCache } from "../src/engine/pipeline";
import type { AICacheEntry } from "../src/lib/types";
import { SAMPLES } from "../src/seed/samples";
import { VELVRA_KIT } from "../src/seed/velvra";

const FILE = "src/seed/ai-cache.json";
const BASE = process.env.ASSAY_URL ?? "https://assay-kappa-three.vercel.app";
const GAP_MS = 4000;

const entries = new Map<string, AICacheEntry>();
const cache: CacheStore = {
  async get(key) {
    const e = entries.get(key);
    return e ? { data: e.data as SegmentCache, model: e.model, at: e.at, seeded: true } : undefined;
  },
  async set(key, data, model) {
    entries.set(key, { key, task: "judge", model, at: new Date().toISOString(), data, seeded: true });
    writeFileSync(FILE, JSON.stringify([...entries.values()], null, 1) + "\n");
  },
};

let lastCall = 0;
const client: AiClient = {
  async judge(req) {
    const wait = lastCall + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    try {
      const r = await fetch(`${BASE}/api/ai`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "judge", input: req }) });
      const body = (await r.json()) as { ok: boolean; data?: never; model?: string; ms?: number; redactions?: number; message?: string };
      if (!body.ok) return { ok: false, reason: "error", message: body.message ?? "failed" };
      return { ok: true, data: body.data!, model: body.model!, ms: body.ms!, redactions: body.redactions! };
    } catch (e) {
      return { ok: false, reason: "offline", message: (e as Error).message };
    }
  },
};

async function main() {
  for (const s of SAMPLES) {
    const out = await runCheck({
      text: s.text,
      channel: s.channel,
      audience: s.audience,
      intent: { ...s.intent, confirmed: true, draftedBy: "creator" },
      kit: VELVRA_KIT,
      rulebookVersion: "3.2",
      confidential: false,
      today: new Date().toISOString().slice(0, 10),
      ai: client,
      cache,
    });
    console.log(`${s.id}: ${out.mode}, ${out.segmentsTotal} paragraphs, ${out.aiCalls} calls${out.banner ? `. ${out.banner}` : ""}`);
  }
  console.log(`${entries.size} entries in ${FILE}`);
}

void main();
