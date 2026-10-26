// The evidence verifier. Every AI finding must quote text that really exists
// in the draft, at the offsets it claims, and cite a judgment rule that exists
// in the active rulebook. Anything that fails is dropped and counted.
import type { Channel, DroppedFinding, KitContent } from "@/lib/types";
import { appliesTo } from "./rules";
import type { RawFinding } from "./types";

export interface AiFindingIn {
  rule_id: string;
  quote: string;
  start: number;
  end: number;
  reason: string;
  fix?: string;
  confidence: number;
}

export interface Verified {
  kept: RawFinding[];
  dropped: DroppedFinding[];
  relocated: number;
}

function occurrences(text: string, quote: string, caseInsensitive = false): number[] {
  const hay = caseInsensitive ? text.toLowerCase() : text;
  const needle = caseInsensitive ? quote.toLowerCase() : quote;
  const out: number[] = [];
  let i = hay.indexOf(needle);
  while (i >= 0) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

export function verifyAiFindings(text: string, raw: AiFindingIn[], kit: KitContent, channel: Channel, model: string): Verified {
  const rules = new Map(kit.rules.filter((r) => r.active && !r.pending).map((r) => [r.id, r]));
  const kept: RawFinding[] = [];
  const dropped: DroppedFinding[] = [];
  let relocated = 0;

  for (const f of raw) {
    const rule = rules.get(f.rule_id);
    if (!rule) {
      dropped.push({ reason: "Cites a rule that is not in the active rulebook", ruleId: f.rule_id, quote: f.quote });
      continue;
    }
    if (!rule.modes.includes("judgment")) {
      dropped.push({ reason: "Cites a rule that is checked in code, not by judgment", ruleId: f.rule_id, quote: f.quote });
      continue;
    }
    if (!appliesTo(rule, channel)) {
      dropped.push({ reason: "Cites a rule that does not apply to this channel", ruleId: f.rule_id, quote: f.quote });
      continue;
    }
    const quote = (f.quote ?? "").trim();
    if (quote.length < 2) {
      dropped.push({ reason: "Has no quoted evidence", ruleId: f.rule_id });
      continue;
    }
    let start = f.start;
    let end = f.end;
    if (text.slice(start, end) !== quote) {
      const exact = occurrences(text, quote);
      const loose = exact.length ? exact : occurrences(text, quote, true);
      if (loose.length !== 1) {
        dropped.push({
          reason: loose.length ? "Quote appears more than once and the offsets are wrong" : "Quote does not appear in the draft",
          ruleId: f.rule_id,
          quote,
        });
        continue;
      }
      start = loose[0];
      end = start + quote.length;
      relocated++;
    }
    const confidence = Math.max(0, Math.min(1, Number(f.confidence) || 0));
    const replacement = (f.fix ?? "").trim();
    kept.push({
      ruleId: rule.id,
      relatedRuleIds: [],
      category: rule.category,
      severity: confidence < 0.5 ? "low" : rule.severity,
      origin: "ai",
      model,
      confidence,
      suggestion: confidence < 0.5,
      start,
      end,
      quote: text.slice(start, end),
      title: rule.title,
      reason: (f.reason ?? "").trim() || rule.text,
      fix:
        replacement && replacement !== quote
          ? { kind: "replace", replacement, label: "Use the suggested edit" }
          : undefined,
    });
  }
  return { kept, dropped, relocated };
}
