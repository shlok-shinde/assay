"use client";

import { useId, type ReactNode } from "react";
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

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-6 border-b border-line overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`relative -mb-px h-10 shrink-0 text-sm transition-colors ${
            value === t.id ? "text-ink font-medium border-b-2 border-gold" : "text-muted hover:text-ink border-b-2 border-transparent"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-control px-5 py-6 text-sm text-muted">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "info" | "error"; children: ReactNode }) {
  const cls =
    tone === "warn"
      ? "bg-warn-bg border-warn-line text-warn-ink"
      : tone === "error"
        ? "bg-neg-bg border-neg-line text-neg-ink"
        : "bg-raised border-line text-muted";
  return <div className={`rounded-[12px] border px-4 py-3 text-[13px] leading-5 ${cls}`}>{children}</div>;
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
