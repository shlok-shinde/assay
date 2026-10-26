// Dedupe and rank. When two findings cover overlapping text, the more serious
// one stays and the other becomes a related rule on it, so the creator sees
// one card per problem with every rule it breaks.
import { SEVERITY_RANK, type RawFinding } from "./types";

const overlaps = (a: RawFinding, b: RawFinding) => a.start >= 0 && b.start >= 0 && a.start < b.end && b.start < a.end;

function priority(f: RawFinding): number[] {
  return [SEVERITY_RANK[f.severity], f.factId ? 1 : 0, f.category === "claim" ? 1 : 0, f.origin === "rule" ? 1 : 0, f.end - f.start];
}

function compare(a: RawFinding, b: RawFinding): number {
  const pa = priority(a);
  const pb = priority(b);
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
  return a.start - b.start;
}

export function mergeFindings(findings: RawFinding[]): RawFinding[] {
  const kept: RawFinding[] = [];
  for (const f of [...findings].sort(compare)) {
    const host = kept.find((k) => overlaps(k, f));
    if (!host) {
      kept.push({ ...f, relatedRuleIds: [...f.relatedRuleIds] });
      continue;
    }
    if (f.origin === "ai" && host.origin === "rule" && host.ruleId === f.ruleId) {
      host.reason += ` AI judgment agrees (confidence ${f.confidence?.toFixed(2)}).`;
      host.model = f.model;
      host.confidence = f.confidence;
      continue;
    }
    if (host.ruleId !== f.ruleId && !host.relatedRuleIds.includes(f.ruleId)) {
      host.relatedRuleIds.push(f.ruleId);
      host.reason += ` Also ${f.ruleId}: ${f.reason.replace(/^“[^”]*” breaks [A-Z0-9-]+: /, "")}`;
    }
  }
  return rank(kept);
}

/** Highest severity first, then reading order. Image findings go last. */
export function rank(findings: RawFinding[]): RawFinding[] {
  return [...findings].sort((a, b) => {
    const s = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (s) return s;
    if ((a.start < 0) !== (b.start < 0)) return a.start < 0 ? 1 : -1;
    return a.start - b.start;
  });
}
