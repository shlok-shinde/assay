"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { useDealIn } from "./motion";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { useRole } from "@/store/hooks";
import { setRole } from "@/store/actions";
import { CHANNELS } from "@/seed/velvra";
import type { Finding, Role } from "@/lib/types";
import { TitleRow } from "./AppShell";
import { loadDraftRows, type DraftRow } from "./draft-state";
import { MarkStrip } from "./primitives";
import { Thumb } from "./Thumb";
import { ago, Code, ROLE_LABEL, SeverityPill, Spinner, StatusPill } from "./ui";

type Lane = "compliance" | "reviewer";

/**
 * Two lanes of slips: the claims Compliance must decide, and the drafts the reviewer must answer. The lane
 * that belongs to the role on screen comes first, on a raised ground, and says it is yours; the other lane
 * follows, flat, so what waits on someone else is still in view.
 */
export function ReviewQueue() {
  const role = useRole();
  const queue = useRef<HTMLDivElement>(null);
  const data = useLiveQuery(async () => {
    const rows = await loadDraftRows();
    const inReview = rows.filter((r) => r.s.status === "in_review").sort((a, b) => a.s.updatedAt.localeCompare(b.s.updatedAt));
    const claims = (await db.findings.where("status").equals("sent_to_compliance").toArray()).sort((a, b) => a.checkId.localeCompare(b.checkId));
    const subs = new Map((await db.submissions.bulkGet([...new Set(claims.map((c) => c.submissionId))])).filter(Boolean).map((s) => [s!.id, s!]));
    return { inReview, claims, subs };
  }, []);

  const mine: Lane | null = role === "compliance" ? "compliance" : role === "reviewer" ? "reviewer" : null;
  const order: Lane[] = mine === "reviewer" ? ["reviewer", "compliance"] : ["compliance", "reviewer"];

  useDealIn(queue, "li[data-slip]", [!!data, role], "rise", 45);

  const lanes: Record<Lane, ReactNode> = {
    compliance: (
      <LaneBox key="compliance" id="claims-h" title="Claims for Compliance" note="Every claim finding routes here when a draft is submitted. Decide it on the draft." count={data?.claims.length} yours={mine === "compliance"} empty="No claims are waiting.">
        {data?.claims.map((f) => (
          <ClaimSlip key={f.id} f={f} title={data.subs.get(f.submissionId)?.title} updated={data.subs.get(f.submissionId)?.updatedAt} />
        ))}
      </LaneBox>
    ),
    reviewer: (
      <LaneBox key="reviewer" id="rev-h" title="Drafts for the reviewer" note="Oldest first. Dismissed and contested findings come with the creator's reason." count={data?.inReview.length} yours={mine === "reviewer"} empty="No drafts are in review.">
        {data?.inReview.map((r) => (
          <DraftSlip key={r.s.id} r={r} />
        ))}
      </LaneBox>
    ),
  };

  return (
    <div className="px-4 py-5 md:px-8 md:py-8">
      <TitleRow
        title="Review queue"
        sub={
          data ? (
            `${data.claims.length} claim${data.claims.length === 1 ? "" : "s"} wait for Compliance · ${data.inReview.length} draft${data.inReview.length === 1 ? "" : "s"} in review. Claims are decided first, then the reviewer approves.`
          ) : (
            <Spinner label="Gathering what waits for review…" />
          )
        }
        actions={
          mine === null ? (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-secondary btn-lg" onClick={() => setRole("compliance")}>
                View as Compliance
              </button>
              <button className="btn btn-secondary btn-lg" onClick={() => setRole("reviewer")}>
                View as Reviewer
              </button>
            </div>
          ) : null
        }
      />
      <div ref={queue} className="mt-8 grid items-start gap-8 xl:grid-cols-2">
        {order.map((l) => lanes[l])}
      </div>
      <p className="mt-8 text-[13px] text-muted">You are viewing as {ROLE_LABEL[role as Role]}. The role switcher at the top stands in for sign-in in this demo.</p>
    </div>
  );
}

function LaneBox({ id, title, note, count, yours, empty, children }: { id: string; title: string; note: string; count?: number; yours: boolean; empty: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={yours ? "rounded-[32px] bg-raised p-5 md:p-6" : "p-1 md:p-2"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-[17px] font-semibold tracking-[-0.01em]">
          {title} {count !== undefined && <span className="num font-normal text-muted">{count}</span>}
        </h2>
        {yours && <span className="pill bg-active text-ink">Your queue</span>}
      </div>
      <p className="mt-1 text-[13px] leading-5 text-muted">{note}</p>
      <ul className="mt-4 space-y-3">
        {count === 0 && <li className={`rounded-[22px] px-5 py-4 text-[14px] text-muted ${yours ? "bg-field" : "bg-raised"}`}>{empty}</li>}
        {children}
      </ul>
    </section>
  );
}

function ClaimSlip({ f, title, updated }: { f: Finding; title?: string; updated?: string }) {
  return (
    <li data-slip className="slip" data-sev={f.severity}>
      <div className="flex flex-wrap items-center gap-2">
        <Code>{f.ruleId}</Code>
        {f.factId && <Code>{f.factId}</Code>}
        <SeverityPill severity={f.severity} />
        <span className="ml-auto text-[12.5px] text-muted">{updated ? ago(updated) : ""}</span>
      </div>
      <p className="slip-title">{f.title}</p>
      <p className="slip-quote">{f.quote}</p>
      <p className="mt-3">
        <Link href={`/app/s/${f.submissionId}`} className="text-[13.5px] font-medium underline">
          {title ?? "Open draft"}
        </Link>
      </p>
    </li>
  );
}

function DraftSlip({ r }: { r: DraftRow }) {
  const { s } = r;
  const label = CHANNELS.find((c) => c.id === s.channel)?.label ?? s.channel;
  return (
    <li data-slip className="slip" data-sev={r.withCompliance ? "medium" : "low"}>
      <div className="flex items-start gap-3.5">
        <Thumb image={r.image} fallback={label.slice(0, 2).toUpperCase()} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link href={`/app/s/${s.id}`} className="text-[15px] font-semibold hover:underline">
              {s.title}
            </Link>
            <StatusPill status={s.status} />
          </div>
          <p className="mt-0.5 text-[13px] leading-5 text-muted">
            {s.creator} · {r.pushedBack} dismissed or contested · {r.withCompliance ? `${r.withCompliance} claim${r.withCompliance === 1 ? "" : "s"} with Compliance` : "claims cleared"}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <MarkStrip {...r.marks} />
      </div>
    </li>
  );
}
