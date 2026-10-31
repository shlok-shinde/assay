import { describe, expect, it } from "vitest";
import { findingMoveProblem, isEditable, submissionMoveProblem } from "./policy";

const move = (over: Partial<Parameters<typeof findingMoveProblem>[0]>) =>
  findingMoveProblem({ role: "creator", from: "open", to: "accepted", severity: "medium", submissionStatus: "checked", ...over });

describe("finding moves", () => {
  it("lets a creator decide an open finding on an editable draft", () => {
    for (const to of ["accepted", "edited", "dismissed", "contested", "sent_to_compliance"] as const) expect(move({ to })).toBeNull();
  });

  it("keeps the high-severity lock on dismissal", () => {
    expect(move({ to: "dismissed", severity: "high" })).toMatch(/reviewer or Compliance/);
    expect(move({ to: "dismissed", severity: "high", role: "reviewer" })).toBeNull();
    expect(move({ to: "dismissed", severity: "high", role: "compliance" })).toBeNull();
  });

  it("stops a creator changing findings once the draft is with reviewers", () => {
    expect(move({ submissionStatus: "in_review" })).toMatch(/with its reviewers/);
  });

  it("lets a reviewer waive an open or contested finding, and nothing else", () => {
    expect(move({ role: "reviewer", from: "open", to: "waived", submissionStatus: "in_review" })).toBeNull();
    expect(move({ role: "reviewer", from: "contested", to: "waived", submissionStatus: "in_review" })).toBeNull();
    expect(move({ role: "reviewer", from: "sent_to_compliance", to: "compliance_approved", submissionStatus: "in_review" })).toMatch(/cannot move/);
  });

  it("leaves claim decisions to Compliance", () => {
    expect(move({ role: "compliance", from: "sent_to_compliance", to: "compliance_approved", submissionStatus: "in_review" })).toBeNull();
    expect(move({ role: "compliance", from: "sent_to_compliance", to: "reopened", submissionStatus: "in_review" })).toBeNull();
    expect(move({ role: "creator", from: "sent_to_compliance", to: "compliance_approved" })).toMatch(/cannot move/);
  });

  it("freezes everything on an approved draft, and gives a Brand Admin no finding moves", () => {
    expect(move({ role: "reviewer", from: "open", to: "waived", submissionStatus: "approved" })).toMatch(/hallmarked/);
    expect(move({ role: "admin", to: "dismissed" })).toMatch(/cannot move/);
  });
});

describe("submission moves", () => {
  it("runs the normal path and refuses shortcuts", () => {
    expect(submissionMoveProblem("creator", "checked", "in_review")).toBeNull();
    expect(submissionMoveProblem("reviewer", "in_review", "approved")).toBeNull();
    expect(submissionMoveProblem("reviewer", "approved", "approved")).toMatch(/cannot move/);
    expect(submissionMoveProblem("creator", "in_review", "approved")).toMatch(/cannot move/);
    expect(submissionMoveProblem("compliance", "in_review", "approved")).toMatch(/cannot move/);
  });

  it("knows which statuses can still be edited", () => {
    expect(["draft", "checked", "changes_requested", "in_review", "approved"].filter((s) => isEditable(s as never))).toEqual(["draft", "checked", "changes_requested"]);
  });
});
