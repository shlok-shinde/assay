// Redaction runs before any text leaves the browser, and again on the server.
// It keeps a map so offsets the AI returns can be mapped back to the original.

export interface Redaction {
  kind: string;
  origStart: number;
  origEnd: number;
  newStart: number;
  newEnd: number;
}

export interface Redacted {
  text: string;
  redactions: Redaction[];
}

const PATTERNS: [string, RegExp][] = [
  ["SECRET", /\b(?:AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g],
  ["EMAIL", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ["CARD", /(?<![\d-])(?:\d{4}[ -]?){3}\d{1,7}(?![\d-])/g],
  ["ID", /\b[A-Z]{5}\d{4}[A-Z]\b|(?<!\d)\d{4}\s\d{4}\s\d{4}(?!\d)/g],
  ["PHONE", /(?<![\w+])(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){9}\d(?!\w)/g],
];

export function redact(input: string): Redacted {
  const hits: { kind: string; start: number; end: number }[] = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of input.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ kind, start, end });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  let text = "";
  let cursor = 0;
  const redactions: Redaction[] = [];
  for (const h of hits) {
    text += input.slice(cursor, h.start);
    const placeholder = `[${h.kind}]`;
    redactions.push({ kind: h.kind, origStart: h.start, origEnd: h.end, newStart: text.length, newEnd: text.length + placeholder.length });
    text += placeholder;
    cursor = h.end;
  }
  text += input.slice(cursor);
  return { text, redactions };
}

/** Maps an offset in redacted text back to the original. Null if it falls inside a placeholder. */
export function toOriginal(pos: number, redactions: Redaction[]): number | null {
  let delta = 0;
  for (const r of redactions) {
    if (pos <= r.newStart) return pos + delta;
    if (pos < r.newEnd) return null;
    delta = r.origEnd - r.newEnd;
  }
  return pos + delta;
}
