"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, X } from "lucide-react";
import type { Hallmark } from "@/lib/types";
import type { HallmarkVerification } from "@/engine/hallmark";
import { db } from "@/store/db";
import { verifyHallmarkById } from "@/store/actions";
import { TitleRow } from "./AppShell";
import { motionAllowed, useDealIn } from "./motion";
import { Term, useAction } from "./primitives";
import { ScrambleHash } from "./ScrambleHash";
import { Empty, fmtTime, Mark } from "./ui";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const shortHash = (h: string) => `${h.slice(0, 20)}…`;

interface Progress {
  /** The Hallmark being checked right now, oldest first. */
  active: string | null;
  results: Record<string, HallmarkVerification>;
  /** Goes up each time a link starts, so its hash scrambles again. */
  tick: Record<string, number>;
  /** One line per link already checked, in the order they were checked. */
  lines: { id: string; seq: number; ok: boolean; text: string }[];
}

const NONE: Progress = { active: null, results: {}, tick: {}, lines: [] };

const sayLink = (h: Hallmark, v: HallmarkVerification) =>
  v.ok
    ? `#${h.seq} ${h.title}: content, record and ${h.seq === 1 ? "start of the chain" : `link to #${h.seq - 1}`} all match their hashes.`
    : `#${h.seq} ${h.title} does not verify: ${[!v.contentMatches && "the content changed", !v.bodyMatches && "the record was edited", !v.chainMatches && "the chain is broken"].filter(Boolean).join(", ")}.`;

/**
 * The Hallmarks are a chain: each record holds the hash of the one before it, so changing any old record
 * breaks every link after it. The screen draws them as linked records, newest on top, and Verify walks the
 * chain from the first record to the last, link by link, saying what each one found.
 */
