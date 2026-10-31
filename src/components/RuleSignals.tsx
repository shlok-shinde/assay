"use client";

// What the review history says about one rule: how unclear it looks (a streak on a touchstone) and how
// often the fixes it offered were taken. Both are computed from real findings and events, and both say
// so plainly when there is nothing to show yet.
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { acceptanceByRule, UNCLEAR_AT, type FixAcceptance } from "@/engine/health";

/**
 * A score as an assayer reads it: a gold streak drawn on the dark stone, as long as the score (0 to 100),
 * with a tick where a rule starts to count as unclear. A score of 0 leaves the stone bare. The streak
 * carries `data-bar`, so a list can grow its streaks in with useDealIn. Pass `flagged={null}` for a score
 * that has no threshold (the share of fixes accepted), and `label` to say it in words.
 */
export function Touchstone({
  score,
  flagged = UNCLEAR_AT,
  label,
  size = "md",
  className = "",
}: {
  score: number;
  flagged?: number | null;
  label?: string;
  size?: "md" | "lg";
  className?: string;
}) {
  const s = Math.min(100, Math.max(0, score));
  const span = (n: number) => `calc((100% - 8px) * ${n / 100})`;
  const lg = size === "lg";
  return (
    <span
      role="img"
      aria-label={label ?? `Unclear score ${s} out of 100. A rule counts as unclear from ${flagged}.`}
      className={`relative block w-full rounded-full bg-field ${lg ? "h-7" : "h-4"} ${className}`}
    >
      {s > 0 && (
        <>
          <span data-bar aria-hidden="true" className={`absolute left-1 block rounded-full bg-gold-mark ${lg ? "top-[5px] h-[12px]" : "top-[3px] h-[7px]"}`} style={{ width: span(s) }} />
          <span aria-hidden="true" className={`absolute left-1 block rounded-full bg-gold-mark opacity-45 ${lg ? "top-[20px] h-[3px]" : "top-[11px] h-[2px]"}`} style={{ width: span(s * 0.62) }} />
        </>
      )}
      {flagged !== null && <span aria-hidden="true" className="absolute bottom-0.5 top-0.5 block w-[2px] rounded-full bg-faint" style={{ left: `calc(4px + (100% - 8px) * ${flagged / 100} - 1px)` }} />}
    </span>
  );
}

/** The share of offered fixes that were accepted or lightly edited, as a streak. Nothing to draw until a fix has been decided. */
export function AcceptanceStone({ a, size = "md", className = "" }: { a?: FixAcceptance; size?: "md" | "lg"; className?: string }) {
  if (!a || a.rate === null) return null;
  const pct = Math.round(a.rate * 100);
  return <Touchstone score={pct} flagged={null} size={size} className={className} label={`Fixes accepted ${pct} percent, of ${a.decided} decided.`} />;
}

/** Acceptance by rule from the stored fix events, live. Undefined until the first read. */
export function useAcceptance(): Map<string, FixAcceptance> | undefined {
  const events = useLiveQuery(() => db.events.toArray(), []);
  return useMemo(() => (events ? new Map(acceptanceByRule(events).map((a) => [a.ruleId, a])) : undefined), [events]);
}

export const percent = (rate: number) => `${Math.round(rate * 100)}%`;

/** Table cell form: the rate with its n, or a dash that says why in words for assistive tech. */
export function AcceptanceCell({ a }: { a?: FixAcceptance }) {
  if (!a || a.rate === null) {
    return (
      <span className="text-faint">
        <span aria-hidden="true">—</span>
        <span className="sr-only">no fixes decided yet</span>
      </span>
    );
  }
  return (
    <span className="num flex items-center justify-end gap-2.5">
      <AcceptanceStone a={a} className="!w-14" />
      <span className="w-[74px] text-right">
        {percent(a.rate)} <span className="text-[12px] text-muted">n {a.decided}</span>
      </span>
    </span>
  );
}

/** Sentence form, for a rule's detail: the figure, what it counts, and what it leaves out. */
export function AcceptanceNote({ ruleId, a, className = "" }: { ruleId: string; a?: FixAcceptance; className?: string }) {
  const decided = a?.rate !== null && a?.rate !== undefined;
  return (
    <div className={`text-[13px] leading-5 ${className}`} data-acceptance={ruleId}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-muted">Fixes accepted</span>
        {decided ? (
          <>
            <span className="num text-[18px] font-medium">{percent(a!.rate!)}</span>
            <span className="num text-muted">
              n {a!.decided}: {a!.accepted} accepted or lightly edited{a!.offered > a!.decided ? `, ${a!.offered - a!.decided} not decided` : ""}
            </span>
          </>
        ) : (
          <>
            <span className="text-[18px] text-faint" aria-hidden="true">
              —
            </span>
            <span className="text-muted">
              no fixes decided yet{a && a.offered > 0 ? ` (${a.offered} offered)` : ""}
            </span>
          </>
        )}
      </p>
      <p className="mt-0.5 text-faint">Automated test runs are left out.</p>
    </div>
  );
}
