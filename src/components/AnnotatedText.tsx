"use client";

import { Fragment } from "react";
import type { Finding, PageSpan } from "@/lib/types";

const RESOLVED = new Set(["accepted", "edited", "dismissed", "compliance_approved"]);

/** The draft with every text finding highlighted and numbered. Colour is never the only signal: severity also sets the underline style. */
export function AnnotatedText({
  text,
  findings,
  numbers,
  pages,
  selected,
  onSelect,
}: {
  text: string;
  findings: Finding[];
  numbers: Map<string, number>;
  pages?: PageSpan[];
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const textFindings = findings.filter((f) => f.start >= 0 && f.end > f.start).sort((a, b) => a.start - b.start);

  const renderRange = (from: number, to: number) => {
    const out: React.ReactNode[] = [];
    let cursor = from;
    for (const f of textFindings) {
      if (f.start < cursor || f.start >= to) continue;
      const end = Math.min(f.end, to);
      if (f.start > cursor) out.push(<Fragment key={`t${cursor}`}>{text.slice(cursor, f.start)}</Fragment>);
      const n = numbers.get(f.id);
      out.push(
        <mark
          key={f.id}
          id={`hl-${f.id}`}
          role="button"
          tabIndex={0}
          data-selected={selected === f.id}
          onClick={() => onSelect?.(f.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect?.(f.id);
            }
          }}
          className={`hl hl-${f.severity} ${RESOLVED.has(f.status) ? "hl-done" : ""} text-ink`}
        >
          {text.slice(f.start, end)}
          <span className="marker" aria-hidden="true">
            {n}
          </span>
          <span className="sr-only">
            {" "}
            (finding {n}, {f.severity} severity: {f.title})
          </span>
        </mark>,
      );
      cursor = end;
    }
    if (cursor < to) out.push(<Fragment key={`t${cursor}`}>{text.slice(cursor, to)}</Fragment>);
    return out;
  };

  if (pages?.length) {
    return (
      <div className="space-y-5">
        {pages.map((p) => (
          <div key={p.page}>
            <p className="mb-2 text-[12px] font-medium text-muted">Page {p.page}</p>
            <div className="whitespace-pre-wrap text-[15px] leading-[28px]">{renderRange(p.start, p.end)}</div>
          </div>
        ))}
      </div>
    );
  }
  return <div className="whitespace-pre-wrap text-[15px] leading-[28px]">{renderRange(0, text.length)}</div>;
}
