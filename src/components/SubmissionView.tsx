"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { flash, useDealIn, useGlide } from "./motion";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, FileDown, Pencil, Printer, Trash2, Upload } from "lucide-react";
import type { Finding, ImageAsset } from "@/lib/types";
import type { FixPlan } from "@/engine/fix";
import { db } from "@/store/db";
import { applyStagedFixes, awaitingRework, blockers, deleteSubmission, draftReport, hydrateImage, isStaged, addComment, resumeAi, retryAi, reviewerDecision, runMissingCheck, saveEditedVersion, stagedFixPlan, stillOpen, submitForReview } from "@/store/actions";
import { useAiStatus, useKit, useRole } from "@/store/hooks";
import { CHANNELS } from "@/seed/velvra";
import { fetchAsFile, imageAsset, IntakeError, parseFile } from "@/lib/parse";
import { isDeletable } from "@/lib/policy";
import { TitleRow } from "./AppShell";
import { saveFile } from "./download";
import { AnnotatedText } from "./AnnotatedText";
import { DiffView } from "./DiffView";
import { FindingCard } from "./FindingCard";
import { FixConflict } from "./FixConflict";
import { HallmarkPanel } from "./HallmarkPanel";
import { ImageMarker } from "./ImageMarker";
import { IntentLine } from "./Intent";
import { nextStep } from "./next-step";
import { MarkStrip, markStateOf, Table, Term, useAction, useConfirm, useToast } from "./primitives";
import { Code, Empty, fmtTime, Kv, Notice, PageLoading, ROLE_LABEL, Spinner, StatusPanel, StatusPill, TabPanel, Tabs, useTabParam } from "./ui";

type Tab = "findings" | "versions" | "comments" | "activity";
const TABS: readonly Tab[] = ["findings", "versions", "comments", "activity"];
const TODO = new Set(["open", "reopened", "sent_to_compliance", "accepted", "edited"]);
/** Still to be acted on by someone: contesting a high-severity finding does not clear it, so it stays on the list. */
const needsAction = (f: Finding) => TODO.has(f.status) || (f.status === "contested" && f.severity === "high");

/** What a reviewer or Compliance said, tidied to sit inside a sentence. */
const reasonOf = (f: Finding) => (f.resolution?.reason ?? "").trim().replace(/[.!?]+$/, "") || "no reason given";

