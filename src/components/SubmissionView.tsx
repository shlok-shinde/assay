"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Pencil, Upload } from "lucide-react";
import type { Finding, ImageAsset } from "@/lib/types";
import { db } from "@/store/db";
import { applyStagedFixes, blockers, isStaged, addComment, resumeAi, reviewerDecision, saveEditedVersion, stillOpen, submitForReview } from "@/store/actions";
import { useRole } from "@/store/hooks";
import { CHANNELS } from "@/seed/velvra";
import { fetchAsFile, imageAsset } from "@/lib/parse";
import { TitleRow } from "./AppShell";
import { AnnotatedText } from "./AnnotatedText";
import { DiffView } from "./DiffView";
import { FindingCard } from "./FindingCard";
import { HallmarkPanel } from "./HallmarkPanel";
import { ImageMarker } from "./ImageMarker";
import { Empty, fmtTime, Kv, Notice, ROLE_LABEL, Spinner, StatusPill, Tabs } from "./ui";

type Tab = "findings" | "versions" | "comments" | "activity";
const TODO = new Set(["open", "reopened", "sent_to_compliance", "accepted", "edited"]);

export function SubmissionView({ id }: { id: string }) {
  const role = useRole();
  const data = useLiveQuery(async () => {
    const sub = await db.submissions.get(id);
    if (!sub) return null;
    const versions = await db.versions.where("submissionId").equals(id).sortBy("n");
    const current = versions[versions.length - 1];
    const checks = (await db.checks.where("versionId").equals(current.id).toArray()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const check = checks[checks.length - 1];
    const raw = await db.findings.where("versionId").equals(current.id).toArray();
    const order = new Map((check?.findingIds ?? []).map((fid, i) => [fid, i]));
    const findings = raw.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
    const earlier = (await db.findings.where("submissionId").equals(id).toArray()).filter(
      (f) => f.versionId !== current.id && f.status !== "superseded" && f.status !== "open" && f.status !== "reopened",
    );
    const comments = await db.comments.where("submissionId").equals(id).sortBy("at");
    const hallmark = (await db.hallmarks.where("submissionId").equals(id).toArray()).sort((a, b) => b.seq - a.seq)[0];
    const rulebook = (await db.rulebooks.toArray()).find((r) => r.version === sub.rulebookVersion);
    const audit = (await db.audit.filter((a) => a.target === id).toArray()).sort((a, b) => b.at.localeCompare(a.at));
    return { sub, versions, current, check, findings, earlier, comments, hallmark, rulebook, audit };
  }, [id]);

  const [tab, setTab] = useState<Tab>("findings");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "todo">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [waive, setWaive] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // A check whose AI judgment was cut off (the tab reloaded mid-call) picks it up again here.
  const pendingCheck = data?.check?.aiPending ? data.check.id : null;
  useEffect(() => {
    if (pendingCheck) resumeAi(pendingCheck);
  }, [pendingCheck]);

  const numbers = useMemo(() => new Map([...(data?.findings ?? []), ...(data?.earlier ?? [])].map((f, i) => [f.id, i + 1])), [data?.findings, data?.earlier]);

  if (data === undefined) return <div className="p-6 text-sm text-muted">Loading the draft…</div>;
  if (data === null)
    return (
      <div className="p-6">
        <Empty title="This draft is not in this browser's workspace.">
          Drafts live in the browser that made them. <Link href="/app" className="underline">Back to drafts</Link>
        </Empty>
      </div>
    );

  const { sub, versions, current, check, findings, earlier, comments, hallmark, rulebook, audit } = data;
  const rules = new Map((rulebook?.snapshot.rules ?? []).map((r) => [r.id, r]));
  const facts = new Map((rulebook?.snapshot.facts ?? []).map((f) => [f.id, f]));
  const { openHigh, staged, canSubmit: noBlockers } = blockers(findings);
  const aiRunning = !!check?.aiPending;
  // A new version has no check row for a moment; it is not submittable until its rule checks are stored.
  const canSubmit = noBlockers && !!check && !aiRunning;
  const open = stillOpen(findings);
  const pendingCompliance = [...findings, ...earlier].filter((f) => f.status === "sent_to_compliance");
  const editable = sub.status === "draft" || sub.status === "checked" || sub.status === "changes_requested";
  const shown = filter === "todo" ? findings.filter((f) => TODO.has(f.status)) : findings;
  const ruleChecks = findings.filter((f) => f.origin === "rule" && f.confidence === undefined).length;
  const aiJudgments = findings.filter((f) => f.origin === "ai").length;
  const both = findings.filter((f) => f.origin === "rule" && f.confidence !== undefined).length;
  const channel = CHANNELS.find((c) => c.id === sub.channel)?.label;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const select = (fid: string) => {
    setSelected(fid);
    document.getElementById(`card-${fid}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    document.getElementById(`hl-${fid}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const finding = (() => {
    const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
    if (sub.status === "approved") {
      const all = [...findings, ...earlier];
      const fixed = all.filter((f) => f.status === "accepted" || f.status === "edited").length;
      const waived = all.filter((f) => f.status === "waived").length;
      const decided = all.length - fixed - waived;
      return [
        `Approved and hallmarked. ${plural(fixed, "finding")} fixed, ${decided} decided by a person`,
        waived ? `, ${waived} approved while still open (the reviewer's reason is in the Hallmark)` : "",
        ".",
      ].join("");
    }
    if (sub.status === "in_review") {
      if (pendingCompliance.length) return `In review. ${plural(pendingCompliance.length, "claim")} wait for Compliance before the reviewer can approve.`;
      return open.length
        ? `In review. Compliance has cleared every claim; ${plural(open.length, "finding is", "findings are")} still open, so the reviewer requests changes or approves with a reason.`
        : "In review. Compliance has cleared every claim; the reviewer can approve or request changes.";
    }
    if (!check) return "Not checked yet.";
    if (staged.length) return `${staged.length} accepted fix${staged.length === 1 ? "" : "es"} ready to apply as v${current.n + 1}.`;
    if (openHigh.length)
      return `${findings.length} findings; ${openHigh.length} high-severity still open. Submit for review unlocks once they are fixed or sent to Compliance.`;
    if (aiRunning) return `${plural(findings.length, "finding")} from rule checks so far; AI judgment is still running. Submit unlocks when it finishes.`;
    return open.length
      ? `${plural(open.length, "finding")} still open, none high-severity. You can submit; the reviewer then requests changes or approves over them with a recorded reason.`
      : `${plural(findings.length, "finding")}, every one fixed or decided. Ready to submit for review.`;
  })();

  const actions = (
    <>
      {role === "creator" && editable && staged.length > 0 && (
        <button className="btn btn-primary" disabled={!!busy} onClick={() => run("Applying fixes and re-checking…", () => applyStagedFixes(id))}>
          Apply {staged.length} fix{staged.length === 1 ? "" : "es"}
        </button>
      )}
      {role === "creator" && editable && staged.length === 0 && (
        <button className="btn btn-primary" disabled={!canSubmit || !!busy} onClick={() => run("Submitting…", () => submitForReview(id))}>
          Submit for review
        </button>
      )}
      {role === "reviewer" && sub.status === "in_review" && (
        <>
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => run("Sending back…", () => reviewerDecision(id, false, note || "Please address the reopened findings."))}>
            Request changes
          </button>
          <button
            className="btn btn-primary"
            disabled={!!busy || pendingCompliance.length > 0 || (open.length > 0 && !waive.trim())}
            title={pendingCompliance.length ? "Compliance still has claims to decide" : open.length && !waive.trim() ? "Give a reason for approving with findings open" : undefined}
            onClick={() => run("Approving and writing the Hallmark…", () => reviewerDecision(id, true, note, waive))}
          >
            {open.length ? `Approve with ${open.length} open` : "Approve"}
          </button>
        </>
      )}
    </>
  );

  const onReplaceImage = async (file: File) => {
    const img = await imageAsset(file);
    await run("Re-checking the new creative…", () => saveEditedVersion(id, current.text, { ...img, alt: current.image?.alt ?? "", logoBox: undefined }));
  };

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        crumb={
          <>
            <Link href="/app" className="hover:text-ink">
              Drafts
            </Link>{" "}
            / {sub.campaign || "Draft"}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {sub.title} <StatusPill status={sub.status} />
          </span>
        }
        sub={finding}
        actions={actions}
      />
      {busy && (
        <div className="mt-3">
          <Spinner label={busy} />
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {role === "reviewer" && sub.status === "in_review" && open.length > 0 && pendingCompliance.length === 0 && (
        <div className="mt-4 max-w-[720px] space-y-2">
          <Notice tone="warn">
            {open.length} finding{open.length === 1 ? " is" : "s are"} still open on v{current.n}: {open.map((f) => f.ruleId).join(", ")}. The Hallmark certifies this
            version, so request changes, or approve with a reason that is recorded on each of them.
          </Notice>
          <label htmlFor="waive-reason" className="text-[13px] font-medium">
            Reason to approve with {open.length === 1 ? "it" : "them"} open (required; sealed into the Hallmark)
          </label>
          <input id="waive-reason" className="field" value={waive} onChange={(e) => setWaive(e.target.value)} placeholder="Creative is already printed; the fixed version ships next week." />
        </div>
      )}
      {role === "reviewer" && sub.status === "in_review" && (
        <div className="mt-4 max-w-[720px]">
          <label htmlFor="decision-note" className="text-[13px] font-medium">
            Note with your decision (optional; posted as a comment)
          </label>
          <input id="decision-note" className="field mt-1.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approved for the monsoon launch." />
        </div>
      )}
      {role !== "creator" && editable && (
        <p className="mt-3 text-[13px] text-muted">You are viewing as {ROLE_LABEL[role]}. Switch to Creator in the top bar to fix and submit this draft.</p>
      )}

      <div className="mt-5">
        <Tabs
          label="Draft sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "findings", label: `Findings ${findings.length}` },
            { id: "versions", label: `Versions ${versions.length}` },
            { id: "comments", label: `Comments ${comments.length}` },
            { id: "activity", label: "Activity" },
          ]}
        />
      </div>

      {tab === "findings" && (
        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
          <div className="min-w-0 space-y-5">
            {check?.banner && <Notice tone={check.mode === "confidential" ? "info" : "warn"}>{check.banner}</Notice>}
            {aiRunning && (
              <Notice tone="info">
                <Spinner label={`Rule checks are in. AI judgment is reading ${check!.segmentsTotal - check!.segmentsReused} changed paragraph${check!.segmentsTotal - check!.segmentsReused === 1 ? "" : "s"}; its findings join this list when it answers.`} />
              </Notice>
            )}
            {check && (
              <p className="num text-[13px] leading-5 text-muted">
                Checked against rulebook v{check.rulebookVersion} · {findings.length} finding{findings.length === 1 ? "" : "s"} ({ruleChecks} rule check
                {ruleChecks === 1 ? "" : "s"}, {aiJudgments} AI judgment{aiJudgments === 1 ? "" : "s"}
                {both ? `, ${both} found by both` : ""}) · {check.dropped.length} unverifiable AI finding
                {check.dropped.length === 1 ? "" : "s"} dropped by the evidence verifier
                {check.relocated ? ` · ${check.relocated} quote${check.relocated === 1 ? "" : "s"} relocated` : ""} · rule checks in {check.ms < 1000 ? `${check.ms} ms` : `${(check.ms / 1000).toFixed(1)} s`}
                {check.aiMs !== undefined && check.mode === "rules+ai" ? ` · AI judgment in ${(check.aiMs / 1000).toFixed(1)} s` : ""}
                {check.segmentsReused ? ` · ${check.segmentsReused} of ${check.segmentsTotal} paragraphs reused from cache` : ""}
              </p>
            )}

            <section aria-labelledby="draft-h" className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="draft-h" className="text-[16px] font-semibold">
                  v{current.n} · {channel}
                  {sub.audience ? ` · ${sub.audience}` : ""}
                </h2>
                {role === "creator" && editable && editing === null && current.text && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(current.text)}>
                    <Pencil size={14} /> Edit text
                  </button>
                )}
              </div>
              {current.intentCheck && (
                <p className={`mt-1 text-[13px] ${current.intentCheck.kept ? "text-positive" : "text-warn-ink"}`}>
                  {current.intentCheck.kept ? "✓ " : "! "}
                  {current.intentCheck.summary}
                  {current.intentCheck.ai && <span className="text-muted"> · {current.intentCheck.ai.model}</span>}
                </p>
              )}
              <div className="mt-4">
                {editing !== null ? (
                  <div className="space-y-2">
                    <label htmlFor="edit-text" className="sr-only">
                      Edit the draft
                    </label>
                    <textarea id="edit-text" className="field min-h-[180px]" value={editing} onChange={(e) => setEditing(e.target.value)} />
                    <div className="flex gap-2">
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!!busy}
                        onClick={() =>
                          run("Saving and re-checking…", async () => {
                            await saveEditedVersion(id, editing);
                            setEditing(null);
                          })
                        }
                      >
                        Save as v{current.n + 1} and re-check
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : current.text ? (
                  <AnnotatedText text={current.text} findings={findings} numbers={numbers} pages={current.pages} selected={selected} onSelect={select} />
                ) : (
                  <p className="text-sm text-muted">This draft is an image only.</p>
                )}
              </div>
            </section>

            {current.image && (
              <section aria-labelledby="creative-h" className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="creative-h" className="text-[16px] font-semibold">
                    Creative · {current.image.width}×{current.image.height}
                  </h2>
                  {role === "creator" && editable && (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".png,.jpg,.jpeg"
                        className="sr-only"
                        aria-label="Replace the creative"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void onReplaceImage(f);
                          e.target.value = "";
                        }}
                      />
                      <div className="flex flex-wrap gap-1">
                        {sub.sampleId === "instagram-launch" && (
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={!!busy}
                            onClick={() =>
                              run("Re-checking the corrected creative…", async () => {
                                const img = await imageAsset(await fetchAsFile("/samples/velvra-monsoon-creative-fixed.png", "velvra-monsoon-creative-fixed.png"));
                                await saveEditedVersion(id, current.text, { ...img, alt: current.image?.alt ?? "", logoBox: { x: 64, y: 926, w: 134, h: 44 } });
                              })
                            }
                          >
                            Use the corrected sample creative
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                          <Upload size={14} /> Replace creative
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,360px)_1fr]">
                  <ImageMarker
                    image={current.image}
                    regions={findings
                      .filter((f) => f.region && f.ruleId !== "A11Y-04")
                      .map((f) => ({ id: f.id, n: numbers.get(f.id)!, box: f.region!, severity: f.severity }))}
                    selected={selected}
                    onSelect={select}
                  />
                  <AltTextEditor
                    image={current.image}
                    disabled={!(role === "creator" && editable) || !!busy}
                    onSave={(alt) => run("Saving alt text and re-checking…", () => saveEditedVersion(id, current.text, { ...current.image!, alt }))}
                  />
                </div>
              </section>
            )}

            {check && check.claims.length > 0 && (
              <section aria-labelledby="claims-h" className="card p-5">
                <h2 id="claims-h" className="text-[16px] font-semibold">
                  Claims checked against the Claim Ledger
                </h2>
                <table className="mt-3 w-full text-[14px]">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="pb-2 font-normal">Claim in the draft</th>
                      <th className="pb-2 font-normal">Fact</th>
                      <th className="pb-2 text-right font-normal">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.claims.map((c, i) => (
                      <tr key={i} className="border-t border-rule align-top">
                        <td className="py-2 pr-3">{c.text.length > 90 ? c.text.slice(0, 88) + "…" : c.text}</td>
                        <td className="py-2 pr-3 font-mono text-[12.5px]">{c.factId ?? "—"}</td>
                        <td className="py-2 text-right">
                          <span
                            className={`pill ${
                              c.status === "supported" ? "bg-pos-bg text-pos-ink" : c.status === "contradicted" ? "bg-neg-bg text-neg-ink" : "bg-warn-bg text-warn-ink border border-warn-line"
                            }`}
                          >
                            {c.status[0].toUpperCase() + c.status.slice(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section aria-labelledby="intent-h" className="rounded-[16px] bg-raised p-5">
              <h2 id="intent-h" className="text-[14px] font-semibold">
                Intent Card {sub.intent.confirmed ? "· confirmed by the creator" : ""}
              </h2>
              <div className="mt-2">
                <Kv k="Goal" v={sub.intent.goal || "—"} />
                <Kv k="Key message" v={sub.intent.keyMessage || "—"} />
                <Kv k="Call to action" v={sub.intent.cta || "—"} />
              </div>
            </section>

            {hallmark && <HallmarkPanel hallmark={hallmark} />}
          </div>

          <section aria-labelledby="findings-h" className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h2 id="findings-h" className="text-[16px] font-semibold">
                Findings
              </h2>
              <div role="radiogroup" aria-label="Show" className="flex rounded-full bg-raised p-0.5 text-[13px]">
                {(["all", "todo"] as const).map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={filter === v}
                    onClick={() => setFilter(v)}
                    className={`h-7 rounded-full px-3 ${filter === v ? "bg-sheet font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-muted"}`}
                  >
                    {v === "all" ? `All ${findings.length}` : `Needs action ${findings.filter((f) => TODO.has(f.status)).length}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 space-y-3">
              {shown.length === 0 && <li><Empty title={findings.length ? "Nothing needs action here." : "No findings. This draft follows the rulebook."} /></li>}
              {shown.map((f: Finding) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  n={numbers.get(f.id)!}
                  rule={rules.get(f.ruleId)}
                  fact={f.factId ? facts.get(f.factId) : undefined}
                  relatedRules={f.relatedRuleIds.map((r) => rules.get(r)).filter((r): r is NonNullable<typeof r> => !!r)}
                  text={current.text}
                  intent={sub.intent}
                  role={role}
                  status={sub.status}
                  selected={selected === f.id}
                  onSelect={() => select(f.id)}
                  comments={comments.filter((c) => c.findingId === f.id)}
                />
              ))}
              {earlier.length > 0 && (
                <div className="pt-3">
                  <h3 className="text-[14px] font-semibold">Fixed or decided in earlier versions</h3>
                  <p className="text-[13px] text-muted">Claims fixed before submission still go to Compliance for sign-off.</p>
                  <div className="mt-3 space-y-3">
                    {earlier.map((f) => (
                      <FindingCard
                        key={f.id}
                        finding={f}
                        n={numbers.get(f.id)!}
                        rule={rules.get(f.ruleId)}
                        fact={f.factId ? facts.get(f.factId) : undefined}
                        relatedRules={f.relatedRuleIds.map((r) => rules.get(r)).filter((r): r is NonNullable<typeof r> => !!r)}
                        text={versions.find((v) => v.id === f.versionId)?.text ?? ""}
                        intent={sub.intent}
                        role={role}
                        status={sub.status}
                        selected={selected === f.id}
                        onSelect={() => setSelected(f.id)}
                        comments={comments.filter((c) => c.findingId === f.id)}
                        versionLabel={`v${versions.find((v) => v.id === f.versionId)?.n}`}
                      />
                    ))}
                  </div>
                </div>
              )}
              {staged.length > 0 && role === "creator" && editable && (
                <p className="text-[13px] text-muted">
                  {staged.filter(isStaged).length} fix{staged.length === 1 ? "" : "es"} accepted. Apply them to create v{current.n + 1}; Assay re-checks only what changed.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {tab === "versions" && (
        <div className="mt-5 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <ol className="space-y-2">
            {[...versions].reverse().map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => setDiffFrom(v.n)}
                  className={`w-full rounded-[14px] border p-3 text-left ${(diffFrom ?? current.n) === v.n ? "border-gold bg-gold-wash" : "border-line hover:bg-raised"}`}
                >
                  <p className="text-[14px] font-medium">
                    v{v.n} <span className="font-normal text-muted">· {v.note}</span>
                  </p>
                  <p className="text-[12px] text-muted">
                    {v.author} · {fmtTime(v.createdAt)}
                  </p>
                  {v.intentCheck && <p className={`mt-1 text-[12px] ${v.intentCheck.kept ? "text-positive" : "text-warn-ink"}`}>{v.intentCheck.summary}</p>}
                </button>
              </li>
            ))}
          </ol>
          <div className="card min-w-0 p-5">
            {(() => {
              const n = diffFrom ?? current.n;
              const v = versions.find((x) => x.n === n)!;
              const prev = versions.find((x) => x.n === n - 1);
              return (
                <>
                  <h2 className="text-[16px] font-semibold">{prev ? `Changes from v${prev.n} to v${v.n}` : `v${v.n}, as submitted`}</h2>
                  <div className="mt-3">{prev ? <DiffView before={prev.text} after={v.text} /> : <p className="whitespace-pre-wrap text-[14px] leading-[26px]">{v.text}</p>}</div>
                  {prev && prev.image?.alt !== v.image?.alt && <p className="mt-3 text-[13px] text-muted">Alt text changed to “{v.image?.alt}”.</p>}
                  {prev && prev.image?.dataUrl !== v.image?.dataUrl && <p className="mt-3 text-[13px] text-muted">The creative was replaced.</p>}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {tab === "comments" && <DraftComments submissionId={id} comments={comments.filter((c) => !c.findingId)} findingComments={comments.filter((c) => c.findingId)} numbers={numbers} />}

      {tab === "activity" && (
        <ol className="mt-5 max-w-[760px] space-y-0">
          {audit.map((a) => (
            <li key={a.id} className="flex justify-between gap-4 border-b border-rule py-2.5 text-[14px]">
              <span>
                <span className="font-medium">{a.actor}</span> {a.action}
                {a.details ? <span className="text-muted"> · {a.details}</span> : null}
              </span>
              <span className="num flex-none text-[12px] text-muted">{fmtTime(a.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AltTextEditor({ image, disabled, onSave }: { image: ImageAsset; disabled: boolean; onSave: (alt: string) => void }) {
  const [alt, setAlt] = useState(image.alt);
  return (
    <div className="space-y-3 text-[14px]">
      <div>
        <label htmlFor="alt-edit" className="text-[14px] font-medium">
          Alt text
        </label>
        <textarea id="alt-edit" className="field mt-2" rows={3} value={alt} disabled={disabled} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the image and any text in it" />
        {!disabled && (
          <button className="btn btn-secondary btn-sm mt-2" disabled={alt.trim() === image.alt.trim() || !alt.trim()} onClick={() => onSave(alt.trim())}>
            Save alt text
          </button>
        )}
      </div>
      <p className="text-[13px] leading-5 text-muted">
        {image.logoBox ? `Logo box marked by hand: ${Math.round(image.logoBox.w)}×${Math.round(image.logoBox.h)} px. ` : "No logo box marked, so the logo size was not checked. "}
        Contrast is measured on the original pixels of each line the OCR finds; palette distance uses ΔE2000.
      </p>
    </div>
  );
}

function DraftComments({
  submissionId,
  comments,
  findingComments,
  numbers,
}: {
  submissionId: string;
  comments: { id: string; author: string; text: string; at: string }[];
  findingComments: { id: string; author: string; text: string; at: string; findingId?: string }[];
  numbers: Map<string, number>;
}) {
  const role = useRole();
  const [text, setText] = useState("");
  return (
    <div className="mt-5 grid max-w-[980px] gap-6 lg:grid-cols-2">
      <section aria-labelledby="dc-h">
        <h2 id="dc-h" className="text-[16px] font-semibold">
          On the draft
        </h2>
        <ul className="mt-3 space-y-2">
          {comments.length === 0 && <li><Empty title="No comments on the draft yet." /></li>}
          {comments.map((c) => (
            <li key={c.id} className="rounded-[12px] bg-raised px-3.5 py-2.5 text-[14px] leading-[22px]">
              <span className="font-medium">{c.author}</span> <span className="text-[12px] text-muted">· {fmtTime(c.at)}</span>
              <p>{c.text}</p>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            await addComment(submissionId, role, text.trim());
            setText("");
          }}
        >
          <label htmlFor="new-comment" className="text-[13px] font-medium">
            Comment as {ROLE_LABEL[role]}
          </label>
          <textarea id="new-comment" className="field" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary btn-sm" type="submit" disabled={!text.trim()}>
            Post
          </button>
        </form>
      </section>
      <section aria-labelledby="fc-h">
        <h2 id="fc-h" className="text-[16px] font-semibold">
          On findings
        </h2>
        <ul className="mt-3 space-y-2">
          {findingComments.length === 0 && <li><Empty title="No comments on findings yet." /></li>}
          {findingComments.map((c) => (
            <li key={c.id} className="rounded-[12px] bg-raised px-3.5 py-2.5 text-[14px] leading-[22px]">
              <span className="marker !ml-0 mr-1.5">{numbers.get(c.findingId!) ?? "–"}</span>
              <span className="font-medium">{c.author}</span> <span className="text-[12px] text-muted">· {fmtTime(c.at)}</span>
              <p>{c.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
