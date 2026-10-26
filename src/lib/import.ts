// Brand-book import (basic). The AI drafts candidate rules with page
// references; without it, a heuristic keeps sentences that read as rules
// (must, never, always, avoid, don't). Every candidate waits for approval.
import type { Category, Rule, Severity } from "./types";
import { sentences } from "@/engine/text";

export interface Candidate {
  title: string;
  text: string;
  category: Category;
  severity: Severity;
  page: number;
  quote: string;
  by: "ai" | "heuristic";
}

const RULE_WORDS = /\b(must|never|always|avoid|don['’]t|do not|should not|no more than|at least)\b/i;

function guessCategory(s: string): Category {
  if (/hashtag|emoji|capital|alt text|contrast|readab/i.test(s)) return "accessibility";
  if (/claim|miracle|cure|proven|guarantee|clinical|results/i.test(s)) return "claim";
  if (/unsubscribe|disclaimer|legal|consent|terms/i.test(s)) return "legal";
  if (/logo|colour|color|photo|image|video|font|credit/i.test(s)) return "visual";
  if (/["“].+["”]|\bsay\b|\bcall\b|\bword\b|describe|term/i.test(s)) return "term";
  if (/subject line|message|pillar|cta|call to action/i.test(s)) return "message";
  return "tone";
}

export function heuristicCandidates(pages: { page: number; text: string }[]): Candidate[] {
  const out: Candidate[] = [];
  for (const p of pages) {
    for (const s of sentences(p.text)) {
      if (!RULE_WORDS.test(s.text) || s.text.length < 15) continue;
      const words = s.text.replace(/[.!]$/, "").split(/\s+/);
      out.push({
        title: words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : ""),
        text: s.text,
        category: guessCategory(s.text),
        severity: /\b(must|never)\b/i.test(s.text) ? "medium" : "low",
        page: p.page,
        quote: s.text,
        by: "heuristic",
      });
    }
  }
  return out;
}

export function candidateToRule(c: Candidate, id: string, doc: string): Rule {
  return {
    id,
    title: c.title,
    text: c.text,
    category: c.category,
    severity: c.severity,
    modes: ["judgment"],
    channels: [],
    dos: [],
    donts: [],
    patterns: [],
    replacements: {},
    source: { doc, page: c.page, section: `imported (${c.by === "ai" ? "AI draft" : "heuristic"})` },
    active: false,
    pending: true,
  };
}
