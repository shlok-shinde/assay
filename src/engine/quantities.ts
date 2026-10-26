// Finds numbers with units in draft text, so claims can be compared with
// Claim Ledger facts in code rather than by the AI.
import type { Quantity, Unit } from "@/lib/types";

export interface FoundQuantity extends Quantity {
  start: number;
  end: number;
  raw: string;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const num = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? Number(s.replace(/,/g, ""));

const DURATION_UNITS: Record<string, Unit> = {
  day: "day", days: "day", week: "week", weeks: "week", month: "month", months: "month", year: "year", years: "year",
  minute: "minute", minutes: "minute", min: "minute", mins: "minute", hour: "hour", hours: "hour", hr: "hour", hrs: "hour",
};

const NUMBER = "(\\d[\\d,]*(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";

const PATTERNS: { re: RegExp; unit: (m: RegExpMatchArray) => Unit; value: (m: RegExpMatchArray) => number }[] = [
  { re: /(\d+(?:\.\d+)?)\s?%/g, unit: () => "percent", value: (m) => num(m[1]) },
  { re: /(?:₹|\brs\.?\s?|\binr\s?)(\d[\d,]*(?:\.\d+)?)/gi, unit: () => "inr", value: (m) => num(m[1]) },
  { re: /(\d[\d,]*)\s?rupees\b/gi, unit: () => "inr", value: (m) => num(m[1]) },
  { re: /(\d+(?:\.\d+)?)\s?ml\b/gi, unit: () => "ml", value: (m) => num(m[1]) },
  { re: /\bspf\s?(\d+)/gi, unit: () => "spf", value: (m) => num(m[1]) },
  { re: /\bn\s?=\s?(\d+)/gi, unit: () => "n", value: (m) => num(m[1]) },
  { re: /(\d[\d,]*)\s+(?:participants|people|women|men|users|volunteers|customers)\b/gi, unit: () => "n", value: (m) => num(m[1]) },
  {
    re: new RegExp(`\\b${NUMBER}[\\s-](days?|weeks?|months?|years?|minutes?|mins?|hours?|hrs?)\\b`, "gi"),
    unit: (m) => DURATION_UNITS[m[2].toLowerCase()],
    value: (m) => num(m[1]),
  },
];

export function findQuantities(text: string): FoundQuantity[] {
  const out: FoundQuantity[] = [];
  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const value = p.value(m);
      if (!Number.isFinite(value)) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (out.some((q) => start < q.end && end > q.start)) continue;
      out.push({ value, unit: p.unit(m), start, end, raw: m[0] });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Units that can be compared with each other, and a factor to a common base. */
export function dimension(unit: Unit): { dim: string; factor: number } {
  switch (unit) {
    case "day":
      return { dim: "long-duration", factor: 1 };
    case "week":
      return { dim: "long-duration", factor: 7 };
    case "month":
      return { dim: "long-duration", factor: 30 };
    case "year":
      return { dim: "long-duration", factor: 365 };
    case "minute":
      return { dim: "short-duration", factor: 1 };
    case "hour":
      return { dim: "short-duration", factor: 60 };
    default:
      return { dim: unit, factor: 1 };
  }
}

export function sameDimension(a: Unit, b: Unit) {
  return dimension(a).dim === dimension(b).dim;
}

export function sameAmount(a: Quantity, b: Quantity) {
  const da = dimension(a.unit);
  const db = dimension(b.unit);
  return da.dim === db.dim && Math.abs(a.value * da.factor - b.value * db.factor) < 1e-6;
}

export function formatQuantity(q: Quantity): string {
  switch (q.unit) {
    case "percent":
      return `${q.value}%`;
    case "inr":
      return `₹${q.value}`;
    case "ml":
      return `${q.value} ml`;
    case "spf":
      return `SPF ${q.value}`;
    case "n":
      return `n=${q.value}`;
    default:
      return `${q.value} ${q.unit}${q.value === 1 ? "" : "s"}`;
  }
}
