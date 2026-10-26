// Offset-preserving text helpers. Every finding is anchored to [start, end)
// character offsets into the exact text the creator submitted.

export interface Span {
  start: number;
  end: number;
  text: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive whole-word matches for every phrase, longest phrase first, no overlaps. */
export function findPhrases(text: string, phrases: string[]): (Span & { phrase: string })[] {
  const sorted = [...new Set(phrases.map((p) => p.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const taken: boolean[] = new Array(text.length).fill(false);
  const out: (Span & { phrase: string })[] = [];
  for (const phrase of sorted) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase)}(?![\\p{L}\\p{N}])`, "giu");
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      let free = true;
      for (let i = start; i < end; i++) if (taken[i]) free = false;
      if (!free) continue;
      for (let i = start; i < end; i++) taken[i] = true;
      out.push({ start, end, text: m[0], phrase: phrase.toLowerCase() });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Sentences with offsets. Splits on . ! ? followed by whitespace, and on newlines. */
export function sentences(text: string): Span[] {
  const out: Span[] = [];
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) out.push({ start: start + lead, end: start + lead + trimmed.length, text: trimmed });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      push(i);
      start = i + 1;
      continue;
    }
    if (ch === "." || ch === "!" || ch === "?") {
      let j = i;
      while (j + 1 < text.length && /[.!?]/.test(text[j + 1])) j++;
      // Footnote markers and closing quotes stay with their sentence: "tone.*", "done.”"
      while (j + 1 < text.length && /[*)\]"'”’]/.test(text[j + 1])) j++;
      const next = text[j + 1];
      const before = text.slice(Math.max(0, i - 3), i).toLowerCase();
      const abbreviation = ch === "." && /(^|\W)no$/.test(before) && /\s?\d/.test(text.slice(j + 1, j + 3));
      if ((next === undefined || /\s/.test(next)) && !abbreviation) {
        push(j + 1);
        i = j;
      }
    }
  }
  push(text.length);
  return out;
}

const CLAUSE_BREAK = /\s*;\s+|\s+[—–]\s+|,\s+(?=(?:and|but|while|so|plus|because)\b)/giu;

/** Clauses inside a sentence. A clause that begins with a conjunction keeps its leading comma. */
export function clauses(sentence: Span): Span[] {
  const out: Span[] = [];
  let cursor = 0;
  const s = sentence.text;
  for (const m of s.matchAll(CLAUSE_BREAK)) {
    const keepComma = m[0].trimStart().startsWith(",");
    const cut = keepComma ? m.index : m.index + m[0].length;
    if (cut > cursor) out.push(span(sentence.start + cursor, s.slice(cursor, cut)));
    cursor = keepComma ? m.index : m.index + m[0].length;
  }
  if (cursor < s.length) out.push(span(sentence.start + cursor, s.slice(cursor)));
  return out.filter((c) => c.text.trim().length > 0);
}

function span(start: number, raw: string): Span {
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  return { start: start + lead, end: start + lead + text.length, text };
}

/** Paragraph segments, the unit of the AI cache and of partial re-checks. */
export function paragraphs(text: string): Span[] {
  const out: Span[] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g;
  for (const m of text.matchAll(re)) {
    const s = span(m.index, m[0]);
    if (s.text) out.push(s);
  }
  return out;
}

export const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

export function words(text: string): Span[] {
  return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
}

/** Trims trailing punctuation and spaces from a span. */
export function trimSpanEnd(text: string, start: number, end: number): number {
  while (end > start && /[\s.,!?;:*]/.test(text[end - 1])) end--;
  return end;
}

export const STOPWORDS = new Set(
  "a an the and or but of to in on for with at by from is are was were be been it its this that these those our your you we us my me i as so if not no do does did will can just".split(
    " ",
  ),
);

/** Lowercase word stems used by BM25 retrieval. */
export function stems(text: string): string[] {
  return words(text.toLowerCase())
    .map((w) => w.text.replace(/['’]s$/, ""))
    .filter((w) => !STOPWORDS.has(w))
    .map(stem);
}

export function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
