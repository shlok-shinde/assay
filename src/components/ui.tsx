"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { SlideIn, useGlide } from "./motion";
import type { Category, FindingStatus, Role, Severity, SubmissionStatus } from "@/lib/types";

/** The Assay mark: a hallmark punch, the stamp an assay office strikes into tested gold. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 3h20l3 5v12c0 5-6 8.5-13 10C9 28.5 3 25 3 20V8z" fill="#b8860b" />
      <path d="M10 22 16 9l6 13M12.4 17h7.2" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SHIELD = "M6 3h20l3 5v12c0 5-6 8.5-13 10C9 28.5 3 25 3 20V8z";

/**
 * The loading mark: the hallmark punch being assayed. Gold rises inside the shield, the A is struck
 * into it, the punch presses once, and the cycle starts again. With reduced motion it rests filled.
 */
export function AssayLoader({ size = 16 }: { size?: number }) {
  const clip = `assay-${useId().replace(/:/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="assay-loader flex-none" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <path d={SHIELD} />
        </clipPath>
      </defs>
      <path d={SHIELD} fill="none" stroke="var(--color-gold-mark)" strokeOpacity=".45" strokeWidth="2" />
      <g clipPath={`url(#${clip})`}>
        <g className="assay-fill">
          <path className="assay-wave" d="M0 0Q4 -2 8 0T16 0T24 0T32 0T40 0T48 0T56 0T64 0V36H0Z" fill="var(--color-gold-mark)" />
        </g>
      </g>
      <path className="assay-strike" d="M10 22 16 9l6 13M12.4 17h7.2" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
    </svg>
  );
}

/** A whole screen still loading: the mark at size, with what is loading said plainly. */
export function PageLoading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-6 text-[15px] text-muted">
      <AssayLoader size={36} />
      {label}
    </div>
  );
}

/**
 * A notice that takes the whole screen or the whole page area: an error, a missing page, blocked
 * storage. The mark, one plain sentence of what happened, and what to do next. The panel is a
 * lightness step above its ground, round, with no border.
 */