export function HallmarksView() {
  const hallmarks = useLiveQuery(() => db.hallmarks.orderBy("seq").reverse().toArray(), []);
  const [progress, setProgress] = useState<Progress>(NONE);
  const chain = useRef<HTMLOListElement>(null);
  useDealIn(chain, ":scope > li", [hallmarks?.length]);

  const verifyAll = useAction(
    async () => {
      const oldestFirst = [...(hallmarks ?? [])].reverse();
      const results: Record<string, HallmarkVerification> = {};
      const lines: Progress["lines"] = [];
      const tick: Record<string, number> = {};
      setProgress(NONE);
      for (const h of oldestFirst) {
        tick[h.id] = 1;
        setProgress({ active: h.id, results: { ...results }, tick: { ...tick }, lines: [...lines] });
        const v = await verifyHallmarkById(h.id);
        // A beat on each link, so the walk can be followed; none at all when motion is off.
        if (motionAllowed()) await wait(650);
        results[h.id] = v;
        lines.push({ id: h.id, seq: h.seq, ok: v.ok, text: sayLink(h, v) });
        setProgress({ active: h.id, results: { ...results }, tick: { ...tick }, lines: [...lines] });
      }
      setProgress({ active: null, results, tick, lines });
    },
    { errorPrefix: "Could not verify the chain" },
  );
  const checked = Object.keys(progress.results).length;
  const broken = Object.values(progress.results).filter((v) => !v.ok).length;
  const finished = !verifyAll.busy && checked > 0 && checked === (hallmarks?.length ?? -1);

  return (
    <div className="px-4 py-5 md:px-8 md:py-8">
      <TitleRow
        title="Hallmarks"
        sub={
          hallmarks?.length
            ? finished
              ? broken
                ? `${broken} of ${checked} Hallmark${checked === 1 ? "" : "s"} do${broken === 1 ? "es" : ""} not verify.`
                : `${checked === 1 ? "The Hallmark verifies" : `All ${checked} Hallmarks verify`}: content, ${checked === 1 ? "record" : "records"} and the chain match their SHA-256 hashes.`
              : verifyAll.busy
                ? `Checking the chain from the first record: ${checked} of ${hallmarks.length} links so far.`
                : `${hallmarks.length} approved version${hallmarks.length === 1 ? "" : "s"}, each hash-chained to the one before.`
            : (
                <>
                  Each approval writes a <Term id="hallmark">Hallmark</Term>: the content&apos;s SHA-256, the rulebook version, every finding&apos;s outcome, the approvers and the AI used.
                </>
              )
        }
        actions={
          hallmarks?.length ? (
            <button className="btn btn-primary btn-lg" disabled={verifyAll.busy} onClick={() => verifyAll.run()}>
              {verifyAll.busy ? "Verifying…" : "Verify the chain"}
            </button>
          ) : null
        }
      />
      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {hallmarks?.length === 0 && (
            <Empty title="No Hallmarks yet.">
              Approve a draft as the Reviewer to write the first one. <Link href="/app" className="underline">Go to drafts</Link>
            </Empty>
          )}
          <ol ref={chain} aria-label="Hallmark chain, newest first">
            {hallmarks?.map((h, i) => {
              const v = progress.results[h.id];
              const older = hallmarks[i + 1];
              const live = progress.active === h.id;
              // Whether this record's stored link to the one before it is the hash that record really has.
              const linkHolds = older ? h.prevHash === older.hash : true;
              return (
                <li key={h.id} className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-3 md:gap-x-4">
                  <div className="flex flex-col items-center">
                    <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-full transition-colors duration-500 ${v ? (v.ok ? "bg-gold-soft" : "bg-neg-bg") : live ? "bg-active" : "bg-raised"}`}>
                      <Mark size={26} />
                    </span>
                    {older && (
                      <span
                        aria-hidden="true"
                        className={`my-1 w-[3px] flex-1 rounded-full transition-colors duration-500 ${v && !v.chainMatches ? "bg-negative" : v ? "bg-gold-mark" : "bg-control"}`}
                      />
                    )}
                  </div>
                  <div className={`min-w-0 ${older ? "pb-4" : ""}`}>
                    <div className={`rounded-[28px] p-5 transition-colors duration-500 md:p-6 ${live ? "bg-active" : "bg-raised"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[16px] font-semibold">
                            #{h.seq} ·{" "}
                            <Link href={`/app/s/${h.submissionId}`} className="hover:underline">
                              {h.title}
                            </Link>
                          </p>
                          <p className="mt-1 text-[13px] leading-5 text-muted">
                            v{h.versionN} · rulebook v{h.rulebookVersion} · {h.findings.length} findings recorded · {[...new Set(h.approvals.map((a) => a.by))].join(", ")} · {fmtTime(h.issuedAt)}
                          </p>
                        </div>
                        {v && <span className={`pill ${v.ok ? "bg-pos-bg text-pos-ink" : "bg-neg-bg text-neg-ink"}`}>{v.ok ? "Verified" : "Does not verify"}</span>}
                      </div>
                      <dl className="mt-4 grid gap-2 rounded-[20px] bg-field p-4 text-[13px] sm:grid-cols-[110px_minmax(0,1fr)]">
                        <dt className="text-muted">This record</dt>
                        <dd className="min-w-0 break-all">
                          <ScrambleHash text={shortHash(h.hash)} run={progress.tick[h.id] ?? 0} title={h.hash} />
                        </dd>
                        <dt className="text-muted">{h.seq === 1 ? "Starts the chain" : `Links back to #${h.seq - 1}`}</dt>
                        <dd className="min-w-0 break-all">
                          <span className="font-mono text-[12.5px]" title={h.prevHash}>
                            {shortHash(h.prevHash)}
                          </span>
                          {older && (
                            <span className={`ml-2 text-[12px] ${linkHolds ? "text-muted" : "text-neg-ink"}`}>{linkHolds ? "is the hash of #" + older.seq : "is not the hash of #" + older.seq}</span>
                          )}
                        </dd>
                      </dl>
                      {v && (
                        <ul className="mt-3 flex flex-wrap gap-2 text-[12.5px]" aria-label={`What was checked on #${h.seq}`}>
                          {(
                            [
                              ["Content", v.contentMatches],
                              ["Record", v.bodyMatches],
                              ["Chain", v.chainMatches],
                            ] as const
                          ).map(([what, ok]) => (
                            <li key={what} className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 ${ok ? "bg-pos-bg text-pos-ink" : "bg-neg-bg text-neg-ink"}`}>
                              {ok ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                              {what} {ok ? "matches" : "differs"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <aside aria-labelledby="walk-h" className="xl:sticky xl:top-3 xl:self-start">
          <section className="rounded-[28px] bg-raised p-6">
            <h2 id="walk-h" className="text-[16px] font-semibold">
              The walk
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-muted">Verify starts at the first Hallmark and checks each one against the one before it.</p>
            <div role="status" aria-live="polite" className="mt-4">
            <ol className="space-y-2.5">
              {progress.lines.length === 0 && !verifyAll.busy && <li className="text-[13.5px] text-faint">Nothing has been checked yet.</li>}
              {progress.lines.map((l) => (
                <li key={l.id} className="enter-rise flex gap-2.5 text-[13.5px] leading-5">
                  <span aria-hidden="true" className={`mt-[2px] flex h-5 w-5 flex-none items-center justify-center rounded-full ${l.ok ? "bg-pos-bg text-pos-ink" : "bg-neg-bg text-neg-ink"}`}>
                    {l.ok ? <Check size={12} /> : <X size={12} />}
                  </span>
                  <span>{l.text}</span>
                </li>
              ))}
              {verifyAll.busy && progress.active && <li className="text-[13.5px] text-muted">Checking the next link…</li>}
            </ol>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
