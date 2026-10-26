// Intent-preserving fixes: each fix replaces only its own span, footnotes are
// added once, and an intent check compares the key message and CTA before
// and after.
import type { Finding, IntentCard } from "@/lib/types";
import { sentences, stems } from "./text";

export interface FixResult {
  text: string;
  applied: string[];
  conflicts: string[];
}

type Fixable = Pick<Finding, "id" | "start" | "end" | "fix"> & { editedText?: string };

/** Applies many fixes at once, from the end of the text backwards, skipping overlaps. */
export function applyFixes(text: string, fixes: Fixable[]): FixResult {
  const replaces = fixes
    .filter((f) => f.fix && (f.fix.kind === "replace" || f.editedText !== undefined) && f.start >= 0)
    .map((f) => ({
      id: f.id,
      start: f.fix?.range?.start ?? f.start,
      end: f.fix?.range?.end ?? f.end,
      replacement: f.editedText ?? f.fix!.replacement,
    }))
    .sort((a, b) => b.start - a.start);
  const applied: string[] = [];
  const conflicts: string[] = [];
  let out = text;
  let floor = Infinity;
  for (const r of replaces) {
    if (r.end > floor) {
      conflicts.push(r.id);
      continue;
    }
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
    floor = r.start;
    applied.push(r.id);
  }
  // Tidy the seams: double spaces, a space before punctuation, and a footnote marker before punctuation ("tone*!" → "tone!*").
  out = out.replace(/ {2,}/g, " ").replace(/ +([.,!?])/g, "$1").replace(/\*([.,!?]+)/g, "$1*");
  const tail: string[] = [];
  for (const f of fixes) {
    if (!f.fix) continue;
    if (f.fix.kind === "append" && !out.includes(f.fix.replacement)) {
      tail.push(f.fix.replacement);
      applied.push(f.id);
    }
    if (f.fix.footnote && applied.includes(f.id) && !out.includes(f.fix.footnote) && !tail.includes(f.fix.footnote)) tail.push(f.fix.footnote);
  }
  if (tail.length) out = out.replace(/\s+$/, "") + "\n\n" + tail.join("\n");
  return { text: out, applied, conflicts };
}

export interface IntentResult {
  kept: boolean;
  lost: string[];
  gained: string[];
  ctaKept: boolean;
  summary: string;
}

const GENERIC = new Set(["daily", "new", "via", "get", "make", "help", "now"]);

const keyTerms = (s: string) => [...new Set(stems(s).filter((t) => t.length >= 4 && !GENERIC.has(t)))];

/** Heuristic intent check: are the key-message terms and the CTA still in the text? */
export function intentCheck(before: string, after: string, intent: IntentCard): IntentResult {
  const b = new Set(stems(before));
  const a = new Set(stems(after));
  const message = keyTerms(intent.keyMessage);
  const lost = message.filter((t) => b.has(t) && !a.has(t));
  const gained = message.filter((t) => !b.has(t) && a.has(t));
  const cta = keyTerms(intent.cta);
  const ctaBefore = cta.filter((t) => b.has(t));
  const ctaKept = ctaBefore.every((t) => a.has(t));
  const kept = lost.length === 0 && ctaKept;
  const summary = kept
    ? gained.length
      ? `Intent kept: key message intact and strengthened (+${gained.join(", ")})`
      : "Intent kept: key message and CTA intact"
    : `Check intent: ${[lost.length ? `lost key-message terms ${lost.join(", ")}` : "", ctaKept ? "" : "the CTA changed"].filter(Boolean).join("; ")}`;
  return { kept, lost, gained, ctaKept, summary };
}

const GOALS: [RegExp, string][] = [
  [/\b(launch|new|introduc|meet|debut)/i, "Launch awareness"],
  [/\b(off|sale|offer|discount|code|deal)\b/i, "Drive offer sales"],
  [/\b(study|r&d|research|science|tested)\b/i, "Build trust with evidence"],
  [/\b(buy|shop|order)\b/i, "Drive purchases"],
];

const CTA = /\b(shop|buy|order|visit|link in bio|sign up|subscribe|read|browse|see|try|download|book)\b/i;

/** Drafts an Intent Card without the AI. The creator always confirms it. */
export function draftIntent(text: string): IntentCard {
  const goal = GOALS.find(([re]) => re.test(text))?.[1] ?? "Engage the audience";
  const ss = sentences(text).map((s) => s.text.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim());
  const ctaSentence = [...ss].reverse().find((s) => CTA.test(s)) ?? "";
  const message = ss.find((s) => s !== ctaSentence && s.split(" ").length >= 4) ?? ss[0] ?? "";
  const clip = (s: string) => (s.length > 110 ? s.slice(0, 107).replace(/\s\S*$/, "") + "…" : s);
  return { goal, keyMessage: clip(message), cta: clip(ctaSentence), confirmed: false, draftedBy: "heuristic" };
}
