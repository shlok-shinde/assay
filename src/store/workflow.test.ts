import { beforeEach, describe, expect, it } from "vitest";
import type { Finding } from "@/lib/types";
import { db } from "./db";
import {
  applyStagedFixes,
  awaitingRework,
  blockers,
  checkVersion,
  clarificationPreview,
  complianceDecision,
  createSubmission,
  getKit,
  hallmarkContent,
  hydrateImage,
  latestRulebook,
  migrateBlobs,
  publishClarification,
  resetDemo,
  resolveFinding,
  reviewerDecision,
  rollbackRulebook,
  saveEditedVersion,
  stagedFixPlan,
  stillOpen,
  submitForReview,
  syncFactAlerts,
  updateKit,
  upsertRule,
} from "./actions";
import { sha256Hex } from "@/engine/hash";

const INTENT = { goal: "Launch", keyMessage: "Daily protection", cta: "Shop now", confirmed: true, draftedBy: "creator" as const };

async function draft(text = "Velvra Daily Shield protects your skin every day.") {
  const id = await createSubmission({ title: "T", channel: "email", audience: "All", campaign: "C", text, source: { kind: "paste" }, intent: INTENT });
  const version = (await db.versions.where("submissionId").equals(id).first())!;
  await db.checks.add({ id: `chk_${id}`, submissionId: id, versionId: version.id, rulebookVersion: "3.2", mode: "rules-only", startedAt: new Date().toISOString(), ms: 1, aiCalls: 0, redactions: 0, segmentsTotal: 1, segmentsReused: 0, dropped: [], relocated: 0, claims: [], findingIds: [] } as never);
  await db.submissions.update(id, { status: "checked" });
  return { id, version };
}

async function finding(submissionId: string, versionId: string, over: Partial<Finding> = {}): Promise<Finding> {
  const f: Finding = { id: `f_${Math.random().toString(36).slice(2)}`, checkId: "c", submissionId, versionId, ruleId: "CLAIM-01", relatedRuleIds: [], category: "claim", severity: "high", origin: "rule", start: 0, end: 4, quote: "Velvra", title: "t", reason: "r", status: "open", ...over };
  await db.findings.add(f);
  return f;
}

beforeEach(async () => {
  await resetDemo();
});

describe("Compliance sends back a claim already fixed in an earlier version", () => {
  async function sentBack() {
    const { id, version } = await draft();
    const f = await finding(id, version.id);
    await resolveFinding(f.id, "accepted", "creator");
    await new Promise((r) => setTimeout(r, 2));
    const v2 = await saveEditedVersion(id, "Read our monsoon notes today.").catch(() => undefined);
    const current = (await db.versions.get(v2!))!;
    await submitForReview(id);
    expect((await db.findings.get(f.id))!.status).toBe("sent_to_compliance");
    await new Promise((r) => setTimeout(r, 2));
    await complianceDecision(f.id, false, "Needs the panel citation");
    return { id, f, current };
  }

  it("holds the draft until a new version exists, then goes back to Compliance", async () => {
    const { id, f, current } = await sentBack();
    expect((await db.submissions.get(id))!.status).toBe("changes_requested");
    const earlier = await db.findings.where("submissionId").equals(id).filter((x) => x.versionId !== current.id).toArray();
    const rework = awaitingRework(earlier, current);
    expect(rework.map((x) => x.id)).toEqual([f.id]);
    expect(blockers([], rework).canSubmit).toBe(false);
    await expect(submitForReview(id)).rejects.toThrow(/Compliance sent back CLAIM-01/);

    // An edit does not erase the rejection, and the claim returns to Compliance on resubmit.
    await saveEditedVersion(id, "Read our new monsoon notes today.");
    expect((await db.findings.get(f.id))!.status).toBe("reopened");
    await submitForReview(id);
    expect((await db.findings.get(f.id))!.status).toBe("sent_to_compliance");
    await expect(reviewerDecision(id, true, "")).rejects.toThrow(/Compliance still has claims/);
  });
});

