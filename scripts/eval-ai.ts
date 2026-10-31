// pnpm eval:ai replays the recorded AI answers in golden/ai-predictions.json and scores rules only, AI only
// and combined, per category. pnpm eval:ai --record fills in whatever is missing by calling a deployment's own
// /api/ai at 15 calls a minute, so no key is ever needed locally. A draft with no recorded answer counts against
// coverage rather than being scored as if the AI had found nothing, and the output says how many that is.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { GOLDEN, goldenSplit, type GoldenDraft } from "../golden/drafts";
import { VELVRA_KIT } from "../src/seed/velvra";
import { draftIntent } from "../src/engine/fix";
import { runCheck, type AiClient, type CacheStore, type SegmentCache } from "../src/engine/pipeline";
import type { Category } from "../src/lib/types";

const FILE = "golden/ai-predictions.json";
const RECORD = process.argv.includes("--record");
const BASE = process.env.ASSAY_URL ?? "https://assay-kappa-three.vercel.app";
const TODAY = "2026-10-26";
const GAP_MS = 4000;

type Recorded = Record<string, { data: SegmentCache; model: string; at: string }>;
const recorded: Recorded = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};

const cache: CacheStore = {
  get: async (k) => recorded[k],
  async set(k, data, model) {
    recorded[k] = { data, model, at: new Date().toISOString() };
    writeFileSync(FILE, JSON.stringify(recorded, null, 1) + "\n");
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
/** In a replay nothing may leave the machine: a draft with no recording simply has no AI answer. */
const noCall: AiClient = { judge: async () => ({ ok: false, reason: "offline", message: "No recorded answer" }) };

const ruleOf = new Map(VELVRA_KIT.rules.map((r) => [r.id, r]));
const isJudged = (id: string) => !!ruleOf.get(id)?.modes.includes("judgment");

type Tally = Map<Category, { tp: number; fp: number; fn: number }>;
const bump = (t: Tally, id: string, k: "tp" | "fp" | "fn") => {
  const c = ruleOf.get(id)!.category;
  const s = t.get(c) ?? { tp: 0, fp: 0, fn: 0 };
  s[k]++;
  t.set(c, s);
};
const tally = (t: Tally, predicted: Set<string>, expected: Set<string>) => {
  for (const id of predicted) bump(t, id, expected.has(id) ? "tp" : "fp");
  for (const id of expected) if (!predicted.has(id)) bump(t, id, "fn");
};
const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null);
const rowsOf = (t: Tally) => {
  const rows = [...t.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([category, s]) => ({ category, ...s, precision: ratio(s.tp, s.tp + s.fp), recall: ratio(s.tp, s.tp + s.fn) }));
  const total = rows.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn }), { tp: 0, fp: 0, fn: 0 });
  return { rows, overall: { ...total, precision: ratio(total.tp, total.tp + total.fp), recall: ratio(total.tp, total.tp + total.fn) } };
};

async function run(drafts: GoldenDraft[]) {
  const rules: Tally = new Map();
  const ai: Tally = new Map();
  const combined: Tally = new Map();
  const models = new Set<string>();
  let answered = 0;
  const unanswered: string[] = [];
  for (const d of drafts) {
    const out = await runCheck({
      text: d.text,
      channel: d.channel,
      audience: "Everyday skincare buyers",
      intent: { ...draftIntent(d.text), confirmed: true },
      kit: VELVRA_KIT,
      rulebookVersion: "3.2",
      confidential: false,
      today: TODAY,
      ai: RECORD ? client : noCall,
      cache,
    });
    const expected = new Set(d.expect);
    const fromRules = new Set(out.findings.filter((f) => f.origin === "rule").flatMap((f) => [f.ruleId, ...f.relatedRuleIds]));
    tally(rules, new Set([...fromRules].filter((id) => !isJudged(id) || ruleOf.get(id)!.modes.length > 1)), new Set([...expected].filter((id) => ruleOf.get(id)!.modes.some((m) => m !== "judgment"))));
    if (out.mode !== "rules+ai") {
      unanswered.push(d.id);
      continue;
    }
    answered++;
    if (out.aiModel) models.add(out.aiModel);
    // A rule finding the AI agreed with carries the AI's confidence, so it counts as found by the AI too.
    const fromAi = new Set(out.findings.filter((f) => f.origin === "ai" || f.confidence !== undefined).flatMap((f) => [f.ruleId, ...(f.origin === "ai" ? f.relatedRuleIds : [])]));
    tally(ai, fromAi, new Set([...expected].filter(isJudged)));
    tally(combined, new Set(out.findings.flatMap((f) => [f.ruleId, ...f.relatedRuleIds])), expected);
  }
  return { drafts: drafts.length, answered, unanswered, models: [...models], rulesOnly: rowsOf(rules), aiOnly: rowsOf(ai), combined: rowsOf(combined) };
}

async function main() {
  const results = {
    ranAt: new Date().toISOString(),
    factsAsOf: TODAY,
    labels: "builder, with AI assistance",
    note: "AI-only is scored on rules the AI is asked to judge. Combined is scored only on drafts the AI answered.",
    all: await run(GOLDEN),
    heldout: await run(GOLDEN.filter((d) => goldenSplit(d.id) === "heldout")),
  };
  writeFileSync("docs/eval-ai-results.json", JSON.stringify(results, null, 2) + "\n");

  const line = (name: string, o: { tp: number; fp: number; fn: number; precision: number | null; recall: number | null }) =>
    console.log(`${name.padEnd(12)} tp ${o.tp}  fp ${o.fp}  fn ${o.fn}  precision ${o.precision ?? "n/a"}  recall ${o.recall ?? "n/a"}`);
  console.log(`Coverage: the AI answered ${results.all.answered} of ${results.all.drafts} drafts. Models: ${results.all.models.join(", ") || "none"}`);
  line("rules only", results.all.rulesOnly.overall);
  line("AI only", results.all.aiOnly.overall);
  line("combined", results.all.combined.overall);
  if (results.all.unanswered.length) console.log(`No AI answer on record for: ${results.all.unanswered.join(", ")}. Run with --record.`);
}

void main();
