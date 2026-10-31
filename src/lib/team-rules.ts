// What a team server accepts from a browser, row by row. Rule checks run in the browser, so a tampered browser could
// lie about what a draft contains; these rules are what it can't get past: who may move a draft or a finding, who a
// record says did something, and what an approved record may become. Pure, so it is tested without a database.
import { findingMoveProblem, isDeletable, isEditable, submissionMoveProblem } from "./policy";
import type { Finding, FindingStatus, Role, Submission } from "./types";

/** The tables that travel between team members. aiLog, aiCache and meta stay in each browser; blobs have their own route. */
export const SYNCED_TABLES = ["kits", "rulebooks", "submissions", "versions", "checks", "findings", "comments", "approvals", "hallmarks", "audit", "books", "events", "owners", "notifications"] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];
export const isSyncedTable = (t: string): t is SyncedTable => (SYNCED_TABLES as readonly string[]).includes(t);

export const MAX_ROW_BYTES = 1024 * 1024;

export interface Actor {
  role: Role;
  name: string;
}

type Row = Record<string, unknown>;
export type Verdict = { ok: true; data?: Row } | { ok: false; problem: string };

const ok = (data?: Row): Verdict => ({ ok: true, data });
const no = (problem: string): Verdict => ({ ok: false, problem });

/** Moves the store makes as part of a bigger step, rather than as a person's decision on one finding. */
function internalFindingMove(role: Role, from: FindingStatus, to: FindingStatus, submission: Submission["status"]): boolean {
  if (to === "superseded") return from === "open" || from === "reopened" || from === "sent_to_compliance";
  // Submitting routes every claim to Compliance, including ones already fixed or contested.
  if (to === "sent_to_compliance") return (role === "creator" || role === "admin") && (submission === "in_review" || isEditable(submission)) && ["open", "reopened", "contested", "accepted", "edited"].includes(from);
  return false;
}

/** Whether this change stands, with the fields the server fills in itself. `before` is the server's row; `submission` is the draft the row belongs to. */
export function checkChange(tbl: SyncedTable, before: Row | null, after: Row | null, actor: Actor, submission: Submission | null): Verdict {
  const { role, name } = actor;
  if (tbl === "hallmarks") return no("Hallmarks are issued by the server when a reviewer approves.");

  if (!after) {
    if (!before) return ok();
    if (tbl === "findings" && before.status === "open" && (!submission || isEditable(submission.status))) return ok();
    if (["submissions", "versions", "checks", "findings", "comments", "approvals"].includes(tbl)) {
      const status = tbl === "submissions" ? (before.status as Submission["status"]) : submission?.status;
      if ((role === "creator" || role === "admin") && (!status || isDeletable(status))) return ok();
      return no("This draft is with its reviewers or has a Hallmark, so it is kept as a record.");
    }
    return no(`A ${role} cannot delete from ${tbl}.`);
  }

  switch (tbl) {
    case "kits":
    case "rulebooks":
    case "books":
    case "owners": {
      // Saving a fact's alert state and importing are the Brand Admin's; everyone else reads the kit.
      if (role !== "admin") return no(`Only a Brand Admin can change the ${tbl === "rulebooks" ? "rulebook" : "Brand Kit"}.`);
      if (tbl === "rulebooks" && before) return no("A published rulebook version can't be changed. Publish a new one.");
      return ok(tbl === "rulebooks" ? { ...after, publishedBy: name } : undefined);
    }
    case "submissions": {
      const from = before?.status as Submission["status"] | undefined;
      const to = after.status as Submission["status"];
      if (!from) return to === "draft" ? ok({ ...after, creator: name }) : no("A new draft starts as a draft.");
      if (from === "approved") return no("This draft is approved and hallmarked, so it can't change.");
      if (to === "approved") return no("A draft is approved by the Hallmark route, not by editing it.");
      if (from !== to) {
        const problem = submissionMoveProblem(role, from, to);
        if (problem && !(role === "admin" && !submissionMoveProblem("creator", from, to))) return no(problem);
      }
      return ok({ ...after, creator: before?.creator ?? name });
    }
    case "versions": {
      if (before) return ok({ ...after, text: before.text, n: before.n, author: before.author, submissionId: before.submissionId });
      if (submission && !isEditable(submission.status)) return no("This draft is with its reviewers, so it cannot be changed here.");
      return ok({ ...after, author: name });
    }
    case "findings": {
      if (submission?.status === "approved" && before && before.status !== after.status) return no("This draft is approved and hallmarked; its findings can no longer change.");
      if (!before) return ok();
      // The AI pass refreshes wording, but no one downgrades a finding to get past the high-severity lock.
      if (before.severity !== after.severity || before.ruleId !== after.ruleId) return no("A finding's rule and severity can't change.");
      const from = before.status as FindingStatus;
      const to = after.status as FindingStatus;
      if (from === to) return ok();
      const status = submission?.status ?? "draft";
      if (internalFindingMove(role, from, to, status)) return ok();
      const asRole = role === "admin" ? "creator" : role;
      const problem = findingMoveProblem({ role: asRole, from, to, severity: (before as unknown as Finding).severity, submissionStatus: status });
      if (problem) return no(problem);
      const resolution = after.resolution as Row | undefined;
      return ok(resolution ? { ...after, resolution: { ...resolution, by: name, role } } : undefined);
    }
    case "comments":
      if (before) return no("A comment can't be edited.");
      return ok({ ...after, author: name, role });
    case "approvals": {
      if (before) return no("A decision can't be edited.");
      const decision = after.decision;
      if ((decision === "approved" || decision === "changes_requested") && role !== "reviewer" && role !== "admin") return no("Only a reviewer can approve or request changes.");
      if (decision === "claims_approved" && role !== "compliance" && role !== "admin") return no("Only Compliance can approve claims.");
      return ok({ ...after, by: name, role });
    }
    case "audit":
      if (before) return no("The audit log can't be edited.");
      return ok({ ...after, actor: name, role });
    case "events":
      if (before) return no("Fix events are append-only.");
      return ok({ ...after, role });
    default:
      return ok();
  }
}
