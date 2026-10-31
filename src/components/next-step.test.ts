import { describe, expect, it } from "vitest";
import { nextStep, type NextStepInput } from "./next-step";

const base: NextStepInput = {
  status: "checked",
  role: "creator",
  hasCheck: true,
  aiRunning: false,
  staged: 0,
  rework: 0,
  openHigh: 0,
  open: 0,
  withCompliance: 0,
  contestedClaims: 0,
  version: 1,
};
const at = (patch: Partial<NextStepInput>) => nextStep({ ...base, ...patch });

describe("The next-step line under a draft", () => {
  it("says who moves next, and 'you' only to the person it is for", () => {
    expect(at({}).text).toBe("You submit v1 for review.");
    expect(at({}).yours).toBe(true);
    expect(at({ role: "reviewer" }).text).toBe("The creator submits v1 for review.");
    expect(at({ role: "reviewer" }).yours).toBe(false);
    expect(at({ role: "reviewer" }).who).toBe("creator");
  });

  it("starts with the check when the version has none, whoever is looking", () => {
    expect(at({ hasCheck: false }).text).toMatch(/^You run the check on v1, which has none yet\./);
    expect(at({ hasCheck: false, role: "compliance" }).text).toMatch(/^The creator runs the check on v1/);
  });

  it("waits for the AI before anything else", () => {
    const step = at({ aiRunning: true, openHigh: 2, staged: 1 });
    expect(step.who).toBe("assay");
    expect(step.yours).toBe(false);
    expect(step.text).toMatch(/still reading/);
  });

  it("puts claims Compliance sent back first, then accepted fixes, then high-severity findings", () => {
    expect(at({ rework: 2, staged: 3, openHigh: 1 }).text).toBe("You edit the draft to answer 2 claims Compliance sent back, then submit it again.");
    expect(at({ staged: 3, openHigh: 1 }).text).toBe("You apply 3 accepted fixes as v2; Assay re-checks only what changed.");
    expect(at({ staged: 1, version: 4 }).text).toBe("You apply 1 accepted fix as v5; Assay re-checks only what changed.");
    expect(at({ openHigh: 1 }).text).toBe("You fix the 1 high-severity finding still open, or send it to Compliance, before the draft can be submitted.");
  });

  it("tells the creator what a submission will set off", () => {
    expect(at({ contestedClaims: 2, open: 2 }).text).toBe("You submit v1 for review. 2 contested claims then go to Compliance before the reviewer. 2 findings are still open; the reviewer will want a reason for each.");
    expect(at({ contestedClaims: 1 }).text).toContain("1 contested claim then goes to Compliance");
  });

  it("hands an in-review draft to Compliance while claims are waiting, then to the reviewer", () => {
    const waiting = at({ status: "in_review", withCompliance: 2, role: "compliance" });
    expect(waiting.who).toBe("compliance");
    expect(waiting.yours).toBe(true);
    expect(waiting.text).toBe("You decide 2 claims first. Then the reviewer can approve or request changes.");
    expect(at({ status: "in_review", withCompliance: 1, role: "reviewer" }).text).toBe("Compliance decides 1 claim first. Then you can approve or request changes.");

    const clean = at({ status: "in_review", role: "reviewer" });
    expect(clean.who).toBe("reviewer");
    expect(clean.text).toBe("You approve, which writes the Hallmark, or request changes.");
    expect(at({ status: "in_review", role: "creator" }).text).toBe("The reviewer approves, which writes the Hallmark, or requests changes.");
    expect(at({ status: "in_review", role: "reviewer", open: 3 }).text).toBe("You approve with a reason, because 3 findings are still open, or request changes.");
  });

  it("has nothing left for an approved draft", () => {
    const done = at({ status: "approved", role: "reviewer" });
    expect(done.yours).toBe(false);
    expect(done.text).toMatch(/^Nothing more is needed\./);
  });

  it("treats changes requested like a draft the creator still owns", () => {
    expect(at({ status: "changes_requested", rework: 1 }).text).toBe("You edit the draft to answer 1 claim Compliance sent back, then submit it again.");
    expect(at({ status: "changes_requested" }).text).toBe("You submit v1 for review.");
  });
});
