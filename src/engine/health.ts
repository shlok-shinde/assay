// Guideline Health: which rules confuse people, which mistakes repeat, and
// which facts are about to expire. Computed from findings and their outcomes.
import type { Fact, Finding, KitContent, Rule, Submission } from "@/lib/types";

export interface RuleHealth {
  rule: Rule;
  fires: number;
  dismissed: number;
  contested: number;
  disagreed: number;
  approvedDespite: number;
  score: number;
  unclear: boolean;
  topAudience?: { audience: string; share: number };
  topChannel?: { channel: string; share: number };
  examples: { quote: string; reason?: string; status: string; channel: string; audience: string; seeded: boolean }[];
  suggestion: string;
}

export interface RepeatPattern {
  ruleId: string;
  by: string;
  kind: "channel" | "creator";
  count: number;
}

export interface FactAlert {
  fact: Fact;
  daysLeft: number;
  expired: boolean;
}

export const MIN_FIRES = 4;
export const UNCLEAR_AT = 25;

const share = <T,>(items: T[]): { value: T; share: number } | undefined => {
  if (!items.length) return undefined;
  const counts = new Map<T, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  const [value, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { value, share: n / items.length };
};

/** Weighted signal that a rule is unclear, 0 to 100. Dismissals and contests weigh most. */
export function unclearScore(fires: number, dismissed: number, contested: number, disagreed: number, approvedDespite: number): number {
  if (!fires) return 0;
  const s = 0.35 * (dismissed / fires) + 0.35 * (contested / fires) + 0.15 * (disagreed / fires) + 0.15 * (approvedDespite / fires);
  return Math.round(s * 100);
}

export function suggestClarification(h: Omit<RuleHealth, "suggestion">, kit: KitContent): string {
  if (h.topAudience && h.topAudience.share >= 0.6 && h.dismissed >= h.contested) {
    return `Add a scoped exception to ${h.rule.id}: for campaigns aimed at “${h.topAudience.audience}”${
      h.topChannel && h.topChannel.share >= 0.6 ? ` on ${h.topChannel.channel}` : ""
    }, informal slang is allowed with reviewer sign-off, but hype claims (“insane results”, “!!!”) are still not. Add two approved examples from the dismissed findings below.`;
  }
  if (h.contested >= h.dismissed && h.rule.modes.includes("judgment")) {
    return `Make ${h.rule.id} testable. Say exactly what passes, e.g. “Launch posts mention at least one pillar (${kit.pillars.join(", ")}) in the first two sentences.” Add one do and one don't example from the contested findings below.`;
  }
  return `Add do and don't examples to ${h.rule.id} from the dismissed findings below, and say when the rule does not apply.`;
}

export function ruleHealth(kit: KitContent, findings: Finding[], submissions: Submission[]): RuleHealth[] {
  const subs = new Map(submissions.map((s) => [s.id, s]));
  return kit.rules
    .filter((r) => !r.pending)
    .map((rule) => {
      const fs = findings.filter((f) => f.ruleId === rule.id && f.status !== "superseded");
      const dismissed = fs.filter((f) => f.status === "dismissed");
      const contested = fs.filter((f) => f.status === "contested");
      const disagreed = fs.filter((f) => f.status === "reopened").length;
      const approvedDespite = fs.filter(
        (f) => subs.get(f.submissionId)?.status === "approved" && ["dismissed", "contested", "open"].includes(f.status),
      ).length;
      const pushback = [...dismissed, ...contested];
      const audience = share(pushback.map((f) => subs.get(f.submissionId)?.audience ?? "Unknown"));
      const channel = share(pushback.map((f) => subs.get(f.submissionId)?.channel ?? "unknown"));
      const score = unclearScore(fs.length, dismissed.length, contested.length, disagreed, approvedDespite);
      const base = {
        rule,
        fires: fs.length,
        dismissed: dismissed.length,
        contested: contested.length,
        disagreed,
        approvedDespite,
        score,
        unclear: fs.length >= MIN_FIRES && score >= UNCLEAR_AT,
        topAudience: audience && { audience: audience.value, share: audience.share },
        topChannel: channel && { channel: channel.value, share: channel.share },
        examples: pushback.slice(0, 4).map((f) => {
          const s = subs.get(f.submissionId);
          return {
            quote: f.quote,
            reason: f.resolution?.reason,
            status: f.status,
            channel: s?.channel ?? "",
            audience: s?.audience ?? "",
            seeded: !!s?.seeded,
          };
        }),
      };
      return { ...base, suggestion: suggestClarification(base, kit) };
    })
    .sort((a, b) => b.score - a.score || b.fires - a.fires);
}

export function repeatPatterns(findings: Finding[], submissions: Submission[], min = 3): RepeatPattern[] {
  const subs = new Map(submissions.map((s) => [s.id, s]));
  const counts = new Map<string, RepeatPattern>();
  for (const f of findings) {
    if (f.status === "superseded") continue;
    const s = subs.get(f.submissionId);
    if (!s) continue;
    for (const [kind, by] of [
      ["channel", s.channel],
      ["creator", s.agency ? `${s.agency}` : s.creator],
    ] as const) {
      const key = `${f.ruleId}|${kind}|${by}`;
      const p = counts.get(key) ?? { ruleId: f.ruleId, by, kind, count: 0 };
      p.count++;
      counts.set(key, p);
    }
  }
  return [...counts.values()].filter((p) => p.count >= min).sort((a, b) => b.count - a.count).slice(0, 10);
}

export function factAlerts(facts: Fact[], today: string, withinDays = 30): FactAlert[] {
  const t = Date.parse(today + "T00:00:00Z");
  return facts
    .filter((f) => f.validTo)
    .map((f) => {
      const daysLeft = Math.round((Date.parse(f.validTo! + "T00:00:00Z") - t) / 86_400_000);
      return { fact: f, daysLeft, expired: daysLeft < 0 };
    })
    .filter((a) => a.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