export function StatusPanel({ title, children, actions, fullscreen }: { title: ReactNode; children: ReactNode; actions?: ReactNode; fullscreen?: boolean }) {
  const panel = (
    <section className={`w-full max-w-[540px] rounded-[28px] p-7 md:p-9 ${fullscreen ? "bg-sheet" : "bg-raised"}`}>
      <Mark size={36} />
      <h1 className="mt-5 font-display text-[26px] font-medium leading-8 tracking-[-0.02em] md:text-[30px] md:leading-9">{title}</h1>
      <div className="mt-3 space-y-3 text-[15px] leading-7 text-muted">{children}</div>
      {actions && <div className="mt-7 flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
  return fullscreen ? (
    <main className="theme-night flex min-h-screen items-center justify-center bg-chrome px-4 py-10 text-ink">{panel}</main>
  ) : (
    <div className="flex justify-center px-4 py-10 md:py-16">{panel}</div>
  );
}

const SEVERITY: Record<Severity, { label: string; cls: string }> = {
  high: { label: "High", cls: "bg-neg-bg text-neg-ink" },
  medium: { label: "Medium", cls: "bg-warn-bg text-warn-ink border border-warn-line" },
  low: { label: "Low", cls: "bg-neutral-bg text-neutral-ink" },
};

export function SeverityPill({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  tone: "Tone",
  term: "Terminology",
  message: "Messaging",
  claim: "Claim",
  visual: "Visual",
  accessibility: "Accessibility",
  legal: "Legal",
};

const SUB_STATUS: Record<SubmissionStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-neutral-bg text-neutral-ink" },
  checked: { label: "Checked", cls: "bg-neutral-bg text-neutral-ink" },
  in_review: { label: "In review", cls: "bg-gold-soft text-gold-ink" },
  changes_requested: { label: "Changes requested", cls: "bg-warn-bg text-warn-ink border border-warn-line" },
  approved: { label: "Approved", cls: "bg-pos-bg text-pos-ink" },
};

export function StatusPill({ status }: { status: SubmissionStatus }) {
  const s = SUB_STATUS[status];
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
}

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  accepted: "Fix accepted",
  edited: "Fix edited",
  dismissed: "Dismissed",
  contested: "Rule contested",
  sent_to_compliance: "With Compliance",
  compliance_approved: "Approved by Compliance",
  reopened: "Reopened",
  waived: "Approved while open",
  superseded: "Superseded",
};

export const ROLE_LABEL: Record<Role, string> = {
  creator: "Creator",
  reviewer: "Reviewer",
  compliance: "Compliance",
  admin: "Brand Admin",
};

/**
 * Tabs the way a keyboard expects them: one stop in the Tab order (the chosen tab), Left and Right to
 * move between tabs with Home and End for the ends, and each tab choosing as focus lands on it. Give it
 * the same `idBase` as the TabPanel that shows its content, so each tab and its panel name each other.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label, idBase }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void; label: string; idBase: string }) {
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  useGlide(box, bar, '[aria-selected="true"]', [value, tabs.length]);
  const move = (e: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const to = e.key === "ArrowRight" ? (at + 1) % tabs.length : e.key === "ArrowLeft" ? (at - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    box.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
    onChange(tabs[to].id);
  };
  return (
    <div ref={box} role="tablist" aria-label={label} className="relative flex gap-7 overflow-x-auto border-b border-line">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          id={`${idBase}-tab-${t.id}`}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          aria-controls={`${idBase}-panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => move(e, i)}
          className={`tab-btn relative h-11 shrink-0 text-[14.5px] transition-colors duration-300 ${value === t.id ? "text-ink font-medium" : "text-muted hover:text-ink"}`}
        >
          {t.label}
        </button>
      ))}
      <span ref={bar} aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-[3px] rounded-full bg-ink opacity-0" />
    </div>
  );
}

/** The panel for one tab: labelled by it, and sliding in when the tab changes. Only the chosen tab's panel is rendered. */
export function TabPanel({ idBase, id, className, children }: { idBase: string; id: string; className?: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} className={className}>
      <SlideIn k={id}>{children}</SlideIn>
    </div>
  );
}

/**
 * The tab a screen opens on: `?tab=` when it names one of `valid`, otherwise `fallback`, so a mistyped or
 * stale link shows the first tab and not a blank panel. A link that changes `?tab=` while the screen is
 * open moves the tab too.
 */
export function useTabParam<T extends string>(valid: readonly T[], fallback: T): [T, (tab: T) => void] {
  const wanted = useSearchParams().get("tab");
  const named = (v: string | null): T | null => (v && (valid as readonly string[]).includes(v) ? (v as T) : null);
  const [tab, setTab] = useState<T>(named(wanted) ?? fallback);
  const [seen, setSeen] = useState(wanted);
  if (seen !== wanted) {
    setSeen(wanted);
    const next = named(wanted);
    if (next) setTab(next);
  }
  return [tab, setTab];
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-control px-5 py-6 text-sm text-muted">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "warn", children, role }: { tone?: "warn" | "info" | "error"; children: ReactNode; role?: "alert" | "status" }) {
  const cls =
    tone === "warn"
      ? "bg-warn-bg border-warn-line text-warn-ink"
      : tone === "error"
        ? "bg-neg-bg border-neg-line text-neg-ink"
        : "bg-raised border-line text-muted";
  return (
    <div role={role} className={`min-w-0 break-words rounded-[16px] border px-4 py-3 text-[13px] leading-5 ${cls}`}>
      {children}
    </div>
  );
}

export function Kv({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted">{k}</span>
      <span className="text-right text-ink">{v}</span>
    </div>
  );
}

export function Code({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code title={title} className="font-mono text-[12.5px] text-ink">
      {children}
    </code>
  );
}

export function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <AssayLoader size={18} />
      {label}
    </span>
  );
}
