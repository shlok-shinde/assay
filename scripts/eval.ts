// pnpm eval: runs the rule checks (no AI) over the golden set and reports precision and recall per
// category, on all drafts and on the kept-back half. Fails if the first 64 drafts drop below
// golden/baseline.json, so CI catches regressions. New drafts report what they find; they don't move the gate.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { GOLDEN, goldenSplit, JUDGMENT_ONLY, ROUND2_DRAFTS, type GoldenDraft } from "../golden/drafts";
import { VELVRA_KIT } from "../src/seed/velvra";
import { ruleChecks } from "../src/engine/rules";
import { analyzeClaims } from "../src/engine/claims";
import { mergeFindings } from "../src/engine/merge";
import type { Category } from "../src/lib/types";

const TODAY = "2026-10-26"; // fixed so fact validity does not drift between runs
const ruleCat = new Map(VELVRA_KIT.rules.map((r) => [r.id, r.category]));

interface Row {
  category: string;
  tp: number;
  fp: number;
  fn: number;
  /** Null when there is nothing to divide by: no predictions, or no labels. A score of 1 would be a lie. */
  precision: number | null;
  recall: number | null;
}

const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null);

function score(drafts: GoldenDraft[]) {
  const stats = new Map<Category, { tp: number; fp: number; fn: number }>();
  const bump = (id: string, k: "tp" | "fp" | "fn") => {
    const c = ruleCat.get(id)!;
    const s = stats.get(c) ?? { tp: 0, fp: 0, fn: 0 };
    s[k]++;
    stats.set(c, s);
  };
  const misses: string[] = [];
  for (const d of drafts) {
    const found = mergeFindings([...ruleChecks(d.text, VELVRA_KIT, d.channel), ...analyzeClaims(d.text, VELVRA_KIT, TODAY).findings]);
    const predicted = new Set(found.flatMap((f) => [f.ruleId, ...f.relatedRuleIds]));
    const expected = new Set(d.expect.filter((id) => !JUDGMENT_ONLY.has(id)));
    for (const id of predicted) {
      if (expected.has(id)) bump(id, "tp");
      else {
        bump(id, "fp");
        misses.push(`FP ${d.id}: ${id}${d.note ? ` (${d.note})` : ""}`);
      }
    }
    for (const id of expected) {
      if (predicted.has(id)) continue;
      bump(id, "fn");
      misses.push(`FN ${d.id}: ${id}${d.note ? ` (${d.note})` : ""}`);
    }
  }
  const rows: Row[] = [...stats.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, s]) => ({ category, ...s, precision: ratio(s.tp, s.tp + s.fp), recall: ratio(s.tp, s.tp + s.fn) }));
  const total = rows.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn }), { tp: 0, fp: 0, fn: 0 });
  return { rows, total, overall: { precision: ratio(total.tp, total.tp + total.fp), recall: ratio(total.tp, total.tp + total.fn) }, misses };
}

const num = (v: number | null, w: number) => (v === null ? "n/a" : v.toFixed(3)).padStart(w);

function print(title: string, r: ReturnType<typeof score>) {
  console.log(`\n${title}`);
  console.log("category        tp  fp  fn  precision  recall");
  for (const x of r.rows) console.log(`${x.category.padEnd(15)} ${String(x.tp).padStart(3)} ${String(x.fp).padStart(3)} ${String(x.fn).padStart(3)}  ${num(x.precision, 9)}  ${num(x.recall, 6)}`);
  console.log(`overall         ${String(r.total.tp).padStart(3)} ${String(r.total.fp).padStart(3)} ${String(r.total.fn).padStart(3)}  ${num(r.overall.precision, 9)}  ${num(r.overall.recall, 6)}`);
}

const all = score(GOLDEN);
const heldout = score(GOLDEN.filter((d) => goldenSplit(d.id) === "heldout"));
const gate = score(GOLDEN.slice(0, ROUND2_DRAFTS));

console.log(`Golden set: ${GOLDEN.length} drafts, ${GOLDEN.reduce((n, d) => n + d.expect.length, 0)} expected rule hits, ${GOLDEN.filter((d) => !d.expect.length).length} clean drafts`);
console.log(`Labels for ${[...JUDGMENT_ONLY].join(" and ")} need the AI, so these rule-check scores leave them out (scripts/eval-ai.ts scores them).`);
print("All drafts, rule checks only", all);
print(`Kept-back half (${GOLDEN.filter((d) => goldenSplit(d.id) === "heldout").length} drafts), rule checks only`, heldout);
console.log("\nDisagreements with the labels:");
for (const m of all.misses) console.log(`  ${m}`);

mkdirSync("docs", { recursive: true });
const results = { ranAt: new Date().toISOString(), factsAsOf: TODAY, labels: "builder, with AI assistance", drafts: GOLDEN.length, rows: all.rows, overall: all.overall, heldout: { rows: heldout.rows, overall: heldout.overall }, misses: all.misses };
writeFileSync("docs/eval-results.json", JSON.stringify(results, null, 2) + "\n");
// The first run on a golden set stays on record, whatever later tuning does to the numbers.
const firstRun = `docs/eval-first-run-${GOLDEN.length}.json`;
if (!existsSync(firstRun)) writeFileSync(firstRun, JSON.stringify(results, null, 2) + "\n");

const baseline = JSON.parse(readFileSync("golden/baseline.json", "utf8")) as Record<string, { precision: number; recall: number }>;
const below = (v: number | null, floor: number) => v !== null && v < floor - 1e-9;
const regressions = gate.rows.filter((r) => baseline[r.category] && (below(r.precision, baseline[r.category].precision) || below(r.recall, baseline[r.category].recall)));
if (regressions.length) {
  console.error(`\nRegression against golden/baseline.json: ${regressions.map((r) => r.category).join(", ")}`);
  process.exit(1);
}
console.log(`\nNo regression on the first ${ROUND2_DRAFTS} drafts against golden/baseline.json.`);
