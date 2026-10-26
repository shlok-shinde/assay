// The Claim Ledger check. Claims are found with pattern families, matched to
// a fact with BM25 (or the AI's choice among the same candidates), and then
// compared in code: numbers, units, periods, wording and validity dates.
import type { CheckedClaim, ClaimStatus, Fact, KitContent, Rule } from "@/lib/types";
import { buildIndex, search, type Bm25Index } from "./bm25";
import { dimension, findQuantities, formatQuantity, sameAmount, sameDimension, type FoundQuantity } from "./quantities";
import { clauses, findPhrases, sentences, trimSpanEnd, type Span } from "./text";
import type { RawFinding } from "./types";

const STUDY_WORDS = /\b(clinically|clinical|study|studies|trial|proven|tested)\b/i;
const CLINICAL = /\bclinical(ly)?\b/i;

export interface ClaimCandidate {
  key: string;
  text: string;
  candidates: string[];
}

interface ClauseClaim {
  key: string;
  factId?: string;
  quantities: FoundQuantity[];
  anchor: number;
  clause: Span;
  sentence: Span;
  study: boolean;
}

export const formatDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const isExpired = (f: Fact, today: string) => !!f.validTo && f.validTo < today;

function collect(text: string, kit: KitContent, index: Bm25Index, choices: Record<string, string>) {
  const facts = new Map(kit.facts.map((f) => [f.id, f]));
  const out: ClauseClaim[] = [];
  const ambiguous: ClaimCandidate[] = [];
  for (const sentence of sentences(text)) {
    for (const clause of clauses(sentence)) {
      const byFact = new Map<string, ClauseClaim>();
      const add = (key: string, factId: string | undefined, anchor: number, q?: FoundQuantity) => {
        const id = factId ?? `none:${key}`;
        const existing = byFact.get(id);
        if (existing) {
          existing.anchor = Math.min(existing.anchor, anchor);
          if (q) existing.quantities.push(q);
          return;
        }
        byFact.set(id, { key, factId, quantities: q ? [q] : [], anchor, clause, sentence, study: STUDY_WORDS.test(clause.text) });
      };

      // 1. Phrases that name a fact directly ("no white cast", "dermatologist-tested").
      for (const f of kit.facts) {
        for (const m of findPhrases(clause.text, f.triggers)) add(`trigger:${f.id}|${clause.text}`, f.id, clause.start + m.start);
      }

      // 2. Numbers with units, matched to facts that carry the same kind of quantity.
      for (const q of findQuantities(clause.text)) {
        const abs = { ...q, start: clause.start + q.start, end: clause.start + q.end };
        const key = `${dimension(q.unit).dim}|${clause.text}`;
        const candidateIds = kit.facts.filter((f) => f.quantities.some((fq) => sameDimension(fq.unit, q.unit))).map((f) => f.id);
        if (!candidateIds.length) {
          add(key, undefined, abs.start, abs);
          continue;
        }
        const ranked = search(index, clause.text, 3, (id) => candidateIds.includes(id));
        const chosen = choices[key] && candidateIds.includes(choices[key]) ? choices[key] : ranked[0]?.id;
        if (ranked.length > 1 && ranked[1].score >= ranked[0].score * 0.7) {
          ambiguous.push({ key, text: clause.text, candidates: ranked.map((r) => r.id) });
        }
        // A quantity only counts toward a fact the clause is plausibly about.
        if (!chosen || (!ranked.length && candidateIds.length > 1)) add(key, undefined, abs.start, abs);
        else add(key, chosen, abs.start, abs);
      }

      // 3. Study wording with no number and no named fact.
      if (STUDY_WORDS.test(clause.text) && byFact.size === 0) {
        const m = clause.text.match(STUDY_WORDS)!;
        const studyIds = kit.facts.filter((f) => ["study", "clinical", "panel", "certification"].includes(f.kind)).map((f) => f.id);
        const ranked = search(index, clause.text, 1, (id) => studyIds.includes(id));
        add(`study|${clause.text}`, ranked[0]?.score > 1 ? ranked[0].id : undefined, clause.start + (m.index ?? 0));
      }

      for (const c of byFact.values()) {
        if (c.factId && !facts.has(c.factId)) c.factId = undefined;
        out.push(c);
      }
    }
  }
  return { claims: out, ambiguous };
}

/** Claims whose fact the AI may choose, because BM25 ranks two facts close together. */
export function claimCandidates(text: string, kit: KitContent): ClaimCandidate[] {
  return collect(text, kit, buildIndex(kit.facts, kit.synonyms), {}).ambiguous;
}

export function analyzeClaims(
  text: string,
  kit: KitContent,
  today: string,
  choices: Record<string, string> = {},
): { claims: CheckedClaim[]; findings: RawFinding[] } {
  const index = buildIndex(kit.facts, kit.synonyms);
  const facts = new Map(kit.facts.map((f) => [f.id, f]));
  const rules = new Map(kit.rules.filter((r) => r.active && !r.pending).map((r) => [r.id, r]));
  const claim01 = rules.get("CLAIM-01");
  const claim05 = rules.get("CLAIM-05");
  const checked: CheckedClaim[] = [];
  const findings: RawFinding[] = [];

  for (const c of collect(text, kit, index, choices).claims) {
    const fact = c.factId ? facts.get(c.factId) : undefined;
    const end = trimSpanEnd(text, c.anchor, c.clause.end);
    const claimText = text.slice(c.anchor, end);
    const evaluated = evaluate(c, fact, today);
    checked.push({ text: claimText, start: c.anchor, end, status: evaluated.status, factId: fact?.id, detail: evaluated.detail });
    if (evaluated.status === "supported") {
      const needsFootnote = fact && ["study", "panel", "clinical"].includes(fact.kind) && !/^\s?\*/.test(text.slice(end, end + 2));
      if (needsFootnote && claim05 && fact.footnote) {
        findings.push({
          ruleId: "CLAIM-05",
          relatedRuleIds: [],
          factId: fact.id,
          claimStatus: "supported",
          category: "claim",
          severity: claim05.severity,
          origin: "rule",
          start: c.anchor,
          end,
          quote: claimText,
          title: "Study claim needs its footnote",
          reason: `This claim matches ${fact.id}, but study claims carry a footnote with the study type, size and year (CLAIM-05).`,
          fix: { kind: "replace", replacement: `${claimText}*`, footnote: fact.footnote, label: "Add the footnote" },
        });
      }
      continue;
    }
    if (!claim01) continue;
    findings.push(toFinding(text, c, fact, evaluated, claim01, end));
  }
  return { claims: checked, findings };
}

