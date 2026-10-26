"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { Hallmark } from "@/lib/types";
import { hallmarkMarkdown, type HallmarkVerification } from "@/engine/hallmark";
import { hallmarkContent, verifyHallmarkById } from "@/store/actions";
import { db } from "@/store/db";
import { Code, fmtTime, Mark } from "./ui";

export function HallmarkPanel({ hallmark: h }: { hallmark: Hallmark }) {
  const [result, setResult] = useState<HallmarkVerification | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    const v = await db.versions.get(h.versionId);
    if (!v) return;
    const md = hallmarkMarkdown(h, await hallmarkContent(v));
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `hallmark-${h.seq}-${h.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby={`hm-${h.id}`} className="rounded-[16px] border border-[#e6d3a3] bg-[#fdf9ee] p-4">
      <div className="flex items-start gap-3">
        <Mark size={36} />
        <div className="min-w-0 flex-1">
          <h2 id={`hm-${h.id}`} className="text-[16px] font-semibold">
            Hallmark #{h.seq}
          </h2>
          <p className="text-[13px] text-muted">
            Approved v{h.versionN} against rulebook v{h.rulebookVersion} · {fmtTime(h.issuedAt)}
          </p>
        </div>
      </div>
      <dl className="mt-3 grid gap-1.5 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Content SHA-256</dt>
          <dd className="truncate">
            <Code title={h.contentHash}>{h.contentHash.slice(0, 16)}…</Code>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">This Hallmark</dt>
          <dd className="truncate">
            <Code title={h.hash}>{h.hash.slice(0, 16)}…</Code>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Previous Hallmark</dt>
          <dd className="truncate">
            <Code title={h.prevHash}>{h.prevHash.slice(0, 16)}…</Code>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Approvals</dt>
          <dd className="text-right">{h.approvals.map((a) => a.by).join(", ") || "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">AI used</dt>
          <dd className="text-right">
            {h.ai.models.length ? `${h.ai.models.join(", ")} · ${h.ai.calls} call${h.ai.calls === 1 ? "" : "s"} · ${h.ai.redactions} redaction${h.ai.redactions === 1 ? "" : "s"}` : "None (rule checks only)"}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setResult(await verifyHallmarkById(h.id));
            setBusy(false);
          }}
        >
          Verify
        </button>
        <button className="btn btn-secondary btn-sm" onClick={download}>
          <Download size={14} /> Markdown record
        </button>
      </div>
      {result && (
        <p role="status" className={`mt-3 text-[13px] leading-5 ${result.ok ? "text-positive" : "text-neg-ink"}`}>
          {result.ok
            ? "Verified: the content, the record and the chain all match their hashes."
            : `Does not verify: ${[!result.contentMatches && "the content changed", !result.bodyMatches && "the record was edited", !result.chainMatches && "the chain is broken"].filter(Boolean).join(", ")}.`}
        </p>
      )}
    </section>
  );
}