export function SubmissionView({ id }: { id: string }) {
  const role = useRole();
  const data = useLiveQuery(async () => {
    const sub = await db.submissions.get(id);
    if (!sub) return { kind: "missing" as const };
    const versions = await db.versions.where("submissionId").equals(id).sortBy("n");
    const stored = versions[versions.length - 1];
    // Seeded history only feeds Guideline Health: it has no versions, so there is no draft to open.
    if (!stored) return { kind: "history" as const, sub };
    // The stored row holds the creative's key, not its pixels: the version on screen gets them back.
    const current = { ...stored, image: await hydrateImage(stored.image) };
    const checks = (await db.checks.where("versionId").equals(current.id).toArray()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const check = checks[checks.length - 1];
    const raw = await db.findings.where("versionId").equals(current.id).toArray();
    const order = new Map((check?.findingIds ?? []).map((fid, i) => [fid, i]));
    const findings = raw.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
    // Reopened ones stay: a claim Compliance sent back is still the creator's to answer on a later version.
    const earlier = (await db.findings.where("submissionId").equals(id).toArray()).filter(
      (f) => f.versionId !== current.id && f.status !== "superseded" && f.status !== "open",
    );
    const comments = await db.comments.where("submissionId").equals(id).sortBy("at");
    const hallmark = (await db.hallmarks.where("submissionId").equals(id).toArray()).sort((a, b) => b.seq - a.seq)[0];
    const rulebook = (await db.rulebooks.toArray()).find((r) => r.version === sub.rulebookVersion);
    const audit = (await db.audit.filter((a) => a.target === id).toArray()).sort((a, b) => b.at.localeCompare(a.at));
    return { kind: "draft" as const, sub, versions, current, check, findings, earlier, comments, hallmark, rulebook, audit };
  }, [id]);
  const draft = data?.kind === "draft" ? data : undefined;
  // How the accepted fixes fit together, kept current as findings are accepted and undone: what overlaps and what composes.
  const fixPlan = useLiveQuery(() => (role === "creator" ? stagedFixPlan(id).catch(() => undefined) : undefined), [id, role]);

  const [tab, setTab] = useTabParam<Tab>(TABS, "findings");
  // Below 1280 px the draft and its findings take turns; from 1280 px they sit side by side.
  const [pane, setPane] = useState<"draft" | "findings">("draft");
  const [leaving, setLeaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "todo">("todo");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [waive, setWaive] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  // The fixes that want the same words, while the creator chooses between them.
  const [resolving, setResolving] = useState<FixPlan | null>(null);
  const toast = useToast();
  const router = useRouter();
  const confirm = useConfirm();
  const kit = useKit();
  const ai = useAiStatus();
  const fileRef = useRef<HTMLInputElement>(null);
  // One action at a time: a second click while one runs does nothing, and a failure shows in a toast and
  // under the title instead of vanishing.
  const { run: exec, error } = useAction(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  });
  const run = (label: string, fn: () => Promise<unknown>) => exec(label, fn);
  // The AI pass again, on a check that fell back to rule checks or read only part of a long draft.
  const again = useAction((checkId: string) => retryAi(checkId), { errorPrefix: "Could not start the AI again", toastError: false });
  // The record of the draft as a Markdown file: what was checked, found and decided, for someone outside Assay.
  const report = useAction(
    async () => {
      const r = await draftReport(id);
      saveFile(r.fileName, r.markdown, "text/markdown");
    },
    { errorPrefix: "Could not make the report", success: "Report downloaded." },
  );
  // Delete asks first, says what goes, and leaves for the list once it is done. The store refuses a
  // draft that has reviewers or a Hallmark; its sentence comes back here as the error.
  const remove = useAction(
    async (title: string, versionCount: number) => {
      const yes = await confirm({
        title: "Delete this draft?",
        body: (
          <p>
            “{title}” and its {versionCount === 1 ? "version" : `${versionCount} versions`}, findings and comments are removed from this browser. This cannot be undone.
          </p>
        ),
        confirmLabel: "Delete draft",
        danger: true,
      });
      if (!yes) return false;
      setLeaving(true);
      try {
        await deleteSubmission(id);
      } catch (e) {
        setLeaving(false);
        throw e;
      }
      router.push("/app");
      return true;
    },
    { errorPrefix: "Could not delete the draft", success: (done) => (done ? "Draft deleted." : undefined) },
  );

  // A check whose AI judgment was cut off (the tab reloaded mid-call) picks it up again here.
  const pendingCheck = draft?.check?.aiPending ? draft.check.id : null;
  useEffect(() => {
    if (pendingCheck) resumeAi(pendingCheck);
  }, [pendingCheck]);

  // Findings deal in when a check lands; ones the AI pass adds later get a gold wash.
  const list = useRef<HTMLDivElement>(null);
  const filterBox = useRef<HTMLDivElement>(null);
  const filterPill = useRef<HTMLSpanElement>(null);
  useDealIn(list, ":scope > article", [draft?.check?.id]);
  const seenFindings = useRef<{ check?: string; ids: Set<string> }>({ ids: new Set() });
  useEffect(() => {
    if (!draft) return;
    const ids = new Set(draft.findings.map((f) => f.id));
    const before = seenFindings.current;
    if (before.check && before.check === draft.check?.id) for (const id of ids) if (!before.ids.has(id)) flash(document.getElementById(`card-${id}`));
    seenFindings.current = { check: draft.check?.id, ids };
  }, [draft]);

  useGlide(filterBox, filterPill, '[aria-checked="true"]', [filter, data === undefined], "both");

  const numbers = useMemo(() => new Map([...(draft?.findings ?? []), ...(draft?.earlier ?? [])].map((f, i) => [f.id, i + 1])), [draft?.findings, draft?.earlier]);

  if (data === undefined) return <PageLoading label="Opening the draft…" />;
  if (leaving) return <PageLoading label="Deleting the draft…" />;
  if (data.kind === "missing")
    return (
      <StatusPanel
        title="This draft is not in this browser's workspace."
        actions={
          <Link href="/app" className="btn btn-inverse btn-lg">
            Back to drafts
          </Link>
        }
      >
        <p>Drafts live in the browser that made them, so a link to one does not open in another browser.</p>
      </StatusPanel>
    );
  if (data.kind === "history")
    return (
      <StatusPanel
        title={`${data.sub.title} is part of the seeded demo history.`}
        actions={
          <>
            <Link href="/app" className="btn btn-inverse btn-lg">
              Back to drafts
            </Link>
            <Link href="/app/health" className="btn btn-ghost btn-lg">
              See Guideline Health
            </Link>
          </>
        }
      >
        <p>Seeded history only feeds Guideline Health, so it has no draft to open.</p>
      </StatusPanel>
    );

  const { sub, versions, current, check, findings, earlier, comments, hallmark, rulebook, audit } = data;
  const rules = new Map((rulebook?.snapshot.rules ?? []).map((r) => [r.id, r]));
  const facts = new Map((rulebook?.snapshot.facts ?? []).map((f) => [f.id, f]));
  // Claims Compliance sent back after this version was made: nothing on screen answers them but a new version.
  const { openHigh, staged, rework, canSubmit: noBlockers } = blockers(findings, awaitingRework(earlier, current));
  const aiRunning = !!check?.aiPending;
  // A new version has no check row for a moment; it is not submittable until its rule checks are stored.
  const canSubmit = noBlockers && !!check && !aiRunning;
  // What the reviewer must answer for: this version's open findings, a contested high-severity one (contesting
  // does not clear it), and anything Compliance sent back that is still open.
  const reopenedEarlier = earlier.filter((f) => f.status === "reopened");
  const open = stillOpen([...findings, ...reopenedEarlier]);
  const contestedOpen = open.filter((f) => f.status === "contested");
  const where = (f: Finding) => (f.versionId === current.id ? f.ruleId : `${f.ruleId} (v${versions.find((v) => v.id === f.versionId)?.n})`);
  const pendingCompliance = [...findings, ...earlier].filter((f) => f.status === "sent_to_compliance");
  const editable = sub.status === "draft" || sub.status === "checked" || sub.status === "changes_requested";
  const shown = filter === "todo" ? findings.filter(needsAction) : findings;
  // Earlier versions' findings: claims still with Compliance, or sent back by them, stay in view (someone
  // must act on them); everything settled folds away, so the list is the work left, not the whole history.
  const earlierPending = earlier.filter((f) => f.status === "sent_to_compliance" || f.status === "reopened");
  const earlierSettled = earlier.filter((f) => f.status !== "sent_to_compliance" && f.status !== "reopened");
  const todoCount = findings.filter(needsAction).length + earlierPending.length;
  const ruleChecks = findings.filter((f) => f.origin === "rule" && f.confidence === undefined).length;
  const aiJudgments = findings.filter((f) => f.origin === "ai").length;
  const both = findings.filter((f) => f.origin === "rule" && f.confidence !== undefined).length;
  const channel = CHANNELS.find((c) => c.id === sub.channel)?.label;
  const marks = markStateOf(sub.status, {
    hasCheck: !!check,
    hasFixVersion: versions.length > 1,
    hasHallmark: !!hallmark,
    openClaims: [...findings, ...earlier].filter((f) => f.category === "claim" && (f.status === "sent_to_compliance" || (f.status === "reopened" && f.resolution?.role === "compliance"))).length,
  });

  const contestedClaims = contestedOpen.filter((f) => f.category === "claim").length;
  const next = nextStep({
    status: sub.status,
    role,
    hasCheck: !!check,
    aiRunning,
    staged: staged.length,
    rework: rework.length,
    openHigh: openHigh.length,
    open: open.length,
    withCompliance: pendingCompliance.length,
    contestedClaims,
    version: current.n,
  });
  // The AI could be asked again: the check fell back to rule checks, or read only part of a long draft.
  // Not offered when nothing could answer (Confidential mode, no key on this deployment), while it runs,
  // or once the draft is with reviewers.
  const aiCanRetry =
    !!check && editable && !aiRunning && check.mode !== "confidential" && !kit?.confidential && ai?.aiConfigured !== false && (check.mode === "rules-only" || /^The AI read \d+ of \d+/.test(check.banner ?? ""));
  const deletable = isDeletable(sub.status) && !sub.seeded;

  // A highlight in the draft opens its card (switching to the findings pane on a narrow screen); a card
  // finds its highlight in the draft, and stays where it is.
  const select = (fid: string, from: "draft" | "card" = "draft") => {
    setSelected(fid);
    const narrow = !window.matchMedia("(min-width: 1280px)").matches;
    if (narrow && from === "draft") setPane("findings");
    const show = () => {
      document.getElementById(`card-${fid}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (!narrow || from === "draft") document.getElementById(`hl-${fid}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      flash(document.getElementById(`hl-${fid}`));
    };
    if (narrow && from === "draft") requestAnimationFrame(show);
    else show();
  };

  const finding = (() => {
    const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
    if (sub.status === "approved") {
      const all = [...findings, ...earlier];
      const count = (...st: string[]) => all.filter((f) => st.includes(f.status)).length;
      const parts = [
        [count("accepted", "edited"), "fixed"],
        [count("compliance_approved"), "cleared by Compliance"],
        [count("dismissed", "contested"), "dismissed or contested with a reason"],
        [count("waived"), "approved while still open (the reviewer's reason is in the Hallmark)"],
      ].filter(([n]) => n) as [number, string][];
      return `Approved and hallmarked. ${parts.map(([n, what], i) => `${i ? n : plural(n, "finding")} ${what}`).join(", ") || "No findings"}.`;
    }
    if (sub.status === "in_review") {
      if (pendingCompliance.length) return `In review. ${plural(pendingCompliance.length, "claim")} wait for Compliance before the reviewer can approve.`;
      return open.length
        ? `In review. Compliance has cleared every claim; ${plural(open.length, "finding is", "findings are")} still open${contestedOpen.length ? ` (${contestedOpen.length} contested by the creator, which does not clear a high-severity finding)` : ""}, so the reviewer requests changes or approves with a reason.`
        : "In review. Compliance has cleared every claim; the reviewer can approve or request changes.";
    }
    if (!check) return "Not checked yet.";
    if (rework.length)
      return `Compliance sent back ${rework.length === 1 ? `${rework[0].ruleId}: ${reasonOf(rework[0])}` : `${rework.length} claims: ${rework.map((f) => `${f.ruleId}: ${reasonOf(f)}`).join("; ")}`}. Edit the draft to make a new version, then submit again; ${rework.length === 1 ? "the claim goes" : "the claims go"} back to Compliance.`;
    if (staged.length) {
      const places = fixPlan?.conflicts.length ?? 0;
      const read = fixPlan?.composed.length ?? 0;
      return [
        `${staged.length} accepted fix${staged.length === 1 ? "" : "es"} ready to apply as v${current.n + 1}.`,
        places ? `${plural(places, "place")} where fixes want the same words: you choose between them when you apply.` : "",
        read ? `${plural(read, "sentence")} changed by more than one fix without overlapping: they apply together and are read together as one result.` : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    if (openHigh.length)
      return `${findings.length} findings; ${openHigh.length} high-severity still open. Submit for review unlocks once they are fixed or sent to Compliance.`;
    if (aiRunning) return `${plural(findings.length, "finding")} from rule checks so far; AI judgment is still running. Submit unlocks when it finishes.`;
    // A contested claim goes to Compliance on submit; any other contested high-severity finding stays open
    // for the reviewer. Contesting clears neither.
    const toCompliance = contestedOpen.filter((f) => f.category === "claim");
    const toReviewer = open.filter((f) => !toCompliance.includes(f));
    const parts = [
      toReviewer.length
        ? `${plural(toReviewer.length, "finding")} still open${contestedOpen.length > toCompliance.length ? `, ${contestedOpen.length - toCompliance.length} of them contested high-severity (contesting does not clear it; a reviewer must)` : ", none high-severity"}. You can submit; the reviewer then requests changes or approves over them with a recorded reason.`
        : "",
      toCompliance.length
        ? `${toReviewer.length ? "" : "Ready to submit. "}${plural(toCompliance.length, "contested claim")} ${toCompliance.length === 1 ? "goes" : "go"} to Compliance when you submit: contesting does not clear a high-severity claim, Compliance decides it.`
        : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" ") : `${plural(findings.length, "finding")}, every one fixed or decided. Ready to submit for review.`;
  })();

  // Fixes that read together are said so once they are in: the version's own note counts them, this says how they were checked.
  const saidApplied = (plan: FixPlan) => {
    if (plan.composed.length)
      toast(`Applied as v${current.n + 1}. ${plan.composed.length === 1 ? "One sentence" : `${plan.composed.length} sentences`} had several fixes that did not overlap, so the intent check read each as one result.`);
  };
  // Pressing Apply first asks how the fixes fit together: with none overlapping it applies straight away, as before.
  const startApply = () =>
    run("Checking how the fixes fit together…", async () => {
      const plan = await stagedFixPlan(id);
      if (plan.conflicts.length) {
        setResolving(plan);
        return;
      }
      setBusy("Applying fixes and re-checking…");
      await applyStagedFixes(id);
      saidApplied(plan);
    });

  const actions = (
    <>
      {!check && editable && (
        <button className="btn btn-primary" disabled={!!busy} onClick={() => run("Checking against the rulebook and Claim Ledger…", () => runMissingCheck(id))}>
          Run the check
        </button>
      )}
      {role === "creator" && editable && staged.length > 0 && (
        <button className="btn btn-primary" disabled={!!busy} onClick={startApply}>
          Apply {staged.length} fix{staged.length === 1 ? "" : "es"}
        </button>
      )}
      {role === "creator" && editable && staged.length === 0 && !!check && (
        <button
          className="btn btn-primary"
          disabled={!canSubmit || !!busy}
          title={rework.length ? "Compliance sent a claim back: edit the draft to make a new version first" : undefined}
          onClick={() => run("Submitting…", () => submitForReview(id))}
        >
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
      <button className="btn btn-secondary" disabled={report.busy} onClick={() => report.run()}>
        <FileDown size={14} aria-hidden="true" /> Download report
      </button>
      <Link href={`/app/s/${id}/report`} className="btn btn-ghost">
        <Printer size={14} aria-hidden="true" /> Print view
      </Link>
      {deletable && (
        <button className="btn btn-ghost text-neg-ink" disabled={!!busy || remove.busy} onClick={() => remove.run(sub.title, versions.length)}>
          <Trash2 size={14} aria-hidden="true" /> Delete draft
        </button>
      )}
    </>
  );

  // The same intake as New draft: a bad, empty or oversized file says why and changes nothing.
  const onReplaceImage = (file: File) =>
    run("Reading the new creative…", async () => {
      const parsed = await parseFile(file);
      if (parsed.kind !== "image" || !parsed.image) throw new IntakeError(`${file.name} is not a PNG or JPG, so the creative was not changed.`);
      setBusy("Re-checking the new creative…");
      const saved = await saveEditedVersion(id, current.text, { ...parsed.image, alt: current.image?.alt ?? "", logoBox: undefined });
      if (saved === current.id) toast("That is the creative already on this draft, so nothing changed.");
    });

  return (
    <div className="px-4 py-5 md:px-8 md:py-8">
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
        sub={
          <>
            <p>{finding}</p>
            <div className="mt-4 inline-flex max-w-full rounded-[28px] bg-raised px-5 py-3">
              <MarkStrip key={id} animateNew {...marks} />
            </div>
          </>
        }
        actions={actions}
      />
      <p data-testid="next-step" className="mt-4 flex max-w-[860px] items-start gap-3 rounded-[28px] bg-raised py-4 pl-5 pr-4 text-[14px] leading-[22px]">
        <ArrowRight size={16} aria-hidden="true" className="mt-[3px] flex-none text-ink" />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">Next</span> <span className="text-muted">·</span> {next.text}
        </span>
        {next.yours && <span className="pill bg-active text-ink">Your move</span>}
      </p>
      {busy && (
        <div className="mt-3">
          <Spinner label={busy} />
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        </div>
      )}
      {remove.error && (
        <div className="mt-3">
          <Notice tone="error" role="alert">
            {remove.error}
          </Notice>
        </div>
      )}
      {check?.banner && (
        <div className="mt-3 max-w-[860px]">
          <Notice tone={check.mode === "confidential" ? "info" : "warn"} role="status">
            <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="min-w-0 flex-1 basis-[280px]">{check.banner}</span>
              {aiCanRetry && (
                <button className="btn btn-secondary btn-sm flex-none" disabled={again.busy} onClick={() => again.run(check.id)}>
                  {again.busy ? "Starting…" : "Try the AI again"}
                </button>
              )}
            </span>
          </Notice>
          {again.error && (
            <p role="alert" className="mt-2 text-[13px] text-neg-ink">
              {again.error}
            </p>
          )}
        </div>
      )}
      {aiRunning && (
        <div className="mt-3 max-w-[860px]">
          <Notice tone="info" role="status">
            <Spinner label={`Rule checks are in. AI judgment is reading ${check!.segmentsTotal - check!.segmentsReused} changed paragraph${check!.segmentsTotal - check!.segmentsReused === 1 ? "" : "s"}; its findings join this list when it answers.`} />
          </Notice>
        </div>
      )}
      {role === "reviewer" && sub.status === "in_review" && open.length > 0 && pendingCompliance.length === 0 && (
        <div className="mt-4 max-w-[720px] space-y-2">
          <Notice tone="warn">
            {open.length} finding{open.length === 1 ? " is" : "s are"} still open on v{current.n}: {open.map(where).join(", ")}. The <Term id="hallmark">Hallmark</Term> certifies this
            version, so request changes, or approve with a reason that is recorded on each of them.
            {contestedOpen.length > 0 && (
              <>
                {" "}
                {contestedOpen.map(where).join(", ")} {contestedOpen.length === 1 ? "was" : "were"} contested by the creator. Contesting does not clear a high-severity finding, so{" "}
                {contestedOpen.length === 1 ? "it needs" : "they need"} your reason too, or send {contestedOpen.length === 1 ? "it" : "them"} back with Reopen.
              </>
            )}
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
          idBase="draft"
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

      <TabPanel idBase="draft" id={tab}>
      {tab === "findings" && (
        <>
        <div role="group" aria-label="Show the draft or its findings" className="sticky top-12 z-10 -mx-4 mt-3 bg-sheet px-4 py-2 md:-mx-6 md:px-6 lg:top-0 xl:hidden">
          <div className="flex w-full max-w-[420px] rounded-full bg-raised p-1 text-[14px]">
            {(["draft", "findings"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={pane === v}
                onClick={() => setPane(v)}
                className={`h-9 flex-1 rounded-full px-4 transition-colors duration-300 ${pane === v ? "bg-ink font-medium text-sheet" : "text-muted hover:text-ink"}`}
              >
                {v === "draft" ? "Draft" : `Findings · ${todoCount} to do`}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid gap-6 xl:mt-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
          <div className={`min-w-0 space-y-5 ${pane === "draft" ? "" : "max-xl:hidden"}`}>
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

            <section aria-labelledby="draft-h" className="card p-6">
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
              {current.intentCheck && <IntentLine check={current.intentCheck} className="mt-1" />}
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
              <section aria-labelledby="creative-h" className="card p-6">
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
              <section aria-labelledby="claims-h" className="card p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="claims-h" className="text-[16px] font-semibold">
                    Claims checked against the <Term id="claim-ledger">Claim Ledger</Term>
                  </h2>
                  <p className="num text-[13px] text-muted">
                    {check.claims.filter((c) => c.status === "supported").length} of {check.claims.length} supported
                  </p>
                </div>
                <Table label="Claims in this draft" className="mt-2">
                  <thead>
                    <tr>
                      <th>Claim in the draft</th>
                      <th>Fact</th>
                      <th className="!text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.claims.map((c, i) => (
                      <tr key={i}>
                        <td className="pr-3">{c.text.length > 90 ? c.text.slice(0, 88) + "…" : c.text}</td>
                        <td className="pr-3 whitespace-nowrap">{c.factId ? <Code>{c.factId}</Code> : <span className="text-faint">—</span>}</td>
                        <td className="text-right">
                          <span className={`pill ${c.status === "supported" ? "bg-pos-bg text-pos-ink" : c.status === "contradicted" ? "bg-neg-bg text-neg-ink" : "bg-warn-bg text-warn-ink border border-warn-line"}`}>
                            {c.status[0].toUpperCase() + c.status.slice(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </section>
            )}

            <section aria-labelledby="intent-h" className="card p-6">
              <h2 id="intent-h" className="text-[14px] font-semibold">
                <Term id="intent-card">Intent Card</Term> {sub.intent.confirmed ? "· confirmed by the creator" : ""}
              </h2>
              <div className="mt-2">
                <Kv k="Goal" v={sub.intent.goal || "—"} />
                <Kv k="Key message" v={sub.intent.keyMessage || "—"} />
                <Kv k="Call to action" v={sub.intent.cta || "—"} />
              </div>
            </section>

            {hallmark && <HallmarkPanel hallmark={hallmark} />}
          </div>

          <section aria-labelledby="findings-h" className={`findings-pane min-w-0 ${pane === "findings" ? "" : "max-xl:hidden"}`}>
            <div className="flex items-center justify-between gap-2">
              <h2 id="findings-h" className="text-[16px] font-semibold">
                Findings
              </h2>
              <div ref={filterBox} role="radiogroup" aria-label="Show" className="relative flex rounded-full bg-raised p-0.5 text-[13px]">
                <span ref={filterPill} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 rounded-full bg-sheet opacity-0 shadow-[0_1px_2px_rgba(0,0,0,0.25)]" />
                {(["all", "todo"] as const).map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={filter === v}
                    onClick={() => setFilter(v)}
                    className={`relative z-10 h-7 rounded-full px-3 transition-colors duration-300 ${filter === v ? "font-medium" : "text-muted hover:text-ink"}`}
                  >
                    {v === "all" ? `All ${findings.length}` : `Needs action ${todoCount}`}
                  </button>
                ))}
              </div>
            </div>
            <div ref={list} className="mt-3 space-y-3">
              {shown.length === 0 &&
                (!check ? (
                  <Empty title="This version has not been checked.">The check did not finish, or this tab closed before it did. Use Run the check at the top of the page; nothing can be submitted until it has run.</Empty>
                ) : findings.length ? (
                  <Empty title="Nothing needs action here." />
                ) : (
                  <Empty title={check.mode === "rules+ai" ? "No findings. The rule checks and the AI found nothing to flag." : "No findings from the rule checks."}>
                    {check.mode === "rules+ai" ? "The check covers the rulebook's rules and the Claim Ledger; it does not replace a reviewer's read." : "Tone and messaging rules need the AI, which did not read this draft."}
                  </Empty>
                ))}
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
                  onSelect={() => select(f.id, "card")}
                  comments={comments.filter((c) => c.findingId === f.id)}
                />
              ))}
              {earlierPending.length > 0 && (
                <div className="pt-3">
                  <h3 className="text-[14px] font-semibold">With Compliance from earlier versions</h3>
                  <p className="text-[13px] text-muted">
                    {reopenedEarlier.length
                      ? "A claim Compliance sent back stays here until a new version answers it and you submit again; it then goes back to Compliance. Claims fixed before submission also go to Compliance for sign-off."
                      : "Claims fixed before submission still go to Compliance for sign-off."}
                  </p>
                  <div className="mt-3 space-y-3">
                    {earlierPending.map((f) => (
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
              {earlierSettled.length > 0 && (
                <details className="history pt-3">
                  <summary className="history-summary">
                    Fixed or decided in earlier versions <span className="num text-muted">· {earlierSettled.length}</span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    {earlierSettled.map((f) => (
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
                </details>
              )}
              {staged.length > 0 && role === "creator" && editable && (
                <p className="text-[13px] text-muted">
                  {staged.filter(isStaged).length} fix{staged.length === 1 ? "" : "es"} accepted. Apply them to create v{current.n + 1}; Assay re-checks only what changed.
                </p>
              )}
            </div>
          </section>
        </div>
        </>
      )}

      {tab === "versions" && (
        <div className="mt-5 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <ol className="space-y-2">
            {[...versions].reverse().map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => setDiffFrom(v.n)}
                  className={`w-full rounded-[24px] p-4 text-left transition-colors ${(diffFrom ?? current.n) === v.n ? "bg-active" : "bg-raised hover:bg-active"}`}
                >
                  <p className="text-[14px] font-medium">
                    v{v.n} <span className="font-normal text-muted">· {v.note}</span>
                  </p>
                  <p className="text-[12px] text-muted">
                    {v.author} · {fmtTime(v.createdAt)}
                  </p>
                  {v.intentCheck && <IntentLine check={v.intentCheck} className="mt-1.5 !text-[12.5px]" />}
                </button>
              </li>
            ))}
          </ol>
          <div className="card min-w-0 p-6">
            {(() => {
              const n = diffFrom ?? current.n;
              const v = versions.find((x) => x.n === n)!;
              const prev = versions.find((x) => x.n === n - 1);
              return (
                <>
                  <h2 className="text-[16px] font-semibold">{prev ? `Changes from v${prev.n} to v${v.n}` : `v${v.n}, as submitted`}</h2>
                  {v.intentCheck && (
                    <div className="mt-1.5">
                      <IntentLine check={v.intentCheck} />
                    </div>
                  )}
                  <div className="mt-3">{prev ? <DiffView before={prev.text} after={v.text} /> : <p className="whitespace-pre-wrap text-[14px] leading-[26px]">{v.text}</p>}</div>
                  {prev && prev.image?.alt !== v.image?.alt && <p className="mt-3 text-[13px] text-muted">Alt text changed to “{v.image?.alt}”.</p>}
                  {prev && (prev.image?.blob ?? prev.image?.dataUrl) !== (v.image?.blob ?? v.image?.dataUrl) && <p className="mt-3 text-[13px] text-muted">The creative was replaced.</p>}
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
      </TabPanel>
      <FixConflict
        plan={resolving}
        findings={staged}
        text={current.text}
        submissionId={id}
        onClose={() => setResolving(null)}
        onApply={async (choices) => {
          setBusy("Applying fixes and re-checking…");
          try {
            await applyStagedFixes(id, choices);
            if (resolving) saidApplied(resolving);
          } finally {
            setBusy(null);
          }
        }}
      />
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
        Contrast is measured on the original pixels of each line the OCR finds (the <Term id="wcag">WCAG</Term> rule); palette distance uses <Term id="delta-e">ΔE</Term> 2000.
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
  // Posting twice in a hurry posts once: the second press finds the first still running, and the
  // box has emptied by the time it could land.
  const post = useAction(
    async () => {
      const said = text.trim();
      if (!said) return;
      await addComment(submissionId, role, said);
      setText("");
    },
    { errorPrefix: "Could not post the comment", toastError: false },
  );
  return (
    <div className="mt-5 grid max-w-[980px] gap-6 lg:grid-cols-2">
      <section aria-labelledby="dc-h">
        <h2 id="dc-h" className="text-[16px] font-semibold">
          On the draft
        </h2>
        <ul className="mt-3 space-y-2">
          {comments.length === 0 && <li className="list-none"><Empty title="No comments on the draft yet." /></li>}
          {comments.map((c) => (
            <li key={c.id} className="rounded-[12px] bg-raised px-3.5 py-2.5 text-[14px] leading-[22px]">
              <span className="font-medium">{c.author}</span> <span className="text-[12px] text-muted">· {fmtTime(c.at)}</span>
              <p>{c.text}</p>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void post.run();
          }}
        >
          <label htmlFor="new-comment" className="text-[13px] font-medium">
            Comment as {ROLE_LABEL[role]}
          </label>
          <textarea id="new-comment" className="field" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary btn-sm" type="submit" disabled={!text.trim() || post.busy}>
            Post
          </button>
          {post.error && (
            <p role="alert" className="text-[13px] text-neg-ink">
              {post.error}
            </p>
          )}
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
