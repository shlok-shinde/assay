// Intent-preserving fixes: each fix replaces only its own span, footnotes are
// added once, and an intent check compares the key message and CTA before
// and after.
import type { Channel, Finding, IntentCard, IntentCheckResult, KitContent } from "@/lib/types";
import { analyzeClaims } from "./claims";
import { compare } from "./merge";
import { findQuantities, formatQuantity, sameAmount } from "./quantities";
import { ruleChecks } from "./rules";
import { sentences, stems } from "./text";
import type { RawFinding } from "./types";

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
      capNext: f.editedText === undefined && f.fix?.capNext,
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
    const rest = out.slice(r.end);
    out = out.slice(0, r.start) + r.replacement + (r.capNext ? rest.charAt(0).toUpperCase() + rest.slice(1) : rest);
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

type Plannable = Fixable & Pick<RawFinding, "ruleId" | "quote" | "severity" | "category" | "origin">;

const rangeOf = (f: Fixable) => ({ start: f.fix?.range?.start ?? f.start, end: f.fix?.range?.end ?? f.end });
const textOf = (f: Fixable) => f.editedText ?? f.fix!.replacement;
const isInline = (f: Fixable) => !!f.fix && f.start >= 0 && (f.fix.kind === "replace" || f.editedText !== undefined);

export interface MergeContext {
  kit: KitContent;
  channel: Channel;
  today: string;
}

/** Fixes that want the same words: only one can apply, unless they can be merged. */
export interface FixConflict {
  id: string;
  ids: string[];
  start: number;
  end: number;
  before: string;
  /** The more serious finding's fix, used when nobody chooses. */
  defaultId: string;
  options: { id: string; ruleId: string; text: string }[];
  /** A merge that passed validateMerge, covering start to end. Absent when no safe merge exists. */
  merged?: string;
}

export interface FixPlan {
  conflicts: FixConflict[];
  /** Sentences that several non-overlapping fixes change. They compose, and their check reads the result as one. */
  composed: { start: number; end: number; before: string; ids: string[] }[];
}

export type ConflictChoice = { kind: "fix"; id: string } | { kind: "text"; text: string };

const issues = (text: string, ctx: MergeContext) => [...ruleChecks(text, ctx.kit, ctx.channel), ...analyzeClaims(text, ctx.kit, ctx.today).findings];
const issueKey = (f: Pick<RawFinding, "ruleId" | "quote">) => `${f.ruleId}|${f.quote.toLowerCase()}`;

/**
 * Is merged text safe? It must add no finding and no number the fixes didn't bring, must clear what
 * the merged fixes were for, and must keep approved claim wording character for character.
 */
export function validateMerge(before: string, after: string, fixes: Plannable[], ctx: MergeContext): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const had = new Set(issues(before, ctx).map(issueKey));
  const fresh = issues(after, ctx).filter((f) => !had.has(issueKey(f)));
  for (const f of fresh) problems.push(`It adds a new problem: ${f.ruleId} on “${f.quote}”.`);
  const answered = new Set(fixes.map(issueKey));
  for (const f of issues(after, ctx)) if (answered.has(issueKey(f))) problems.push(`${f.ruleId} still fires on “${f.quote}”.`);
  const allowed = [...findQuantities(before), ...fixes.flatMap((f) => findQuantities(textOf(f)))];
  for (const q of findQuantities(after)) if (!allowed.some((a) => sameAmount(a, q))) problems.push(`It adds a number that was not there: ${formatQuantity(q)}.`);
  for (const f of fixes) if (f.category === "claim" && !after.includes(textOf(f))) problems.push(`It changes the approved wording: “${textOf(f)}”.`);
  return { ok: problems.length === 0, problems };
}

/** Applies each fix in turn over the shared words. A later fix applies only if its own quote survived the earlier ones. */
function mergeInOrder(text: string, start: number, end: number, order: Plannable[]): string {
  let out = text.slice(start, end);
  order.forEach((f, i) => {
    const r = rangeOf(f);
    const old = text.slice(r.start, r.end);
    if (i === 0) out = text.slice(start, r.start) + textOf(f) + text.slice(r.end, end);
    else {
      const at = out.toLowerCase().indexOf(old.toLowerCase());
      if (at >= 0) out = out.slice(0, at) + textOf(f) + out.slice(at + old.length);
    }
  });
  return out;
}

