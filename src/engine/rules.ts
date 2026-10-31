// Deterministic rule checks: lexicon, banned phrases, channel limits,
// readability, link text, hashtags and required disclaimers. These run
// on every check, with or without the AI.
import type { Channel, KitContent, Rule } from "@/lib/types";
import { VELVRA_DISCLAIMER, VELVRA_VOCABULARY } from "@/seed/velvra-content";
import { readability } from "./readability";
import { EMOJI_RE, findPhrases, sentences, words } from "./text";
import type { RawFinding } from "./types";

export const activeRules = (kit: KitContent) => kit.rules.filter((r) => r.active && !r.pending);

export const appliesTo = (r: Rule, channel: Channel) => r.channels.length === 0 || r.channels.includes(channel);

/** Keeps the capital letter of the original when the replacement starts lowercase. */
export function matchCase(original: string, replacement: string): string {
  if (!replacement) return replacement;
  if (/^\p{Lu}/u.test(original) && /^\p{Ll}/u.test(replacement)) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/**
 * A deletion that also swallows emoji and spaces after the phrase. The word after it takes the capital
 * when the fix is applied, not as part of this fix's range, so that word stays free for its own finding.
 */
function deletionFix(text: string, start: number, end: number, label: string): RawFinding["fix"] {
  let e = end;
  const tail = /^(?:\s*\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)*[\s,]*/u.exec(text.slice(e));
  if (tail) e += tail[0].length;
  const atSentenceStart = start === 0 || /[.!?\n]\s*$/.test(text.slice(0, start));
  if (atSentenceStart && /\p{Ll}/u.test(text[e] ?? "")) return { kind: "replace", replacement: "", label, capNext: true, range: { start, end: e } };
  if (!atSentenceStart && /\s$/.test(text.slice(0, start)) && e === end) e += /^\s/.test(text.slice(e)) ? 1 : 0;
  return { kind: "replace", replacement: "", label, range: { start, end: e } };
}

function lexicalFindings(text: string, kit: KitContent, channel: Channel): RawFinding[] {
  const out: RawFinding[] = [];
  for (const r of activeRules(kit)) {
    if (!r.modes.includes("lexical") || !r.patterns.length || !appliesTo(r, channel)) continue;
    if (r.id === "CLAIM-03") continue; // superlatives are claims, handled below
    for (const m of findPhrases(text, r.patterns)) {
      const repl = r.replacements[m.phrase];
      const fix =
        repl === undefined
          ? r.fixTemplate
            ? { kind: "manual" as const, replacement: r.fixTemplate, label: "Rewrite" }
            : undefined
          : repl === ""
            ? deletionFix(text, m.start, m.end, `Remove “${m.text}”`)
            : { kind: "replace" as const, replacement: matchCase(m.text, repl), label: `Replace with “${matchCase(m.text, repl)}”` };
      out.push({
        ruleId: r.id,
        relatedRuleIds: [],
        category: r.category,
        severity: r.severity,
        origin: "rule",
        start: m.start,
        end: m.end,
        quote: m.text,
        title: r.title,
        reason: lexicalReason(r, m.text),
        fix,
        ...(r.category === "claim" ? { claimStatus: "unsupported" as const } : {}),
      });
    }
  }
  return out;
}

function lexicalReason(r: Rule, quote: string): string {
  const dont = r.donts.find((d) => d.toLowerCase().includes(quote.toLowerCase()));
  const base = `“${quote}” breaks ${r.id}: ${r.text}`;
  return dont ? `${base} The rule's own don't-example is “${dont}”.` : base;
}

function termFindings(text: string, kit: KitContent): RawFinding[] {
  const rules = new Map(activeRules(kit).map((r) => [r.id, r]));
  const out: RawFinding[] = [];
  for (const t of kit.terms) {
    const r = rules.get(t.ruleId);
    if (!r) continue;
    for (const m of findPhrases(text, t.banned)) {
      const replacement = matchCase(m.text, t.preferred);
      out.push({
        ruleId: r.id,
        relatedRuleIds: [],
        category: "term",
        severity: t.severity,
        origin: "rule",
        start: m.start,
        end: m.end,
        quote: m.text,
        title: r.title,
        reason: `Use “${t.preferred}”, not “${m.text}” (${r.id}). ${t.note}`,
        fix: { kind: "replace", replacement, label: `Replace with “${replacement}”` },
      });
    }
  }
  return out;
}

function superlativeFindings(text: string, kit: KitContent): RawFinding[] {
  const r = activeRules(kit).find((x) => x.id === "CLAIM-03");
  if (!r) return [];
  const out: RawFinding[] = [];
  const supported = new Set(kit.facts.flatMap((f) => f.triggers.map((t) => t.toLowerCase())));
  for (const s of sentences(text)) {
    for (const m of findPhrases(s.text, r.patterns)) {
      if (supported.has(m.phrase)) continue;
      let start = s.start + m.start;
      if (/\b(the|our|a)\s$/i.test(text.slice(Math.max(0, start - 4), start))) start = text.slice(0, start).search(/\S+\s$/);
      // The claim runs from the phrase to the end of its clause: "The best serum in India".
      const after = s.start + m.end;
      const rest = text.slice(after, s.end);
      const stop = rest.search(/[.!?;,:]|\s[—–]\s/);
      const end = after + (stop < 0 ? rest.length : stop);
      out.push({
        ruleId: r.id,
        relatedRuleIds: [],
        claimStatus: "unsupported",
        category: "claim",
        severity: r.severity,
        origin: "rule",
        start,
        end,
        quote: text.slice(start, end),
        title: "Unsupported superlative",
        reason: `“${text.slice(start, end)}” has no supporting fact in the Claim Ledger (${r.id}).`,
        fix: r.fixTemplate ? { kind: "replace", replacement: r.fixTemplate, label: "Use a supported line" } : undefined,
      });
    }
  }
  return out;
}

/** A snapshot from before the kit carried these fields can only be Velvra's, so it reads Velvra's. */
const vocabularyOf = (kit: KitContent) => kit.vocabulary ?? (kit.name === "Velvra" ? VELVRA_VOCABULARY : []);
const disclaimerOf = (kit: KitContent) => kit.disclaimer ?? (kit.name === "Velvra" ? VELVRA_DISCLAIMER : undefined);

/** A brand admin may write these patterns, so a broken one skips the check instead of breaking every check. */
function pattern(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

/** Splits "sunscreentok" into ["sunscreen", "tok"] using a small vocabulary. */
export function segmentHashtag(tag: string, vocab: Set<string>): string[] | null {
  const n = tag.length;
  const best: (string[] | null)[] = new Array(n + 1).fill(null);
  best[0] = [];
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - 16); j < i; j++) {
      const w = tag.slice(j, i);
      if (best[j] && (vocab.has(w) || /^\d+$/.test(w))) {
        const cand = [...best[j]!, w];
        if (!best[i] || cand.length < best[i]!.length) best[i] = cand;
      }
    }
  }
  return best[n];
}