describe("Contesting a high-severity claim", () => {
  it("does not get past Compliance", async () => {
    const { id, version } = await draft();
    const f = await finding(id, version.id);
    await resolveFinding(f.id, "contested", "creator", { reason: "The rule is wrong" });
    expect(blockers([(await db.findings.get(f.id))!]).canSubmit).toBe(true);
    await submitForReview(id);
    const sent = (await db.findings.get(f.id))!;
    expect(sent.status).toBe("sent_to_compliance");
    expect(sent.contest?.reason).toBe("The rule is wrong");
  });

  it("a contested high-severity non-claim needs the reviewer's reason to approve", async () => {
    const { id, version } = await draft();
    const f = await finding(id, version.id, { category: "term", ruleId: "TERM-05" });
    await resolveFinding(f.id, "contested", "creator", { reason: "Disagree" });
    await submitForReview(id);
    expect(stillOpen([(await db.findings.get(f.id))!])).toHaveLength(1);
    await expect(reviewerDecision(id, true, "")).rejects.toThrow(/still open/);
    const hm = await reviewerDecision(id, true, "", "Legal agreed the wording");
    expect(hm).toBeTruthy();
    const after = (await db.findings.get(f.id))!;
    expect(after.status).toBe("waived");
    expect(after.contest?.reason).toBe("Disagree");
  });

  it("a creator still cannot dismiss one", async () => {
    const { id, version } = await draft();
    const f = await finding(id, version.id);
    await expect(resolveFinding(f.id, "dismissed", "creator", { reason: "no" })).rejects.toThrow(/reviewer or Compliance/);
  });
});

describe("Repeated actions", () => {
  it("a second approval writes no second Hallmark", async () => {
    const { id } = await draft();
    await submitForReview(id);
    await reviewerDecision(id, true, "");
    await expect(reviewerDecision(id, true, "")).rejects.toThrow(/cannot move/);
    expect(await db.hallmarks.where("submissionId").equals(id).count()).toBe(1);
  });

  it("a blank edit is refused", async () => {
    const { id } = await draft();
    await expect(saveEditedVersion(id, "   ")).rejects.toThrow(/some text or a creative/);
    expect(await db.versions.where("submissionId").equals(id).count()).toBe(1);
  });
});

describe("Stored creatives", () => {
  const image = { dataUrl: "data:image/png;base64,AAAA", width: 1, height: 1, alt: "a", fileName: "a.png" };

  it("keeps the file once and restores it for readers", async () => {
    const id = await createSubmission({ title: "T", channel: "email", audience: "All", campaign: "C", text: "x", image, source: { kind: "image" }, intent: INTENT });
    const v = (await db.versions.where("submissionId").equals(id).first())!;
    expect(v.image!.dataUrl).toBe("");
    expect(v.image!.blob).toBe(await sha256Hex(image.dataUrl));
    expect(await db.blobs.count()).toBe(1);
    expect((await hydrateImage(v.image))!.dataUrl).toBe(image.dataUrl);
  });

  it("seals the same content hash for an inline and a moved creative, and the move is repeatable", async () => {
    const id = await createSubmission({ title: "T", channel: "email", audience: "All", campaign: "C", text: "x", source: { kind: "image" }, intent: INTENT });
    const v = (await db.versions.where("submissionId").equals(id).first())!;
    await db.versions.update(v.id, { image });
    const inline = await hallmarkContent((await db.versions.get(v.id))!);
    expect(await migrateBlobs()).toBe(1);
    expect(await migrateBlobs()).toBe(0);
    expect(await hallmarkContent((await db.versions.get(v.id))!)).toBe(inline);
  });
});

describe("Fixes that collide, at the store", () => {
  it("keeps the loser's decision and edit for the next version", async () => {
    const { id, version } = await draft("Read our insane notes today.");
    const base = { category: "tone" as const, severity: "low" as const, ruleId: "VOICE-02" };
    const a = await finding(id, version.id, { ...base, severity: "medium", quote: "insane", start: 9, end: 15, fix: { kind: "replace", replacement: "good", label: "" } });
    const b = await finding(id, version.id, { ...base, ruleId: "VOICE-01", quote: "insane notes", start: 9, end: 21, fix: { kind: "replace", replacement: "useful notes", label: "" } });
    await resolveFinding(a.id, "accepted", "creator");
    await resolveFinding(b.id, "edited", "creator", { editedText: "helpful notes" });
    const plan = await stagedFixPlan(id);
    expect(plan.conflicts).toHaveLength(1);
    await applyStagedFixes(id, { [plan.conflicts[0].id]: { kind: "fix", id: b.id } });
    const after = (await db.findings.get(a.id))!;
    expect(after.status).toBe("accepted");
    expect(after.notApplied).toBeTruthy();
    const versions = await db.versions.where("submissionId").equals(id).sortBy("n");
    expect(versions[1].text).toBe("Read our helpful notes today.");
  });
});

