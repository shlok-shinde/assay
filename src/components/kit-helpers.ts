// Small rules the Brand Kit's editors share, kept apart from the screens so they can be tested alone.
import type { Fact, Rule } from "@/lib/types";

/** Next id for a rule family: TERM-06 after TERM-05, whatever was deleted since. */
export const nextRuleId = (rules: Pick<Rule, "id">[], prefix: string) => {
  const top = Math.max(0, ...rules.filter((r) => r.id.startsWith(`${prefix}-`)).map((r) => Number(r.id.slice(prefix.length + 1)) || 0));
  return `${prefix}-${String(top + 1).padStart(2, "0")}`;
};

/** Next fact id: F-101 for an empty ledger, otherwise one past the highest number in use. */
export const nextFactId = (facts: Pick<Fact, "id">[]) => `F-${Math.max(100, ...facts.map((f) => Number(f.id.replace(/\D/g, "")) || 0)) + 1}`;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc" and "#AABBCC" both become "#AABBCC"; anything else is not a colour here. */
export function normaliseHex(raw: string): string | null {
  const v = raw.trim();
  if (!HEX.test(v)) return null;
  const six = v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
  return six.toUpperCase();
}
