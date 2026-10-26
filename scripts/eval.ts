// npm run eval: runs the rule checks (no AI) over the golden set and reports
// precision and recall per category. Fails if a category drops below the
// baseline in golden/baseline.json, so CI catches regressions.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { GOLDEN } from "../golden/drafts";
import { VELVRA_KIT } from "../src/seed/velvra";
import { ruleChecks } from "../src/engine/rules";
import { analyzeClaims } from "../src/engine/claims";
import { mergeFindings } from "../src/engine/merge";
import type { Category } from "../src/lib/types";

const TODAY = "2026-10-26"; // fixed so fact validity does not drift between runs
const ruleCat = new Map(VELVRA_KIT.rules.map((r) => [r.id, r.category]));
const stats = new Map<Category, { tp: number; fp: number; fn: number }>();
const bump = (c: Category, k: "tp" | "fp" | "fn") => {
  const s = stats.get(c) ?? { tp: 0, fp: 0, fn: 0 };
  s[k]++;
  stats.set(c, s);
};
const misses: string[] = [];

for (const d of GOLDEN) {
  const found = mergeFindings([...ruleChecks(d.text, VELVRA_KIT, d.channel), ...analyzeClaims(d.text, VELVRA_KIT, TODAY).findings]);
  const predicted = new Set(found.flatMap((f) => [f.ruleId, ...f.relatedRuleIds]));
  const expected = new Set(d.expect);
  for (const id of predicted) {
    if (expected.has(id)) bump(ruleCat.get(id)!, "tp");
    else {
      bump(ruleCat.get(id)!, "fp");
      misses.push(`FP ${d.id}: ${id}${d.note ? ` (${d.note})` : ""}`);
    }
  }
  for (const id of expected)
    if (!predicted.has(id)) {
      bump(ruleCat.get(id)!, "fn");
      misses.push(`FN ${d.id}: ${id}${d.note ? ` (${d.note})` : ""}`);
    }
}

const rows = [...stats.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([category, s]) => {
    const precision = s.tp + s.fp ? s.tp / (s.tp + s.fp) : 1;
    const recall = s.tp + s.fn ? s.tp / (s.tp + s.fn) : 1;
    return { category, ...s, precision: Math.round(precision * 1000) / 1000, recall: Math.round(recall * 1000) / 1000 };
  });
const total = rows.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn }), { tp: 0, fp: 0, fn: 0 });
const overall = {
  precision: Math.round((total.tp / (total.tp + total.fp)) * 1000) / 1000,
  recall: Math.round((total.tp / (total.tp + total.fn)) * 1000) / 1000,
};

console.log(`Golden set: ${GOLDEN.length} drafts, ${GOLDEN.reduce((n, d) => n + d.expect.length, 0)} expected rule hits, ${GOLDEN.filter((d) => !d.expect.length).length} clean drafts`);
console.log("category        tp  fp  fn  precision  recall");
for (const r of rows) console.log(`${r.category.padEnd(15)} ${String(r.tp).padStart(3)} ${String(r.fp).padStart(3)} ${String(r.fn).padStart(3)}  ${r.precision.toFixed(3).padStart(9)}  ${r.recall.toFixed(3).padStart(6)}`);
console.log(`overall         ${String(total.tp).padStart(3)} ${String(total.fp).padStart(3)} ${String(total.fn).padStart(3)}  ${overall.precision.toFixed(3).padStart(9)}  ${overall.recall.toFixed(3).padStart(6)}`);
console.log("\nDisagreements with the labels:");
for (const m of misses) console.log(`  ${m}`);

mkdirSync("docs", { recursive: true });
writeFileSync("docs/eval-results.json", JSON.stringify({ at: TODAY, drafts: GOLDEN.length, rows, overall, misses }, null, 2) + "\n");

const baseline = JSON.parse(readFileSync("golden/baseline.json", "utf8")) as Record<string, { precision: number; recall: number }>;
const regressions = rows.filter((r) => baseline[r.category] && (r.precision < baseline[r.category].precision - 1e-9 || r.recall < baseline[r.category].recall - 1e-9));
if (regressions.length) {
  console.error(`\nRegression against golden/baseline.json: ${regressions.map((r) => r.category).join(", ")}`);
  process.exit(1);
}
console.log("\nNo regression against golden/baseline.json.");
