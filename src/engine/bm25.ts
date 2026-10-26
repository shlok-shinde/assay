// Okapi BM25 over Claim Ledger facts. Small enough to run on every check in
// the browser, so no embedding model has to be downloaded.
import type { Fact } from "@/lib/types";
import { stems } from "./text";

export interface Bm25Index {
  docs: { id: string; terms: string[] }[];
  df: Map<string, number>;
  avgLen: number;
  synonyms: Map<string, Set<string>>;
  names: string[];
}

export function factDocument(f: Fact): string {
  return [f.statement, f.keywords.join(" "), f.triggers.join(" "), f.approvedWording].join(" ");
}

/** Removes brand and product names, which appear in many facts and drafts and say nothing about which fact a claim means. */
export function withoutNames(text: string, names: string[]): string {
  return names.reduce((t, n) => t.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " "), text);
}

export function buildIndex(facts: Fact[], synonymGroups: string[][] = [], names: string[] = []): Bm25Index {
  const docs = facts.map((f) => ({ id: f.id, terms: stems(withoutNames(factDocument(f), names)) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.terms)) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((n, d) => n + d.terms.length, 0) / Math.max(1, docs.length);
  const synonyms = new Map<string, Set<string>>();
  for (const group of synonymGroups) {
    const all = group.flatMap((g) => stems(g));
    for (const t of all) {
      const set = synonyms.get(t) ?? new Set<string>();
      for (const u of all) if (u !== t) set.add(u);
      synonyms.set(t, set);
    }
  }
  return { docs, df, avgLen, synonyms, names };
}

export function search(index: Bm25Index, query: string, k = 3, only?: (id: string) => boolean): { id: string; score: number }[] {
  const q = stems(withoutNames(query, index.names));
  const expanded = new Map<string, number>();
  for (const t of q) {
    expanded.set(t, Math.max(expanded.get(t) ?? 0, 1));
    for (const s of index.synonyms.get(t) ?? []) expanded.set(s, Math.max(expanded.get(s) ?? 0, 0.5));
  }
  const N = index.docs.length;
  const k1 = 1.2;
  const b = 0.75;
  const scores = index.docs
    .filter((d) => !only || only(d.id))
    .map((d) => {
      let score = 0;
      for (const [t, weight] of expanded) {
        const tf = d.terms.filter((x) => x === t).length;
        if (!tf) continue;
        const n = index.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += weight * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.terms.length) / index.avgLen)));
      }
      return { id: d.id, score: Math.round(score * 1000) / 1000 };
    });
  return scores.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}
