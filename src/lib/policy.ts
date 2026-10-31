// Who may make which status change. One table, read by the store guards now and by the team
// server later, so the rule cannot differ between the two.
import type { FindingStatus, Role, Severity, SubmissionStatus } from "./types";

type Moves<S extends string> = Partial<Record<Role, Partial<Record<S, readonly S[]>>>>;

const CREATOR_DECIDES = ["accepted", "edited", "dismissed", "contested", "sent_to_compliance"] as const;

const FINDING_MOVES: Moves<FindingStatus> = {
  creator: {
    open: CREATOR_DECIDES,
    reopened: CREATOR_DECIDES,
    accepted: ["open"],
    edited: ["open"],
    dismissed: ["open"],
    contested: ["open"],
    sent_to_compliance: ["open"],
  },
  reviewer: {
    open: ["dismissed", "waived"],
    reopened: ["waived"],
    dismissed: ["reopened"],
    contested: ["reopened", "waived"],
  },
  compliance: {
    open: ["dismissed"],
    sent_to_compliance: ["compliance_approved", "reopened"],
  },
};

const EDITABLE: readonly SubmissionStatus[] = ["draft", "checked", "changes_requested"];

export const isEditable = (status: SubmissionStatus) => EDITABLE.includes(status);

const SUBMISSION_MOVES: Moves<SubmissionStatus> = {
  creator: {
    draft: ["checked", "in_review"],
    checked: ["in_review"],
    changes_requested: ["checked", "in_review"],
  },
  reviewer: {
    in_review: ["approved", "changes_requested"],
  },
  compliance: {
    draft: ["changes_requested"],
    checked: ["changes_requested"],
    in_review: ["changes_requested"],
    changes_requested: ["changes_requested"],
  },
};

export interface FindingMove {
  role: Role;
  from: FindingStatus;
  to: FindingStatus;
  severity: Severity;
  submissionStatus: SubmissionStatus;
}

/** Why this finding change is refused, or null when it is allowed. */
export function findingMoveProblem({ role, from, to, severity, submissionStatus }: FindingMove): string | null {
  if (submissionStatus === "approved") return "This draft is approved and hallmarked; its findings can no longer change.";
  if (to === "dismissed" && severity === "high" && role === "creator") return "High-severity findings need a reviewer or Compliance to dismiss them.";
  if (!FINDING_MOVES[role]?.[from]?.includes(to)) return `A ${role} cannot move a finding from ${from.replace(/_/g, " ")} to ${to.replace(/_/g, " ")}.`;
  if (role === "creator" && !isEditable(submissionStatus)) return "This draft is with its reviewers, so its findings cannot be changed here.";
  return null;
}

/** Why this submission change is refused, or null when it is allowed. */
export function submissionMoveProblem(role: Role, from: SubmissionStatus, to: SubmissionStatus): string | null {
  if (SUBMISSION_MOVES[role]?.[from]?.includes(to)) return null;
  return `A ${role} cannot move a draft from ${from.replace(/_/g, " ")} to ${to.replace(/_/g, " ")}.`;
}

/** A draft with reviewers on it, or a Hallmark sealed on it, is a record: it can't be deleted. */
export const isDeletable = (status: SubmissionStatus) => status === "draft" || status === "checked" || status === "changes_requested";
