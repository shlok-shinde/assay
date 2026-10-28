"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useDealIn } from "./motion";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/store/db";
import { verifyHallmarkById } from "@/store/actions";
import { TitleRow } from "./AppShell";
import { Code, Empty, fmtTime, Mark } from "./ui";

export function HallmarksView() {
  const hallmarks = useLiveQuery(() => db.hallmarks.orderBy("seq").reverse().toArray(), []);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const chain = useRef<HTMLOListElement>(null);
  useDealIn(chain, ":scope > li", [hallmarks?.length]);

  const verifyAll = async () => {
    setBusy(true);
    const out: Record<string, boolean> = {};
    for (const h of hallmarks ?? []) out[h.id] = (await verifyHallmarkById(h.id)).ok;
    setResults(out);
    setBusy(false);
  };
  const checked = Object.keys(results).length;
  const broken = Object.values(results).filter((v) => !v).length;

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        title="Hallmarks"
        sub={
          hallmarks?.length
            ? checked
              ? broken
                ? `${broken} of ${checked} Hallmarks do not verify.`
                : `All ${checked} Hallmarks verify: content, records and the chain match their SHA-256 hashes.`
              : `${hallmarks.length} approved version${hallmarks.length === 1 ? "" : "s"}, each hash-chained to the one before.`
            : "Each approval writes a Hallmark: the content's SHA-256, the rulebook version, every finding's outcome, the approvers and the AI used."
        }
        actions={
          hallmarks?.length ? (
            <button className="btn btn-primary" disabled={busy} onClick={verifyAll}>
              {busy ? "Verifying…" : "Verify the chain"}
            </button>
          ) : null
        }
      />
      <div className="mt-6">
        {hallmarks?.length === 0 && (
          <Empty title="No Hallmarks yet.">
            Approve a draft as the Reviewer to write the first one. <Link href="/app" className="underline">Go to drafts</Link>
          </Empty>
        )}
        <ol ref={chain} className="space-y-3">
          {hallmarks?.map((h) => (
            <li key={h.id} className="flex flex-wrap items-start gap-4 rounded-[16px] border border-line p-4">
              <Mark size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">
                  #{h.seq} ·{" "}
                  <Link href={`/app/s/${h.submissionId}`} className="hover:underline">
                    {h.title}
                  </Link>
                </p>
                <p className="text-[13px] text-muted">
                  v{h.versionN} · rulebook v{h.rulebookVersion} · {h.findings.length} findings recorded · {[...new Set(h.approvals.map((a) => a.by))].join(", ")} · {fmtTime(h.issuedAt)}
                </p>
                <p className="mt-1 text-[12.5px] text-muted">
                  hash <Code title={h.hash}>{h.hash.slice(0, 20)}…</Code> · previous <Code title={h.prevHash}>{h.prevHash.slice(0, 20)}…</Code>
                </p>
              </div>
              {h.id in results && (
                <span className={`pill ${results[h.id] ? "bg-pos-bg text-pos-ink" : "bg-neg-bg text-neg-ink"}`}>{results[h.id] ? "Verified" : "Does not verify"}</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