/** Sorts accepted fixes into those that simply apply, those that share a sentence, and those that truly collide. */
export function planFixes(text: string, fixes: Plannable[], ctx?: MergeContext): FixPlan {
  const inline = fixes.filter(isInline).sort((a, b) => rangeOf(a).start - rangeOf(b).start);
  const groups: Plannable[][] = [];
  let reach = -1;
  for (const f of inline) {
    const r = rangeOf(f);
    if (groups.length && r.start < reach) groups[groups.length - 1].push(f);
    else groups.push([f]);
    reach = Math.max(reach, r.end);
  }
  const conflicts = groups
    .filter((g) => g.length > 1)
    .map((g): FixConflict => {
      const start = Math.min(...g.map((f) => rangeOf(f).start));
      const end = Math.max(...g.map((f) => rangeOf(f).end));
      const ranked = [...g].sort((a, b) => compare(a as unknown as RawFinding, b as unknown as RawFinding));
      const conflict: FixConflict = {
        id: g.map((f) => f.id).join("+"),
        ids: g.map((f) => f.id),
        start,
        end,
        before: text.slice(start, end),
        defaultId: ranked[0].id,
        options: ranked.map((f) => ({ id: f.id, ruleId: f.ruleId, text: textOf(f) })),
      };
      if (ctx) {
        for (const order of [ranked, [...ranked].reverse()]) {
          const merged = mergeInOrder(text, start, end, order);
          if (validateMerge(text, text.slice(0, start) + merged + text.slice(end), g, ctx).ok) {
            conflict.merged = merged;
            break;
          }
        }
      }
      return conflict;
    });
  const clean = groups.filter((g) => g.length === 1).map((g) => g[0]);
  const composed = sentences(text)
    .map((s) => ({ start: s.start, end: s.end, before: text.slice(s.start, s.end), ids: clean.filter((f) => rangeOf(f).start >= s.start && rangeOf(f).end <= s.end).map((f) => f.id) }))
    .filter((s) => s.ids.length > 1);
  return { conflicts, composed };
}

/** Applies accepted fixes following the plan: each conflict goes to the chosen fix, chosen text, or the default fix. */
export function applyFixPlan(text: string, fixes: Plannable[], plan: FixPlan, choices: Record<string, ConflictChoice> = {}): FixResult {
  const drop = new Set<string>();
  const merged = new Map<string, string[]>();
  const extra: Fixable[] = [];
  const conflicts: string[] = [];
  for (const c of plan.conflicts) {
    const choice = choices[c.id] ?? { kind: "fix", id: c.defaultId };
    if (choice.kind === "fix") {
      for (const id of c.ids) {
        if (id === choice.id) continue;
        drop.add(id);
        conflicts.push(id);
      }
      continue;
    }
    for (const id of c.ids) drop.add(id);
    merged.set(c.id, c.ids);
    const footnotes = fixes.filter((f) => c.ids.includes(f.id) && f.fix?.footnote).map((f) => f.fix!.footnote!);
    // Text that deletes a sentence's opening hands its capital to the next word, as the deletion itself would have.
    const capNext = !choice.text && fixes.some((f) => c.ids.includes(f.id) && f.fix?.capNext);
    extra.push({ id: c.id, start: c.start, end: c.end, fix: { kind: "replace", replacement: choice.text, label: "Merged fixes", footnote: footnotes[0], capNext } });
    for (const note of footnotes.slice(1)) extra.push({ id: `${c.id}:${note}`, start: -1, end: -1, fix: { kind: "append", replacement: note, label: "Footnote" } });
  }
  const r = applyFixes(text, [...fixes.filter((f) => !drop.has(f.id)), ...extra]);
  return { text: r.text, applied: [...new Set(r.applied.flatMap((id) => merged.get(id) ?? (id.includes(":") ? [] : [id])))], conflicts: [...conflicts, ...r.conflicts] };
}

export interface IntentResult {
  /** False when the Intent Card has no key message or CTA to compare against. */
  checked: boolean;
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
  const message = keyTerms(intent.keyMessage);
  if (!message.length && !keyTerms(intent.cta).length) {
    return { checked: false, kept: true, lost: [], gained: [], ctaKept: true, summary: "Intent not checked: this draft's Intent Card has no key message or CTA" };
  }
  const b = new Set(stems(before));
  const a = new Set(stems(after));
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
  return { checked: true, kept, lost, gained, ctaKept, summary };
}

export type IntentVerdict = IntentCheckResult & { verdict: NonNullable<IntentCheckResult["verdict"]> };

/**
 * One verdict from the term check and the AI's reading. When they agree it is that answer;
 * when they disagree it is "review", with both reasons in one sentence for the creator to judge.
 */
export function intentVerdict(h: IntentResult, ai?: { kept: boolean; explanation: string; model: string }): IntentVerdict {
  if (!h.checked) return { kept: true, verdict: "unchecked", summary: h.summary };
  const explanation = ai?.explanation.trim().replace(/\.$/, "");
  if (!ai) return { kept: h.kept, verdict: h.kept ? "kept" : "review", summary: h.summary };
  if (h.kept && ai.kept) return { kept: true, verdict: "kept", summary: `${h.summary}; the AI check agrees`, ai };
  if (!h.kept && !ai.kept) return { kept: false, verdict: "lost", summary: `Intent may be lost: ${explanation}`, ai };
  return {
    kept: false,
    verdict: "review",
    summary: h.kept
      ? `Check intent: the key-message terms are intact, but the AI check reads it differently (${explanation})`
      : `${h.summary}, but the AI check finds the message intact (${explanation})`,
    ai,
  };
}

/** The term check on one fix alone, stored on the finding so the card can say it without recomputing. */
export function fixIntent(text: string, f: Fixable, intent: IntentCard): IntentVerdict {
  return intentVerdict(intentCheck(text, applyFixes(text, [f]).text, intent));
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