function evaluate(c: ClauseClaim, fact: Fact | undefined, today: string): { status: ClaimStatus; detail: string; problems: string[] } {
  if (!fact) {
    const what = c.quantities.length ? c.quantities.map((q) => `“${q.raw}”`).join(", ") : "this study claim";
    return { status: "unsupported", detail: "No approved fact", problems: [`${what} has no approved fact in the Claim Ledger.`] };
  }
  if (isExpired(fact, today)) {
    return {
      status: "outdated",
      detail: `${fact.id} expired ${formatDate(fact.validTo!)}`,
      problems: [`${fact.id} expired on ${formatDate(fact.validTo!)}, so it can't be used. Ask its owner (${fact.owner}) to renew it, or remove the claim.`],
    };
  }
  const problems: string[] = [];
  for (const q of c.quantities) {
    const comparable = fact.quantities.filter((fq) => sameDimension(fq.unit, q.unit));
    if (comparable.length && !comparable.some((fq) => sameAmount(fq, q))) {
      problems.push(`“${q.raw}” doesn't match ${fact.id}, which says ${comparable.map(formatQuantity).join(" / ")}.`);
    }
  }
  if (CLINICAL.test(c.clause.text) && fact.kind !== "clinical") {
    problems.push(`“Clinically proven” is not approved wording, because ${fact.id} is ${article(fact.kind)} ${kindLabel(fact.kind)}, not a clinical trial.`);
  }
  if (problems.length) return { status: "contradicted", detail: `Contradicts ${fact.id}`, problems };
  return { status: "supported", detail: `Matches ${fact.id}`, problems };
}

const kindLabel = (k: Fact["kind"]) => (k === "study" ? "in-house study" : k === "panel" ? "consumer panel" : k);
const article = (k: Fact["kind"]) => (/^[aeiou]/.test(kindLabel(k)) ? "an" : "a");

function toFinding(
  text: string,
  c: ClauseClaim,
  fact: Fact | undefined,
  ev: { status: ClaimStatus; problems: string[] },
  rule: Rule,
  end: number,
): RawFinding {
  let start = c.anchor;
  let fix: RawFinding["fix"];
  if (ev.status === "contradicted" && fact) {
    if (["study", "clinical", "panel"].includes(fact.kind)) {
      // Extend back over "clinically proven" style lead-ins inside the clause.
      const lead = text.slice(c.clause.start, start).search(/\b(clinically|clinical|proven)\b/i);
      if (lead >= 0) start = c.clause.start + lead;
      const atSentenceStart = text.slice(c.sentence.start, start).trim() === "";
      const wording = atSentenceStart ? fact.approvedWording : fact.inlineWording;
      fix = { kind: "replace", replacement: `${wording}${fact.footnote ? "*" : ""}`, footnote: fact.footnote, label: `Use the approved wording from ${fact.id}` };
    } else {
      let replacement = text.slice(start, end);
      for (const q of [...c.quantities].sort((a, b) => b.start - a.start)) {
        const target = fact.quantities.find((fq) => sameDimension(fq.unit, q.unit));
        if (!target || sameAmount(target, q)) continue;
        const rel = q.start - start;
        replacement = replacement.slice(0, rel) + formatQuantity(target) + replacement.slice(rel + q.raw.length);
      }
      fix = { kind: "replace", replacement, label: `Use the approved figure from ${fact.id}` };
    }
  } else {
    // Outdated or unsupported: the safe minimal edit removes the claim's clause.
    start = c.clause.start;
    fix = { kind: "replace", replacement: "", label: "Remove the claim" };
    if (text.slice(c.sentence.start, start).trim() === "" && end >= trimSpanEnd(text, c.sentence.start, c.sentence.end)) {
      end = c.sentence.end;
    }
  }
  const quoteEnd = Math.min(end, text.length);
  // Keep a leading ", and" inside the fix range but out of the quote.
  const fixStart = start;
  const lead = /^[,\s]+/.exec(text.slice(start, quoteEnd));
  if (lead) start += lead[0].length;
  if (fix && fixStart !== start) fix.range = { start: fixStart, end: quoteEnd };
  return {
    ruleId: rule.id,
    relatedRuleIds: [],
    factId: fact?.id,
    claimStatus: ev.status,
    category: "claim",
    severity: rule.severity,
    origin: "rule",
    start,
    end: quoteEnd,
    quote: text.slice(start, quoteEnd),
    title:
      ev.status === "contradicted"
        ? "Claim contradicts an approved fact"
        : ev.status === "outdated"
          ? "Claim uses an expired fact"
          : "Claim has no approved fact",
    reason: ev.problems.join(" "),
    fix,
  };
}
