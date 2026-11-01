// pnpm eval:people scores the engine against labels from people other than the builder, in golden/labels/*.json. Those
// files hold raw answers, either the /api/label export or a labeller's "Download my answers". It reports how many drafts
// people labelled, how far they agreed, and precision and recall against their labels. The builder never settles a
// disagreement: two people who disagree on a rule for a draft leave that decision out, and it is counted. With three or
// more, the majority decides. What the report may claim follows from the counts, not from anyone's choice of words.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GOLDEN, goldenSplit } from "../golden/drafts";
import { runCheck, type AiClient, type CacheStore, type SegmentCache } from "../src/engine/pipeline";
import { draftIntent } from "../src/engine/fix";
import manifest from "../public/label/manifest.json";
import { VELVRA_KIT } from "../src/seed/velvra";

const DIR = process.env.LABELS_DIR ?? "golden/labels";
const OUT = process.env.EVAL_OUT ?? "docs/eval-people-results.json";
const PREDICTIONS = "golden/ai-predictions.json";
const TODAY = "2026-10-26";

interface Answer {
  coder: string;
  item: string;
  rules: string[];
  ms?: number;
}

const opaque = (id: string) => createHash("sha256").update(`assay-golden:${id}`).digest("hex").slice(0, 12);
const draftByItem = new Map(GOLDEN.map((d) => [opaque(d.id), d]));
const RULES = manifest.rules.map((r) => r.id);
const inManifest = new Set(RULES);
const category = new Map(VELVRA_KIT.rules.map((r) => [r.id, r.category]));
const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null);

/** Accepts both shapes. A person's later answer on a draft replaces their earlier one. */
function readAnswers(): Answer[] {
  if (!existsSync(DIR)) return [];
  const latest = new Map<string, Answer>();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
    const body = JSON.parse(readFileSync(join(DIR, file), "utf8"));
    const rows: Record<string, unknown>[] = Array.isArray(body) ? body : (body.answers ?? []);
    for (const r of rows) {
      const coder = String(r.coder ?? body.coder ?? "");
      const item = String(r.item_id ?? r.itemId ?? r.id ?? "");
      const rules = (r.rule_ids ?? r.ruleIds ?? r.rules) as string[] | undefined;
      if (!coder || !draftByItem.has(item) || !Array.isArray(rules)) continue;
      latest.set(`${coder}|${item}`, { coder, item, rules: rules.filter((x) => inManifest.has(x)), ms: typeof r.ms === "number" ? r.ms : undefined });
    }
  }
  return [...latest.values()];
}

/** Cohen's kappa over yes/no decisions. Null when chance agreement is total, so there is nothing to measure. */
function kappa(pairs: [boolean, boolean][]): number | null {
  if (!pairs.length) return null;
  const n = pairs.length;
  const agree = pairs.filter(([a, b]) => a === b).length / n;
  const a = pairs.filter(([x]) => x).length / n;
  const b = pairs.filter(([, y]) => y).length / n;
  const chance = a * b + (1 - a) * (1 - b);
  return chance === 1 ? null : Math.round(((agree - chance) / (1 - chance)) * 1000) / 1000;
}

type Tally = Map<string, { tp: number; fp: number; fn: number }>;
const bump = (t: Tally, rule: string, k: "tp" | "fp" | "fn") => {
  const c = category.get(rule) ?? "other";
  const s = t.get(c) ?? { tp: 0, fp: 0, fn: 0 };
  s[k]++;
  t.set(c, s);
};
const rows = (t: Tally) => {
  const list = [...t.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cat, s]) => ({ category: cat, ...s, precision: ratio(s.tp, s.tp + s.fp), recall: ratio(s.tp, s.tp + s.fn) }));
  const total = list.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn }), { tp: 0, fp: 0, fn: 0 });
  return { rows: list, overall: { ...total, precision: ratio(total.tp, total.tp + total.fp), recall: ratio(total.tp, total.tp + total.fn) } };
};

const recorded: Record<string, { data: SegmentCache; model: string; at: string }> = existsSync(PREDICTIONS) ? JSON.parse(readFileSync(PREDICTIONS, "utf8")) : {};
const cache: CacheStore = { get: async (k) => recorded[k], set: async () => undefined };
const noCall: AiClient = { judge: async () => ({ ok: false, reason: "offline", message: "No recorded answer" }) };

