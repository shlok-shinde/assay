// Brand-book import. The AI drafts candidate rules with page references, a batch of pages at a time, and its
// quote must really be on the page it cites. Pages it didn't reach, and every page when there is no AI, go through
// a heuristic that keeps sentences that read as rules (must, never, always, avoid, don't). Every candidate waits
// for approval. Rules only: facts and terms are entered by hand.
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
    // Join lines that a PDF wrapped mid-sentence before splitting into sentences.
    const text = p.text.replace(/([^\n.!?:])\n(?!\n)/g, "$1 ");
    for (const s of sentences(text)) {
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

export interface BookPage {
  page: number;
  text: string;
}

const normal = (s: string) => s.replace(/\s+/g, " ").trim();

/** Calls the AI route will take: within its character cap and its 60 pages. A page too long for one call goes in parts, each keeping its page number. */
export function pageBatches(pages: BookPage[], room: number): BookPage[][] {
  const batches: BookPage[][] = [];
  let current: BookPage[] = [];
  let size = 0;
  const flush = () => {
    if (current.length) batches.push(current);
    current = [];
    size = 0;
  };
  for (const page of pages) {
    let rest = page.text;
    while (rest.trim()) {
      let part = rest;
      if (part.length > room) {
        // Cut at a paragraph, then a sentence, so no instruction is split across two calls.
        const head = rest.slice(0, room);
        const cut = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf(". ") + 1);
        part = rest.slice(0, cut > room / 2 ? cut : room);
      }
      rest = rest.slice(part.length);
      if (size + part.length > room || current.length >= 60) flush();
      current.push({ page: page.page, text: part });
      size += part.length;
    }
  }
  flush();
  return batches;
}

export type DraftRulesCall = (pages: BookPage[]) => Promise<{ ok: true; rules: Omit<Candidate, "by">[]; model: string } | { ok: false }>;

export interface BookDraft {
  candidates: Candidate[];
  pagesTotal: number;
  /** Pages at least partly read by the AI. */
  pagesByAi: number;
  model?: string;
  /** Candidates dropped because their quote is not on the page they cite. */
  rejected: number;
}

const MAX_BOOK_CALLS = 12;

/** Reads a whole book. The AI's part is bounded; whatever it doesn't reach, or fails on, still gets the heuristic, so no page is silently skipped. */
export async function draftBookRules(pages: BookPage[], call: DraftRulesCall | null, room: number, onProgress?: (done: number, total: number) => void): Promise<BookDraft> {
  const batches = call ? pageBatches(pages, room).slice(0, MAX_BOOK_CALLS) : [];
  const read = new Set<number>();
  const candidates: Candidate[] = [];
  let model: string | undefined;
  let rejected = 0;
  for (const [i, batch] of batches.entries()) {
    onProgress?.(i, batches.length);
    const r = await call!(batch);
    // One failure usually means the limit is hit; the next call would only fail too.
    if (!r.ok) break;
    model = r.model;
    for (const b of batch) read.add(b.page);
    for (const c of r.rules) {
      const on = pages.find((p) => p.page === c.page);
      if (on && c.quote.trim() && normal(on.text).includes(normal(c.quote))) candidates.push({ ...c, by: "ai" });
      else rejected++;
    }
  }
  candidates.push(...heuristicCandidates(pages.filter((p) => !read.has(p.page))));
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const key = normal(c.text).toLowerCase();
    return seen.has(key) ? false : !!seen.add(key);
  });
  return { candidates: unique, pagesTotal: pages.length, pagesByAi: read.size, model, rejected };
}

export function candidateToRule(c: Candidate, id: string, doc: string, bookId?: string): Rule {
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
    source: { doc, page: c.page, section: `imported (${c.by === "ai" ? "AI draft" : "heuristic"})`, bookId, quote: c.quote },
    active: false,
    pending: true,
  };
}
