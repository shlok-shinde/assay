"use client";

import { useMemo, useState } from "react";
import { Check, MessageSquare } from "lucide-react";
import type { Comment, Fact, Finding, IntentCard, Role, Rule, SubmissionStatus } from "@/lib/types";
import { applyFixes, intentCheck } from "@/engine/fix";
import { formatDate, isExpired } from "@/engine/claims";
import { addComment, complianceDecision, reopenFinding, resolveFinding } from "@/store/actions";
import { todayIso } from "@/store/db";
import { CATEGORY_LABEL, Code, FINDING_STATUS_LABEL, fmtTime, SeverityPill } from "./ui";

type Mode = null | "edit" | "dismiss" | "contest" | "comment" | "reopen" | "reject";

export function FindingCard({
  finding: f,
  n,
  rule,
  fact,
  relatedRules,
  text,
  intent,
  role,
  status,
  selected,
  onSelect,
  comments,
}: {
  finding: Finding;
  n: number;
  rule?: Rule;
  fact?: Fact;
  relatedRules: Rule[];
  text: string;
  intent: IntentCard;
  role: Role;
  status: SubmissionStatus;
  selected: boolean;
  onSelect: () => void;
  comments: Comment[];
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    if (!f.fix || f.fix.kind === "manual" || f.start < 0) return null;
    const after = applyFixes(text, [{ id: f.id, start: f.start, end: f.end, fix: f.fix }]).text;
    return intentCheck(text, after, intent);
  }, [f, text, intent]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode(null);
      setInput("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editable = status === "draft" || status === "checked" || status === "changes_requested";
  const open = f.status === "open" || f.status === "reopened";
  const creatorCanAct = role === "creator" && editable && open;
  const highLocked = f.severity === "high" && role === "creator";
  const origin =
    f.origin === "ai"
      ? `AI judgment · ${f.model ?? "model"} · ${f.confidence?.toFixed(2)}`
      : f.factId
        ? "Rule check + Claim Ledger"
        : f.region
          ? "Rule check on the image"
          : "Rule check";
  const rangeStart = f.fix?.range?.start ?? f.start;
  const rangeEnd = f.fix?.range?.end ?? f.end;
  const before = f.start >= 0 ? text.slice(rangeStart, rangeEnd) : "";

  return (
    <article
      id={`card-${f.id}`}
      aria-label={`Finding ${n}`}
      onClick={onSelect}
      className={`rounded-[16px] border bg-sheet p-4 transition-colors ${selected ? "border-gold ring-1 ring-gold" : "border-line"} ${
        open ? "" : "bg-raised"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="marker !ml-0">{n}</span>
        <span className="text-[13px] font-medium">{CATEGORY_LABEL[f.category]}</span>
        <SeverityPill severity={f.severity} />
        {f.suggestion && <span className="pill bg-neutral-bg text-neutral-ink">Suggestion</span>}
        <span className="ml-auto text-[12px] text-muted">{origin}</span>
      </header>
      <h3 className="mt-2 text-[15px] font-semibold leading-[22px]">{f.title}</h3>
      {f.cached && <p className="mt-0.5 text-[12px] text-muted">Cached AI result, {f.cached.model}, {fmtTime(f.cached.at)}</p>}

      <blockquote className="mt-2 rounded-[10px] bg-raised px-3 py-2 text-[14px] leading-[22px]">
        {f.quote}
        {f.page && <span className="ml-2 text-[12px] text-muted">page {f.page}</span>}
      </blockquote>
      <p className="mt-2 text-[14px] leading-[22px]">{f.reason}</p>

      <div className="mt-3 space-y-1 text-[13px] leading-5">
        {rule && (
          <p>
            <Code>{rule.id}</Code> <span className="text-muted">·</span> {rule.title} <span className="text-muted">· {rule.source.doc} p.{rule.source.page} {rule.source.section}</span>
          </p>
        )}
        {fact && (
          <p>
            <Code>{fact.id}</Code> <span className="text-muted">·</span> {fact.statement}{" "}
            <span className={isExpired(fact, todayIso()) ? "text-neg-ink" : "text-muted"}>
              · owner {fact.owner}
              {fact.validTo ? ` · ${isExpired(fact, todayIso()) ? "expired" : "valid to"} ${formatDate(fact.validTo)}` : ""}
            </span>
          </p>
        )}
        {relatedRules.length > 0 && (
          <p className="text-muted">
            Also breaks{" "}
            {relatedRules.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ", "}
                <Code>{r.id}</Code> {r.title}
              </span>
            ))}
          </p>
        )}
      </div>

      {f.fix && (
        <div className="mt-3 rounded-[12px] border border-line p-3">
          <p className="text-[12px] font-medium text-muted">{f.fix.kind === "manual" ? "What to change" : f.fix.kind === "append" ? "Suggested addition" : "Suggested minimal edit"}</p>
          {f.fix.kind === "replace" && f.start >= 0 ? (
            <p className="mt-1 text-[14px] leading-[22px]">
              {before && <del className="diff-del">{before}</del>} <ins className="diff-ins">{(f.resolution?.editedText ?? f.fix.replacement) || "(remove)"}</ins>
            </p>
          ) : (
            <p className="mt-1 text-[14px] leading-[22px]">{f.fix.kind === "append" ? <ins className="diff-ins">{f.fix.replacement}</ins> : f.fix.replacement}</p>
          )}
          {f.fix.footnote && <p className="mt-1 text-[13px] text-muted">Adds footnote: {f.fix.footnote}</p>}
          {preview && (
            <p className={`mt-2 flex items-center gap-1.5 text-[13px] ${preview.kept ? "text-positive" : "text-warn-ink"}`}>
              {preview.kept ? <Check size={14} /> : <span aria-hidden="true">!</span>}
              {preview.summary}
            </p>
          )}
        </div>
      )}

      {!open && f.status !== "superseded" && (
        <p className="mt-3 text-[13px] leading-5">
          <span className="font-medium">{FINDING_STATUS_LABEL[f.status]}</span>
          {f.resolution && (
            <span className="text-muted">
              {" "}
              by {f.resolution.by}
              {f.resolution.reason ? `: “${f.resolution.reason}”` : ""} · {fmtTime(f.resolution.at)}
            </span>
          )}
        </p>
      )}
      {f.status === "reopened" && f.resolution?.reason && <p className="mt-2 text-[13px] text-warn-ink">Reopened by {f.resolution.by}: “{f.resolution.reason}”</p>}

      <div className="mt-3 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
        {creatorCanAct && f.fix && f.fix.kind !== "manual" && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(() => resolveFinding(f.id, "accepted", role))}>
            Accept
          </button>
        )}
        {creatorCanAct && f.fix && f.fix.kind === "replace" && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setMode("edit");
              setInput(f.fix!.replacement);
            }}
          >
            Edit
          </button>
        )}
        {creatorCanAct && (
          <button
            className="btn btn-secondary btn-sm"
            disabled={highLocked}
            title={highLocked ? "High-severity findings need a reviewer or Compliance to dismiss them" : undefined}
            onClick={() => setMode("dismiss")}
          >
            Dismiss with reason
          </button>
        )}
        {creatorCanAct && (
          <button className="btn btn-ghost btn-sm" onClick={() => setMode("contest")}>
            Contest rule
          </button>
        )}
        {creatorCanAct && (f.category === "claim" || f.category === "legal" || f.severity === "high") && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => resolveFinding(f.id, "sent_to_compliance", role))}>
            Send to Compliance
          </button>
        )}
        {role === "creator" && editable && (f.status === "accepted" || f.status === "edited" || f.status === "dismissed" || f.status === "contested" || f.status === "sent_to_compliance") && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => resolveFinding(f.id, "open", role))}>
            Undo
          </button>
        )}
        {role === "compliance" && f.status === "sent_to_compliance" && (
          <>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(() => complianceDecision(f.id, true, "Claim and wording approved"))}>
              Approve claim
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setMode("reject")}>
              Send back
            </button>
          </>
        )}
        {(role === "reviewer" || role === "compliance") && open && f.severity === "high" && f.status !== "reopened" && status !== "approved" && (
          <button className="btn btn-secondary btn-sm" onClick={() => setMode("dismiss")}>
            Dismiss with reason
          </button>
        )}
        {role === "reviewer" && (f.status === "dismissed" || f.status === "contested") && status === "in_review" && (
          <button className="btn btn-secondary btn-sm" onClick={() => setMode("reopen")}>
            Reopen
          </button>
        )}
        <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setMode(mode === "comment" ? null : "comment")}>
          <MessageSquare size={14} /> {comments.length ? comments.length : "Comment"}
        </button>
      </div>

      {comments.length > 0 && (
        <ul className="mt-2 space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-[10px] bg-raised px-3 py-2 text-[13px] leading-5">
              <span className="font-medium">{c.author}</span> <span className="text-muted">· {fmtTime(c.at)}</span>
              <p>{c.text}</p>
            </li>
          ))}
        </ul>
      )}

      {mode && (
        <form
          className="mt-3 space-y-2"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            const v = input.trim();
            if (!v) return;
            if (mode === "edit") void act(() => resolveFinding(f.id, "edited", role, { editedText: input }));
            if (mode === "dismiss") void act(() => resolveFinding(f.id, "dismissed", role, { reason: v }));
            if (mode === "contest") void act(() => resolveFinding(f.id, "contested", role, { reason: v }));
            if (mode === "comment") void act(() => addComment(f.submissionId, role, v, f.id));
            if (mode === "reopen") void act(() => reopenFinding(f.id, role, v));
            if (mode === "reject") void act(() => complianceDecision(f.id, false, v));
          }}
        >
          <label htmlFor={`in-${f.id}`} className="text-[13px] font-medium">
            {
              {
                edit: "Your edit (replaces the quoted text)",
                dismiss: "Why dismiss it? Reviewers see this reason",
                contest: "What is wrong with the rule? Brand Admin sees this in Guideline Health",
                comment: "Comment on this finding",
                reopen: "Why reopen it?",
                reject: "What has to change in the claim?",
              }[mode]
            }
          </label>
          <textarea id={`in-${f.id}`} className="field" rows={2} value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={busy || !input.trim()} type="submit">
              {mode === "edit" ? "Save edit" : mode === "comment" ? "Post" : "Confirm"}
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-2 text-[13px] text-neg-ink">{error}</p>}
    </article>
  );
}
