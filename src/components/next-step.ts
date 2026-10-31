// The one sentence under a draft's title that says what happens next and who does it. It is computed
// from what is stored (status, check, findings, claims with Compliance), never from a script, so it
// is wrong only when the state is.
import type { Role, SubmissionStatus } from "@/lib/types";

export interface NextStepInput {
  status: SubmissionStatus;
  /** Who is looking: the sentence says "you" when the next move is theirs. */
  role: Role;
  /** The latest version has a stored check. */
  hasCheck: boolean;
  /** The AI is still reading changed paragraphs. */
  aiRunning: boolean;
  /** Findings accepted or edited whose fixes are waiting to be applied. */
  staged: number;
  /** Claims Compliance sent back that this version does not answer yet. */
  rework: number;
  /** High-severity findings still open on this version. */
  openHigh: number;
  /** Open findings a reviewer must answer for, or the creator may still decide. */
  open: number;
  /** Findings with Compliance, waiting for its decision. */
  withCompliance: number;
  /** Contested claims that go to Compliance when the creator submits. */
  contestedClaims: number;
  /** The number of the version on screen. */
  version: number;
}

export interface NextStep {
  /** Who moves next. "assay" is the app itself (a check or an AI read still running). */
  who: Role | "assay";
  /** The next move is the viewer's. */
  yours: boolean;
  text: string;
}

const NAME: Record<Role | "assay", string> = { creator: "the creator", reviewer: "the reviewer", compliance: "Compliance", admin: "a Brand Admin", assay: "Assay" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function nextStep(i: NextStepInput): NextStep {
  const done = (who: Role | "assay", text: (subject: string) => string): NextStep => {
    const yours = who === i.role;
    return { who, yours, text: text(yours ? "You" : cap(NAME[who])) };
  };
  const them = (who: Role) => (who === i.role ? "you" : NAME[who]);

  if (i.status === "approved") return { who: "assay", yours: false, text: "Nothing more is needed. The Hallmark is written; anyone can check it on the Hallmarks screen." };

  if (i.status === "in_review") {
    if (i.withCompliance) {
      return done("compliance", (s) => `${s} ${i.role === "compliance" ? "decide" : "decides"} ${plural(i.withCompliance, "claim")} first. Then ${them("reviewer")} can approve or request changes.`);
    }
    return done("reviewer", (s) =>
      i.open
        ? `${s} ${i.role === "reviewer" ? "approve" : "approves"} with a reason, because ${plural(i.open, "finding is", "findings are")} still open, or ${i.role === "reviewer" ? "request" : "requests"} changes.`
        : `${s} ${i.role === "reviewer" ? "approve" : "approves"}, which writes the Hallmark, or ${i.role === "reviewer" ? "request" : "requests"} changes.`,
    );
  }

  // The draft is still the creator's: draft, checked or changes requested.
  const v = `v${i.version}`;
  if (!i.hasCheck) return done("creator", (s) => `${s} ${i.role === "creator" ? "run" : "runs"} the check on ${v}, which has none yet. Nothing else can happen until it has run.`);
  if (i.aiRunning) return done("assay", () => "Assay is still reading this version with the AI. Its findings join the list when it answers; then the creator can submit.");
  if (i.rework) {
    return done("creator", (s) => `${s} ${i.role === "creator" ? "edit" : "edits"} the draft to answer ${plural(i.rework, "claim")} Compliance sent back, then ${i.role === "creator" ? "submit" : "submits"} it again.`);
  }
  if (i.staged) {
    return done("creator", (s) => `${s} ${i.role === "creator" ? "apply" : "applies"} ${plural(i.staged, "accepted fix", "accepted fixes")} as v${i.version + 1}; Assay re-checks only what changed.`);
  }
  if (i.openHigh) {
    return done("creator", (s) => `${s} ${i.role === "creator" ? "fix" : "fixes"} the ${plural(i.openHigh, "high-severity finding")} still open, or ${i.role === "creator" ? "send" : "sends"} ${i.openHigh === 1 ? "it" : "them"} to Compliance, before the draft can be submitted.`);
  }
  const claims = i.contestedClaims ? ` ${plural(i.contestedClaims, "contested claim")} then ${i.contestedClaims === 1 ? "goes" : "go"} to Compliance before the reviewer.` : "";
  const left = i.open ? ` ${plural(i.open, "finding is", "findings are")} still open; the reviewer will want a reason for each.` : "";
  return done("creator", (s) => `${s} ${i.role === "creator" ? "submit" : "submits"} ${v} for review.${claims}${left}`);
}
