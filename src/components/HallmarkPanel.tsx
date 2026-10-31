"use client";

import { useEffect, useRef, useState } from "react";
import { strike } from "./motion";
import { Download } from "lucide-react";
import type { Hallmark } from "@/lib/types";
import { hallmarkMarkdown, type HallmarkVerification } from "@/engine/hallmark";
import { hallmarkContent, verifyHallmarkById } from "@/store/actions";
import { db } from "@/store/db";
import { Term, useAction } from "./primitives";
import { fmtTime, Mark } from "./ui";
import { ScrambleHash } from "./ScrambleHash";

export function HallmarkPanel({ hallmark: h }: { hallmark: Hallmark }) {
  const [result, setResult] = useState<HallmarkVerification | null>(null);
  const [pass, setPass] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  // Struck once, when the Hallmark has just been written; an old one opens still.
  useEffect(() => {
    if (Date.now() - Date.parse(h.issuedAt) < 15_000) strike(mark.current, panel.current);
  }, [h.issuedAt]);

  const verify = useAction(
    async () => {
      setPass((n) => n + 1);
      setResult(await verifyHallmarkById(h.id));
    },
    { errorPrefix: "Could not verify the Hallmark" },
  );
  const download = useAction(async () => {
    const v = await db.versions.get(h.versionId);
    if (!v) throw new Error("The approved version is no longer in this browser.");
    const md = hallmarkMarkdown(h, await hallmarkContent(v));
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `hallmark-${h.seq}-${h.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, { errorPrefix: "Could not write the record" });

  return (
    <section ref={panel} aria-labelledby={`hm-${h.id}`} className="rounded-[28px] bg-gold-wash p-6">
      <div className="flex items-start gap-3">
        <span ref={mark} className="inline-block flex-none">
          <Mark size={36} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`hm-${h.id}`} className="text-[16px] font-semibold">
            <Term id="hallmark">Hallmark</Term> #{h.seq}
          </h2>
          <p className="text-[13px] text-muted">
            Approved v{h.versionN} against rulebook v{h.rulebookVersion} · {fmtTime(h.issuedAt)}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid gap-2 rounded-[20px] bg-sheet p-4 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Content SHA-256</dt>
          <dd className="truncate">
            <ScrambleHash text={`${h.contentHash.slice(0, 16)}…`} run={pass} title={h.contentHash} />
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">This Hallmark</dt>
          <dd className="truncate">
            <ScrambleHash text={`${h.hash.slice(0, 16)}…`} run={pass} title={h.hash} />
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Previous Hallmark</dt>
          <dd className="truncate">
            <ScrambleHash text={`${h.prevHash.slice(0, 16)}…`} run={pass} title={h.prevHash} />
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Approvals</dt>
          <dd className="text-right">{[...new Set(h.approvals.map((a) => a.by))].join(", ") || "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">AI used</dt>
          <dd className="text-right">
            {h.ai.models.length ? `${h.ai.models.join(", ")} · ${h.ai.calls} call${h.ai.calls === 1 ? "" : "s"} · ${h.ai.redactions} redaction${h.ai.redactions === 1 ? "" : "s"}` : "None (rule checks only)"}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primary btn-sm"
          disabled={verify.busy}
          onClick={() => verify.run()}
        >
          Verify
        </button>
        <button className="btn btn-secondary btn-sm" disabled={download.busy} onClick={() => download.run()}>
          <Download size={14} /> Markdown record
        </button>
      </div>
      {result && (
        <div className="mt-4">
          <p role="status" className={`text-[13px] leading-5 ${result.ok ? "text-positive" : "text-neg-ink"}`}>
            {result.ok
              ? "Verified: the content, the record and the chain all match their hashes."
              : `Does not verify: ${[!result.contentMatches && "the content changed", !result.bodyMatches && "the record was edited", !result.chainMatches && "the chain is broken"].filter(Boolean).join(", ")}.`}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-[12.5px]" aria-label="What was checked">
            {(
              [
                ["Content", result.contentMatches],
                ["Record", result.bodyMatches],
                ["Chain", result.chainMatches],
              ] as const
            ).map(([what, ok]) => (
              <li key={what} className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 ${ok ? "bg-pos-bg text-pos-ink" : "bg-neg-bg text-neg-ink"}`}>
                {what} {ok ? "matches" : "differs"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