describe("The intent check on a fix", () => {
  it("stores a verdict and needs a reason to accept one that loses the message", async () => {
    const { id, version } = await draft();
    const lost = { kept: false, verdict: "lost" as const, summary: "Intent may be lost" };
    const f = await finding(id, version.id, { category: "tone", severity: "low", ruleId: "VOICE-02", fix: { kind: "replace", replacement: "x", label: "" }, intentCheck: lost });
    await expect(resolveFinding(f.id, "accepted", "creator")).rejects.toThrow(/Give a reason/);
    await resolveFinding(f.id, "accepted", "creator", { intentOverride: "The offer ended, so the CTA has to go" });
    const after = (await db.findings.get(f.id))!;
    expect(after.intentOverride?.reason).toMatch(/offer ended/);
    await resolveFinding(f.id, "open", "creator");
    expect((await db.findings.get(f.id))!.intentOverride).toBeUndefined();
  });

  it("re-checks an edited fix against the words being accepted", async () => {
    const { id, version } = await draft("Daily protection for your skin. Shop now.");
    await db.submissions.update(id, { intent: { goal: "Sell", keyMessage: "Daily protection", cta: "Shop now", confirmed: true, draftedBy: "creator" } });
    const f = await finding(id, version.id, { category: "tone", severity: "low", ruleId: "VOICE-02", quote: "Shop now", start: 32, end: 40, fix: { kind: "replace", replacement: "Shop today", label: "" } });
    await resolveFinding(f.id, "edited", "creator", { editedText: "Goodbye" });
    expect((await db.findings.get(f.id))!.intentCheck?.kept).toBe(false);
  });

  it("gives every fix found by a check its own verdict, and records it as offered", async () => {
    const id = await createSubmission({ title: "T", channel: "instagram", audience: "All", campaign: "C", text: "OMG our sunblock is here. Shop now.", source: { kind: "paste" }, intent: INTENT });
    const v = (await db.versions.where("submissionId").equals(id).first())!;
    await checkVersion(id, v.id);
    const fixes = (await db.findings.where("versionId").equals(v.id).toArray()).filter((f) => f.fix && f.fix.kind !== "manual" && f.start >= 0);
    expect(fixes.length).toBeGreaterThan(0);
    for (const f of fixes) expect(f.intentCheck?.summary).toBeTruthy();
    expect(await db.events.where("kind").equals("offered").count()).toBe(fixes.length);
  });
});

describe("One-click clarification", () => {
  const clarification = { text: "Velvra never hypes, except where a brand lead agrees a youth tone.", dos: ["A"], donts: ["B"], rationale: "Often dismissed on youth posts", draftedBy: "AI draft (test-model)" };

  it("publishes one rule as a new version and leaves pending kit edits out", async () => {
    const kit = await getKit();
    await upsertRule({ ...kit.rules[0], id: "NEW-01", title: "Pending", pending: true });
    await updateKit({ acronyms: ["ZZZ"] }, "unpublished edit");
    const version = await publishClarification("VOICE-02", clarification);
    expect(version).toBe("3.3");
    const rb = await latestRulebook();
    expect(rb.snapshot.rules.find((r) => r.id === "VOICE-02")!.text).toBe(clarification.text);
    expect(rb.snapshot.rules.some((r) => r.id === "NEW-01")).toBe(false);
    expect(rb.snapshot.acronyms).not.toContain("ZZZ");
    expect(rb.clarification?.before.text).toMatch(/never hypes/);
    expect(rb.clarification?.draftedBy).toMatch(/test-model/);
  });

  it("never grows examples past the cap the AI input accepts", async () => {
    await publishClarification("VOICE-02", { ...clarification, dos: ["1", "2", "3", "4", "5", "6", "7"], donts: [] });
    const rule = (await latestRulebook()).snapshot.rules.find((r) => r.id === "VOICE-02")!;
    expect(rule.dos.length).toBeLessThanOrEqual(6);
  });

  it("says what stays pinned and that code patterns won't change", async () => {
    const { id } = await draft();
    const p = await clarificationPreview("VOICE-02", clarification);
    expect(p.pinned.map((s) => s.id)).toContain(id);
    expect(p.codeUnchanged).toBe(true);
    expect(p.version).toBe("3.3");
    expect((await clarificationPreview("VOICE-01", clarification)).codeUnchanged).toBe(false);
  });

  it("rolls back by publishing the old snapshot as a new version", async () => {
    await publishClarification("VOICE-02", clarification);
    const v = await rollbackRulebook("3.2");
    expect(v).toBe("3.4");
    const rb = await latestRulebook();
    expect(rb.rolledBackTo).toBe("3.2");
    expect(rb.snapshot.rules.find((r) => r.id === "VOICE-02")!.text).toMatch(/^Velvra never hypes\. /);
    expect((await db.rulebooks.toArray()).map((r) => r.version).sort()).toEqual(["3.2", "3.3", "3.4"]);
  });
});