async function main() {
  const answers = readAnswers();
  const coders = [...new Set(answers.map((a) => a.coder))].sort();
  const byItem = new Map<string, Answer[]>();
  for (const a of answers) byItem.set(a.item, [...(byItem.get(a.item) ?? []), a]);

  const pairs: [boolean, boolean][] = [];
  const builder: [boolean, boolean][] = [];
  let unresolved = 0;
  let decisions = 0;
  const rulesOnly: Tally = new Map();
  const combined: Tally = new Map();
  const heldoutRules: Tally = new Map();
  let aiAnswered = 0;
  for (const [item, labels] of byItem) {
    const draft = draftByItem.get(item)!;
    const out = await runCheck({ text: draft.text, channel: draft.channel, audience: "Everyday skincare buyers", intent: { ...draftIntent(draft.text), confirmed: true }, kit: VELVRA_KIT, rulebookVersion: "3.2", confidential: false, today: TODAY, ai: noCall, cache });
    // Scored from a run with no AI: a rule finding that absorbs an AI finding lists the AI's rule as related.
    const alone = await runCheck({ text: draft.text, channel: draft.channel, audience: "Everyday skincare buyers", intent: { ...draftIntent(draft.text), confirmed: true }, kit: VELVRA_KIT, rulebookVersion: "3.2", confidential: false, today: TODAY, ai: null, cache: null });
    const fromRules = new Set(alone.findings.filter((f) => f.origin === "rule").flatMap((f) => [f.ruleId, ...f.relatedRuleIds]));
    const fromAll = new Set(out.findings.flatMap((f) => [f.ruleId, ...f.relatedRuleIds]));
    if (out.mode === "rules+ai") aiAnswered++;
    for (const rule of RULES) {
      const votes = labels.map((l) => l.rules.includes(rule));
      for (let i = 0; i < votes.length; i++) for (let j = i + 1; j < votes.length; j++) pairs.push([votes[i], votes[j]]);
      for (const v of votes) builder.push([v, draft.expect.includes(rule)]);
      const yes = votes.filter(Boolean).length;
      decisions++;
      if (yes * 2 === votes.length) {
        unresolved++;
        continue;
      }
      const truth = yes * 2 > votes.length;
      const score = (t: Tally, predicted: Set<string>) => {
        if (predicted.has(rule) && truth) bump(t, rule, "tp");
        else if (predicted.has(rule)) bump(t, rule, "fp");
        else if (truth) bump(t, rule, "fn");
      };
      score(rulesOnly, fromRules);
      if (out.mode === "rules+ai") score(combined, fromAll);
      if (goldenSplit(draft.id) === "heldout") score(heldoutRules, fromRules);
    }
  }

  const n = byItem.size;
  const claim =
    n === 0
      ? "Not delivered: no drafts have labels from people other than the builder. All published numbers are builder labels with AI assistance."
      : n < 100
        ? `Partly delivered: ${n} of ${GOLDEN.length} drafts have labels from people other than the builder.`
        : coders.length >= 2
          ? `Met on the count: ${n} drafts labelled, from ${coders.length} browser codes. A code is a browser, not a person.`
          : `Met on the count: ${n} drafts labelled, all from one browser code.`;

  // Answers are anonymous, so how they were given is all the data can say about them. It is reported, never filtered.
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const perCode = coders.map((code) => {
    const mine = answers.filter((a) => a.coder === code);
    const times = mine.flatMap((a) => (a.ms === undefined ? [] : [a.ms]));
    return { code, answers: mine.length, medianMs: times.length ? median(times) : null, mostRulesTicked: Math.max(...mine.map((a) => a.rules.length)) };
  });
  const without = (code: string) => new Set(answers.filter((a) => a.coder !== code).map((a) => a.item)).size;

  const results = {
    ranAt: new Date().toISOString(),
    labelsFrom: DIR,
    claim,
    browserCodes: coders.length,
    perCode,
    draftsWithoutOneSetOf20: perCode.filter((c) => c.answers === 20).map((c) => ({ code: c.code, drafts: without(c.code) })),
    draftsLabelled: n,
    draftsInSet: GOLDEN.length,
    draftsWithTwoOrMore: [...byItem.values()].filter((l) => l.length >= 2).length,
    ruleDecisions: decisions,
    unresolvedAndLeftOut: unresolved,
    agreementBetweenPeople: { cohensKappa: kappa(pairs), decisionPairs: pairs.length },
    agreementWithBuilderLabels: { cohensKappa: kappa(builder), decisions: builder.length },
    aiCoverage: { answered: aiAnswered, of: n, note: "Combined is scored only on labelled drafts the AI answered." },
    rulesOnly: rows(rulesOnly),
    rulesOnlyHeldout: rows(heldoutRules),
    combined: rows(combined),
  };
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
  console.log(claim);
  console.log(`Browser codes ${coders.length}; drafts ${n}; two or more labels on ${results.draftsWithTwoOrMore}; left out ${unresolved} of ${decisions} rule decisions.`);
  console.log(`Kappa between labellers ${results.agreementBetweenPeople.cohensKappa ?? "n/a"}; with builder labels ${results.agreementWithBuilderLabels.cohensKappa ?? "n/a"}.`);
  console.log(`Rules only: precision ${results.rulesOnly.overall.precision ?? "n/a"}, recall ${results.rulesOnly.overall.recall ?? "n/a"}.`);
}

void main();