function structuralFindings(text: string, kit: KitContent, channel: Channel): RawFinding[] {
  const out: RawFinding[] = [];
  const rules = new Map(activeRules(kit).map((r) => [r.id, r]));
  const limits = kit.channelLimits[channel];
  const voice = rules.get("VOICE-02");
  const social = rules.get("A11Y-05");

  if (voice) {
    const runs = [...text.matchAll(/!{2,}/g)];
    for (const m of runs) {
      out.push({
        ruleId: voice.id,
        relatedRuleIds: [],
        category: voice.category,
        severity: voice.severity,
        origin: "rule",
        start: m.index,
        end: m.index + m[0].length,
        quote: m[0],
        title: "Run of exclamation marks",
        reason: `“${m[0]}” breaks ${voice.id}: no runs of exclamation marks. The rule's own don't-example ends with “!!!”.`,
        fix: { kind: "replace", replacement: ".", label: "Replace with a full stop" },
      });
    }
    const singles = [...text.matchAll(/!/g)].map((m) => m.index);
    if (singles.length > limits.maxExclamation && !runs.length) {
      const extra = singles[limits.maxExclamation];
      out.push({
        ruleId: voice.id,
        relatedRuleIds: [],
        category: voice.category,
        severity: "low",
        origin: "rule",
        start: extra,
        end: extra + 1,
        quote: "!",
        title: "Too many exclamation marks",
        reason: `${channelName(channel)} allows ${limits.maxExclamation} exclamation mark${limits.maxExclamation === 1 ? "" : "s"}; this draft has ${singles.length} (${voice.id}).`,
        fix: { kind: "replace", replacement: ".", label: "Replace with a full stop" },
      });
    }
  }

  if (social) {
    const emoji = [...text.matchAll(EMOJI_RE)];
    if (emoji.length > limits.maxEmoji) {
      const first = emoji[limits.maxEmoji];
      out.push({
        ruleId: social.id,
        relatedRuleIds: [],
        category: social.category,
        severity: social.severity,
        origin: "rule",
        start: first.index,
        end: first.index + first[0].length,
        quote: first[0],
        title: "Too many emoji",
        reason: `${channelName(channel)} allows ${limits.maxEmoji} emoji; this draft has ${emoji.length}. Screen readers read each one aloud (${social.id}).`,
        fix: { kind: "replace", replacement: "", label: "Remove this emoji" },
      });
    }
    const acronyms = new Set(kit.acronyms.map((a) => a.toUpperCase()));
    const caps = words(text).filter((w) => /^\p{Lu}{3,}$/u.test(w.text) && !acronyms.has(w.text));
    for (const w of caps.slice(limits.maxCapsWords)) {
      const replacement = w.text[0] + w.text.slice(1).toLowerCase();
      out.push({
        ruleId: social.id,
        relatedRuleIds: [],
        category: social.category,
        severity: "low",
        origin: "rule",
        start: w.start,
        end: w.end,
        quote: w.text,
        title: "ALL-CAPS word",
        reason: `${channelName(channel)} allows ${limits.maxCapsWords} ALL-CAPS word${limits.maxCapsWords === 1 ? "" : "s"}. Screen readers may spell capitals letter by letter (${social.id}).`,
        fix: { kind: "replace", replacement, label: `Write “${replacement}”` },
      });
    }
    const vocab = new Set([
      ...vocabularyOf(kit),
      ...kit.terms.flatMap((t) => t.preferred.toLowerCase().split(/\s+/)),
      ...words(kit.facts.map((f) => f.keywords.join(" ")).join(" ")).map((w) => w.text.toLowerCase()),
      ...kit.pillars.flatMap((p) => p.split(/\s+/)),
    ]);
    for (const m of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
      const tag = m[1];
      if (tag.length < 8 || tag !== tag.toLowerCase() || /^\d+$/.test(tag)) continue;
      const parts = segmentHashtag(tag, vocab);
      const camel = parts ? "#" + parts.map((p) => p[0].toUpperCase() + p.slice(1)).join("") : undefined;
      out.push({
        ruleId: social.id,
        relatedRuleIds: [],
        category: social.category,
        severity: social.severity,
        origin: "rule",
        start: m.index,
        end: m.index + m[0].length,
        quote: m[0],
        title: "Hashtag is not CamelCase",
        reason: `Screen readers read “${m[0]}” as one long word. Capitalise each word (${social.id}).`,
        fix: camel
          ? { kind: "replace", replacement: camel, label: `Write “${camel}”` }
          : { kind: "manual", replacement: "Capitalise each word of the hashtag", label: "Capitalise each word" },
      });
    }
  }

  const read = rules.get("A11Y-03");
  if (read) {
    const r = readability(text);
    if (r.words >= 60 && r.flesch < limits.readabilityMin) {
      const longest = sentences(text).sort((a, b) => words(b.text).length - words(a.text).length)[0];
      out.push({
        ruleId: read.id,
        relatedRuleIds: [],
        category: read.category,
        severity: read.severity,
        origin: "rule",
        start: longest.start,
        end: longest.end,
        quote: longest.text,
        title: "Hard to read for this channel",
        reason: `Flesch reading ease is ${r.flesch}; ${channelName(channel)} copy should be ${limits.readabilityMin} or higher (${read.id}). This is the longest sentence.`,
        fix: { kind: "manual", replacement: "Split this sentence and prefer shorter words.", label: "Simplify" },
      });
    }
  }

  const disclaimer = disclaimerOf(kit);
  const legal = disclaimer && rules.get(disclaimer.ruleId);
  const mentions = disclaimer && pattern(disclaimer.mentions);
  const present = disclaimer && pattern(disclaimer.present);
  if (legal && mentions && present && appliesTo(legal, channel)) {
    const mention = mentions.exec(text);
    if (mention && !present.test(text)) {
      out.push({
        ruleId: legal.id,
        relatedRuleIds: [],
        category: legal.category,
        severity: legal.severity,
        origin: "rule",
        start: mention.index,
        end: mention.index + mention[0].length,
        quote: mention[0],
        title: "Missing reapply disclaimer",
        reason: `${channelName(channel)} copy that mentions SPF must include the reapply disclaimer (${legal.id}).`,
        fix: { kind: "append", replacement: legal.fixTemplate ?? "Reapply every 2 hours.", label: "Add the disclaimer at the end" },
      });
    }
  }
  return out;
}

export const channelName = (c: Channel) => ({ instagram: "Instagram", email: "Email", website: "Website", linkedin: "LinkedIn", brochure: "Brochure" })[c];

export function ruleChecks(text: string, kit: KitContent, channel: Channel): RawFinding[] {
  return [...lexicalFindings(text, kit, channel), ...termFindings(text, kit), ...superlativeFindings(text, kit), ...structuralFindings(text, kit, channel)];
}
