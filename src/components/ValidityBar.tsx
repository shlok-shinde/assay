"use client";

import { formatDate } from "@/engine/claims";
import type { Fact } from "@/lib/types";
import { stripGeometry, whenWords } from "./alerts";

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/**
 * A fact's validity as a bar with today marked on it, computed from its validFrom and validTo: gold for the
 * time already used, a lighter step for what is left, red past the expiry, and a cream tick for today. A fact
 * with no end date has no bar to draw, and says so with a dash.
 */
export function ValidityBar({ fact, today, className = "" }: { fact: Fact; today: string; className?: string }) {
  if (!fact.validTo) {
    return (
      <span className="text-faint">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No end date set</span>
      </span>
    );
  }
  const g = stripGeometry(fact.validFrom, fact.validTo, today);
  const used = Math.max(0, Math.min(g.now, g.end) - g.start);
  const left = Math.max(0, g.end - Math.max(g.now, g.start));
  const label = `${fact.validFrom ? `Valid from ${formatDate(fact.validFrom)}` : "No start date set"}, valid to ${formatDate(fact.validTo)}. Today is ${formatDate(today)}: it ${whenWords(daysBetween(today, fact.validTo))}.`;
  return (
    <div role="img" aria-label={label} className={`relative h-3 min-w-[110px] rounded-full bg-field ${className}`}>
      {used > 0 && <span aria-hidden="true" className="absolute inset-y-[3px] block rounded-full bg-gold-mark" style={{ left: `${g.start}%`, width: `${used}%` }} />}
      {left > 0 && <span aria-hidden="true" className="absolute inset-y-[4px] block rounded-full bg-bar" style={{ left: `${Math.max(g.now, g.start)}%`, width: `${left}%` }} />}
      {g.expired && <span aria-hidden="true" className="absolute inset-y-[3px] block rounded-full bg-negative" style={{ left: `${g.end}%`, width: `${g.now - g.end}%` }} />}
      <span aria-hidden="true" className="absolute -inset-y-[3px] block w-1 rounded-full bg-ink" style={{ left: `calc(${g.now}% - 2px)` }} />
    </div>
  );
}