describe("Rollback and the draft", () => {
  it("undoes the published change and keeps edits nobody has published", async () => {
    const before = (await getKit()).rules.find((r) => r.id === "VOICE-02")!.text;
    await publishClarification("VOICE-02", { text: "Clarified.", dos: [], donts: [], rationale: "r", draftedBy: "test" });
    const kit = await getKit();
    await upsertRule({ ...kit.rules[0], id: "NEW-01", title: "Pending", pending: true });
    await updateKit({ acronyms: ["ZZZ"] }, "unpublished edit");
    await rollbackRulebook("3.2");
    const after = await getKit();
    expect(after.rules.find((r) => r.id === "VOICE-02")!.text).toBe(before);
    expect(after.rules.some((r) => r.id === "NEW-01")).toBe(true);
    expect(after.acronyms).toContain("ZZZ");
  });
});

describe("Fact-expiry alerts", () => {
  it("raises the tightest threshold crossed, once, addressed to the fact's owner", async () => {
    expect(await syncFactAlerts("2026-10-31")).toBe(2);
    expect(await syncFactAlerts("2026-10-31")).toBe(0);
    const rows = await db.notifications.toArray();
    const offer = rows.find((r) => r.factId === "F-107")!;
    expect(offer.threshold).toBe(30);
    expect(offer.ownerId).toBe("marketing");
    expect((await db.owners.get("marketing"))?.simulated).toBe(true);
    expect(rows.find((r) => r.factId === "F-115")!.threshold).toBe(0);
  });

  it("recovers days nobody opened the app, without sending the thresholds in between", async () => {
    await syncFactAlerts("2026-10-31");
    expect(await syncFactAlerts("2026-11-18")).toBe(1);
    const offers = (await db.notifications.where("factId").equals("F-107").toArray()).map((r) => r.threshold).sort((a, b) => b - a);
    expect(offers).toEqual([30, 7]);
  });

  it("seeds owners with marked demo addresses that never look real", async () => {
    const owners = await db.owners.toArray();
    expect(owners.length).toBeGreaterThan(4);
    for (const o of owners) {
      expect(o.simulated).toBe(true);
      expect(o.email).toMatch(/\.example$/);
    }
  });
});

describe("Brands", () => {
  it("runs the checks from kit data, for a brand with no Velvra in it", async () => {
    const { starterKit } = await import("@/seed/starter");
    const { ruleChecks } = await import("@/engine/rules");
    const kit = starterKit("Northwind");
    expect(JSON.stringify(kit)).not.toMatch(/velvra|daily shield/i);
    const found = ruleChecks("Results guaranteed. Click here.", kit, "email").map((f) => f.ruleId);
    expect(found).toEqual(expect.arrayContaining(["CLAIM-02", "A11Y-02"]));
    expect(found).not.toContain("LEGAL-01");
    // Velvra's disclaimer belongs to Velvra.
    expect(ruleChecks("SPF 50 for everyone.", kit, "email").map((f) => f.ruleId)).not.toContain("LEGAL-01");
  });

  it("still reads Velvra's wording from a snapshot published before the kit carried it", async () => {
    const { ruleChecks } = await import("@/engine/rules");
    const { VELVRA_KIT } = await import("@/seed/velvra");
    const { vocabulary: _v, disclaimer: _d, ...old } = VELVRA_KIT;
    expect(ruleChecks("SPF 50 is back in stock.", old as typeof VELVRA_KIT, "email").map((f) => f.ruleId)).toContain("LEGAL-01");
    expect(ruleChecks("Sun care. #dailyprotection", old as typeof VELVRA_KIT, "instagram").map((f) => f.ruleId)).toEqual(ruleChecks("Sun care. #dailyprotection", VELVRA_KIT, "instagram").map((f) => f.ruleId));
  });
});
