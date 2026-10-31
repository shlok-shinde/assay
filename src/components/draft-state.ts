// What each draft needs, worked out from what is stored: the same inputs the draft's own screen uses for
// its Next sentence and its mark strip, gathered for every draft at once so a register or a queue can say
// who moves next without opening each one. Read-only.
import type { Finding, ImageAsset, Submission } from "@/lib/types";
import { db } from "@/store/db";
import { awaitingRework, blockers, stillOpen } from "@/store/actions";
import { markStateOf, type MarkState } from "./primitives";
import type { NextStepInput } from "./next-step";

export interface DraftRow {
  s: Submission;
  /** The latest version's number. */
  n: number;
  /** The creative's key in the blobs table (or its pixels, on a row that was never moved), when there is one. */
  image?: { blob?: string; dataUrl?: string; width: number; height: number };
  total: number;
  open: number;
  high: number;
  marks: MarkState;
  /** Everything nextStep needs except who is looking. */
  step: Omit<NextStepInput, "role">;
  /** Facts the draft's claims found that Compliance still has to decide. */
  withCompliance: number;
  /** Findings on any version the creator dismissed or contested, each with a reason the reviewer reads. */
  pushedBack: number;
}

const imageKey = (i?: ImageAsset) => (i ? { blob: i.blob, dataUrl: i.dataUrl || undefined, width: i.width, height: i.height } : undefined);

export async function loadDraftRows(): Promise<DraftRow[]> {
  const subs = (await db.submissions.filter((s) => !s.seeded).toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!subs.length) return [];
  const ids = subs.map((s) => s.id);
  const [versions, findings, checks, hallmarks] = await Promise.all([
    db.versions.where("submissionId").anyOf(ids).toArray(),
    db.findings.where("submissionId").anyOf(ids).toArray(),
    db.checks.where("submissionId").anyOf(ids).toArray(),
    db.hallmarks.where("submissionId").anyOf(ids).toArray(),
  ]);
  return subs.map((s) => {
    const vs = versions.filter((v) => v.submissionId === s.id).sort((a, b) => a.n - b.n);
    const current = vs[vs.length - 1];
    const all = findings.filter((f) => f.submissionId === s.id);
    const mine: Finding[] = current ? all.filter((f) => f.versionId === current.id) : [];
    const earlier = current ? all.filter((f) => f.versionId !== current.id && f.status !== "superseded" && f.status !== "open") : [];
    const cks = current ? checks.filter((c) => c.versionId === current.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt)) : [];
    const check = cks[cks.length - 1];
    const { openHigh, staged, rework } = blockers(mine, current ? awaitingRework(earlier, current) : []);
    const open = stillOpen([...mine, ...earlier.filter((f) => f.status === "reopened")]);
    const contestedClaims = open.filter((f) => f.status === "contested" && f.category === "claim").length;
    const withCompliance = [...mine, ...earlier].filter((f) => f.status === "sent_to_compliance").length;
    const openClaims = [...mine, ...earlier].filter((f) => f.category === "claim" && (f.status === "sent_to_compliance" || (f.status === "reopened" && f.resolution?.role === "compliance"))).length;
    const live = mine.filter((f) => f.status === "open" || f.status === "reopened");
    return {
      s,
      n: current?.n ?? 1,
      image: imageKey(current?.image),
      total: mine.length,
      open: live.length,
      high: live.filter((f) => f.severity === "high").length,
      marks: markStateOf(s.status, { hasCheck: !!check, hasFixVersion: vs.length > 1, hasHallmark: hallmarks.some((h) => h.submissionId === s.id), openClaims }),
      withCompliance,
      pushedBack: all.filter((f) => f.status === "dismissed" || f.status === "contested").length,
      step: {
        status: s.status,
        hasCheck: !!check,
        aiRunning: !!check?.aiPending,
        staged: staged.length,
        rework: rework.length,
        openHigh: openHigh.length,
        open: open.length,
        withCompliance,
        contestedClaims,
        version: current?.n ?? 1,
      },
    };
  });
}
