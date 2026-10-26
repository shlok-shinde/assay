"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { FilePlus2 } from "lucide-react";
import { db } from "@/store/db";
import { CHANNELS } from "@/seed/velvra";
import { SAMPLES } from "@/seed/samples";
import { useRole } from "@/store/hooks";
import { TitleRow } from "./AppShell";
import { ago, Empty, StatusPill } from "./ui";

export function DraftsView() {
  const role = useRole();
  const rows = useLiveQuery(async () => {
    const subs = (await db.submissions.filter((s) => !s.seeded).toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return Promise.all(
      subs.map(async (s) => {
        const versions = await db.versions.where("submissionId").equals(s.id).sortBy("n");
        const current = versions[versions.length - 1];
        const findings = current ? await db.findings.where("versionId").equals(current.id).toArray() : [];
        const open = findings.filter((f) => f.status === "open" || f.status === "reopened");
        return { s, n: current?.n ?? 1, total: findings.length, open: open.length, high: open.filter((f) => f.severity === "high").length };
      }),
    );
  }, []);
  const seeded = useLiveQuery(() => db.submissions.filter((s) => !!s.seeded).count(), []);

  const needsFixes = rows?.filter((r) => r.s.status === "checked" || r.s.status === "changes_requested").length ?? 0;
  const inReview = rows?.filter((r) => r.s.status === "in_review").length ?? 0;

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        title="Drafts"
        sub={
          rows && rows.length
            ? `${rows.length} draft${rows.length === 1 ? "" : "s"} in this browser · ${needsFixes} need${needsFixes === 1 ? "s" : ""} fixes · ${inReview} in review`
            : "No drafts yet. Start with a sample: it takes about a minute to go from draft to Hallmark."
        }
        actions={
          <Link href="/app/new" className="btn btn-primary">
            <FilePlus2 size={15} /> New draft
          </Link>
        }
      />
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="list-h" className="min-w-0">
          <h2 id="list-h" className="sr-only">
            Your drafts
          </h2>
          {rows === undefined ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="space-y-3">
              <Empty title="Nothing here yet">Pick a sample below, or paste your own copy on the New draft screen.</Empty>
              <ul className="grid gap-3 md:grid-cols-3">
                {SAMPLES.slice(0, 3).map((s) => (
                  <li key={s.id}>
                    <Link href={`/app/new?sample=${s.id}`} className="block h-full rounded-[14px] border border-line p-4 hover:bg-raised">
                      <span className="text-[14px] font-medium">{s.title}</span>
                      <span className="mt-1 block text-[13px] leading-5 text-muted">{s.shows}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="pb-2 font-normal">Draft</th>
                    <th className="pb-2 font-normal">Status</th>
                    <th className="pb-2 text-right font-normal">Open</th>
                    <th className="pb-2 text-right font-normal">High</th>
                    <th className="pb-2 text-right font-normal">Version</th>
                    <th className="pb-2 text-right font-normal">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ s, n, open, high }) => (
                    <tr key={s.id} className="border-t border-rule">
                      <td className="py-3 pr-3">
                        <Link href={`/app/s/${s.id}`} className="font-medium hover:underline">
                          {s.title}
                        </Link>
                        <p className="text-[13px] text-muted">
                          {CHANNELS.find((c) => c.id === s.channel)?.label} · {s.campaign || "No campaign"} · {s.creator}
                        </p>
                      </td>
                      <td className="py-3 pr-3">
                        <StatusPill status={s.status} />
                      </td>
                      <td className="num py-3 text-right">{open}</td>
                      <td className={`num py-3 text-right ${high ? "font-semibold text-neg-ink" : ""}`}>{high}</td>
                      <td className="num py-3 text-right">v{n}</td>
                      <td className="num py-3 text-right text-muted">{ago(s.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside aria-labelledby="you-h" className="space-y-4">
          <section className="rounded-[16px] bg-raised p-5">
            <h2 id="you-h" className="text-[14px] font-semibold">
              What each role does here
            </h2>
            <dl className="mt-3 space-y-2.5 text-[13px] leading-5">
              {[
                ["Creator", "Checks drafts, accepts or edits fixes, dismisses with a reason, submits for review."],
                ["Compliance", "Decides every claim routed from a draft: approve the claim or send it back."],
                ["Reviewer", "Sees dismissals and their reasons, the diff and comments; approves or requests changes."],
                ["Brand Admin", "Edits rules and facts, imports a brand book, publishes rulebook versions."],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className={`font-medium ${k.toLowerCase().startsWith(role === "admin" ? "brand" : role) ? "text-ink" : ""}`}>{k}</dt>
                  <dd className="text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-[16px] border border-line p-5">
            <h2 className="text-[14px] font-semibold">Seeded demo history</h2>
            <p className="mt-1 text-[13px] leading-5 text-muted">
              <span className="num text-ink">{seeded ?? 0}</span> past reviews, generated from a fixed seed and labelled as demo data, feed Guideline Health. They are not shown here as your drafts.
            </p>
            <Link href="/app/health" className="mt-2 inline-block text-[13px] font-medium underline">
              Open Guideline Health
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
