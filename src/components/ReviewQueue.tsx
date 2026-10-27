"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { useRole } from "@/store/hooks";
import { setRole } from "@/store/actions";
import { TitleRow } from "./AppShell";
import { ago, Code, Empty, ROLE_LABEL, SeverityPill, Spinner, StatusPill } from "./ui";

export function ReviewQueue() {
  const role = useRole();
  const data = useLiveQuery(async () => {
    const inReview = (await db.submissions.filter((s) => !s.seeded && s.status === "in_review").toArray()).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const claims = await db.findings.where("status").equals("sent_to_compliance").toArray();
    const subs = new Map((await db.submissions.bulkGet([...new Set(claims.map((c) => c.submissionId))])).filter(Boolean).map((s) => [s!.id, s!]));
    const decided = await Promise.all(
      inReview.map(async (s) => {
        const fs = await db.findings.where("submissionId").equals(s.id).toArray();
        return { s, dismissed: fs.filter((f) => f.status === "dismissed" || f.status === "contested").length, pending: fs.filter((f) => f.status === "sent_to_compliance").length };
      }),
    );
    return { decided, claims, subs };
  }, []);

  const mine = role === "compliance" ? "compliance" : "reviewer";

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        title="Review queue"
        sub={
          data
            ? `${data.claims.length} claim${data.claims.length === 1 ? "" : "s"} wait for Compliance · ${data.decided.length} draft${data.decided.length === 1 ? "" : "s"} in review. Claims are decided first, then the reviewer approves.`
            : <Spinner label="Gathering what waits for review…" />
        }
        actions={
          role !== mine || (role !== "reviewer" && role !== "compliance") ? (
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={() => setRole("compliance")}>
                View as Compliance
              </button>
              <button className="btn btn-secondary" onClick={() => setRole("reviewer")}>
                View as Reviewer
              </button>
            </div>
          ) : null
        }
      />
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="claims-h" className={`card p-5 ${role === "compliance" ? "ring-1 ring-gold border-gold" : ""}`}>
          <h2 id="claims-h" className="text-[16px] font-semibold">
            Claims for Compliance
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">Every claim finding routes here when a draft is submitted. Decide it on the draft.</p>
          <ul className="mt-3">
            {data?.claims.length === 0 && <li><Empty title="No claims are waiting." /></li>}
            {data?.claims.map((f) => {
              const s = data.subs.get(f.submissionId);
              return (
                <li key={f.id} className="border-t border-rule py-3 first:border-t-0">
                  <div className="flex items-center gap-2">
                    <Code>{f.ruleId}</Code>
                    {f.factId && <Code>{f.factId}</Code>}
                    <SeverityPill severity={f.severity} />
                    <span className="ml-auto text-[12px] text-muted">{s ? ago(s.updatedAt) : ""}</span>
                  </div>
                  <p className="mt-1 text-[14px]">“{f.quote}”</p>
                  <Link href={`/app/s/${f.submissionId}`} className="text-[13px] font-medium underline">
                    {s?.title ?? "Open draft"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby="rev-h" className={`card p-5 ${role === "reviewer" ? "ring-1 ring-gold border-gold" : ""}`}>
          <h2 id="rev-h" className="text-[16px] font-semibold">
            Drafts for the reviewer
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">Oldest first. Dismissed and contested findings come with the creator&apos;s reason.</p>
          <ul className="mt-3">
            {data?.decided.length === 0 && <li><Empty title="No drafts are in review." /></li>}
            {data?.decided.map(({ s, dismissed, pending }) => (
              <li key={s.id} className="flex items-start justify-between gap-3 border-t border-rule py-3 first:border-t-0">
                <div className="min-w-0">
                  <Link href={`/app/s/${s.id}`} className="text-[14px] font-medium hover:underline">
                    {s.title}
                  </Link>
                  <p className="text-[13px] text-muted">
                    {s.creator} · {dismissed} dismissed or contested · {pending ? `${pending} claim${pending === 1 ? "" : "s"} with Compliance` : "claims cleared"}
                  </p>
                </div>
                <StatusPill status={s.status} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="mt-4 text-[13px] text-muted">You are viewing as {ROLE_LABEL[role]}. The role switcher at the top stands in for sign-in in this demo.</p>
    </div>
  );
}
