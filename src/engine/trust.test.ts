import { describe, expect, it } from "vitest";
import { VELVRA_KIT } from "@/seed/velvra";
import { verifyAiFindings } from "./verifier";
import { redact, toOriginal } from "./redact";
import { applyFixes, applyFixPlan, draftIntent, intentCheck, intentVerdict, planFixes, validateMerge } from "./fix";
import { acceptanceByRule, editShare } from "./health";
import { ruleChecks } from "./rules";
import { contrastRatio, deltaE, hexToRgb, kmeans, nearestPaletteColor } from "./color";
import { canonicalJson, sha256Hex } from "./hash";
import { GENESIS, sealHallmark, verifyHallmark } from "./hallmark";
import type { FixEvent, HallmarkBody } from "@/lib/types";

const TEXT = "OMG 😍 our new sunblock is clinically proven to erase dark spots in just 7 days!";

describe("evidence verifier", () => {
  const base = { reason: "Hype", confidence: 0.86 };
  it("keeps a finding whose quote is at its offsets", () => {
    const v = verifyAiFindings(TEXT, [{ ...base, rule_id: "VOICE-02", quote: "OMG", start: 0, end: 3 }], VELVRA_KIT, "instagram", "m");
    expect(v.kept).toHaveLength(1);
    expect(v.kept[0]).toMatchObject({ origin: "ai", model: "m", confidence: 0.86 });
  });

  it("relocates a unique quote with wrong offsets and counts it", () => {
    const v = verifyAiFindings(TEXT, [{ ...base, rule_id: "VOICE-02", quote: "OMG", start: 10, end: 13 }], VELVRA_KIT, "instagram", "m");
    expect(v.kept[0].start).toBe(0);
    expect(v.relocated).toBe(1);
  });

  it("drops invented quotes, unknown rules and rules checked in code", () => {
    const v = verifyAiFindings(
      TEXT,
      [
        { ...base, rule_id: "VOICE-02", quote: "totally amazing", start: 0, end: 15 },
        { ...base, rule_id: "VOICE-99", quote: "OMG", start: 0, end: 3 },
        { ...base, rule_id: "TERM-04", quote: "sunblock", start: 15, end: 23 },
        { ...base, rule_id: "VOICE-02", quote: "", start: 0, end: 0 },
      ],
      VELVRA_KIT,
      "instagram",
      "m",
    );
    expect(v.kept).toHaveLength(0);
    expect(v.dropped.map((d) => d.reason)).toEqual([
      "Quote does not appear in the draft",
      "Cites a rule that is not in the active rulebook",
      "Cites a rule that is checked in code, not by judgment",
      "Has no quoted evidence",
    ]);
  });

  it("drops an ambiguous quote and softens low confidence to a suggestion", () => {
    const t = "Glow. Glow again.";
    const v = verifyAiFindings(
      t,
      [
        { ...base, rule_id: "VOICE-01", quote: "Glow", start: 3, end: 7 },
        { ...base, rule_id: "VOICE-01", quote: "Glow again", start: 6, end: 16, confidence: 0.3 },
      ],
      VELVRA_KIT,
      "instagram",
      "m",
    );
    expect(v.dropped[0].reason).toContain("more than once");
    expect(v.kept[0]).toMatchObject({ suggestion: true, severity: "low" });
  });
});

describe("redaction", () => {
  it("redacts emails, phones, IDs and secrets and maps offsets back", () => {
    const input = "Mail a@b.co or call +91 98765 43210. PAN ABCDE1234F. Key AIzaSyA1234567890abcdefghijklmnopqrstu. Done.";
    const r = redact(input);
    expect(r.text).toContain("[EMAIL]");
    expect(r.text).toContain("[PHONE]");
    expect(r.text).toContain("[ID]");
    expect(r.text).toContain("[SECRET]");
    expect(r.text).not.toContain("a@b.co");
    const pos = r.text.indexOf("Done");
    expect(input.slice(toOriginal(pos, r.redactions)!, toOriginal(pos + 4, r.redactions)!)).toBe("Done");
    expect(toOriginal(r.text.indexOf("[EMAIL]") + 2, r.redactions)).toBeNull();
  });

  it("leaves prices and product numbers alone", () => {
    expect(redact("₹649 for 50 ml, SPF 50, 82% of 40").redactions).toHaveLength(0);
  });
});

describe("fixes and intent", () => {
  const intent = { goal: "Launch", keyMessage: "Daily sun protection that evens skin tone", cta: "Shop via link in bio", confirmed: true, draftedBy: "creator" as const };
  it("applies several fixes from the end backwards and adds a footnote once", () => {
    const text = "our sunblock is clinically proven. Shop now.";
    const r = applyFixes(text, [
      { id: "a", start: 4, end: 12, fix: { kind: "replace", replacement: "Daily Shield SPF 50", label: "" } },
      { id: "b", start: 16, end: 33, fix: { kind: "replace", replacement: "shown in our study*", footnote: "*Study.", label: "" } },
    ]);
    expect(r.text).toBe("our Daily Shield SPF 50 is shown in our study.* Shop now.\n\n*Study.");
    expect(r.conflicts).toEqual([]);
  });

  it("refuses overlapping fixes and reports the conflict", () => {
    const r = applyFixes("abcdef", [
      { id: "a", start: 0, end: 4, fix: { kind: "replace", replacement: "X", label: "" } },
      { id: "b", start: 2, end: 6, fix: { kind: "replace", replacement: "Y", label: "" } },
    ]);
    expect(r.conflicts).toHaveLength(1);
  });

  it("reports intent kept, strengthened, or lost", () => {
    const before = "Shop now 👉 link in bio. Protection for skin.";
    expect(intentCheck(before, "Shop now 👉 link in bio. Protection that evens skin tone.", intent).kept).toBe(true);
    expect(intentCheck(before, "Protection for skin.", intent).ctaKept).toBe(false);
  });

  it("gives one intent verdict: agreement decides, disagreement asks a person", () => {
    const kept = intentCheck("Shop now 👉 link in bio. Protection for skin.", "Shop now 👉 link in bio. Protection that evens skin tone.", intent);
    const ai = (k: boolean) => ({ kept: k, explanation: "Still about daily protection.", model: "m" });
    expect(intentVerdict(kept).verdict).toBe("kept");
    expect(intentVerdict(kept, ai(true))).toMatchObject({ kept: true, verdict: "kept" });
    const split = intentVerdict(kept, ai(false));
    expect(split).toMatchObject({ kept: false, verdict: "review" });
    expect(split.summary).toMatch(/^Check intent: the key-message terms are intact, but the AI check reads it differently \(Still about daily protection\)$/);
    expect(split.summary).not.toMatch(/Intent kept/);
    const lost = intentCheck("Shop now 👉 link in bio. Protection for skin.", "Protection for skin.", intent);
    expect(intentVerdict(lost, ai(false)).verdict).toBe("lost");
  });

  it("drafts an Intent Card heuristically", () => {
    const d = draftIntent("Meet our new sunscreen for daily protection. Shop now via the link in bio.");
    expect(d.goal).toBe("Launch awareness");
    expect(d.cta).toContain("Shop");
    expect(d.draftedBy).toBe("heuristic");
  });
});

describe("colour", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio(hexToRgb("#000000"), hexToRgb("#FFFFFF"))).toBeCloseTo(21, 0);
    expect(contrastRatio(hexToRgb("#777777"), hexToRgb("#FFFFFF"))).toBeCloseTo(4.48, 1);
  });

  it("finds the nearest palette colour by ΔE2000", () => {
    const n = nearestPaletteColor("#FF5FA2", VELVRA_KIT.palette);
    expect(n.color.name).toBe("Rose Clay");
    expect(n.deltaE).toBeGreaterThan(10);
    expect(deltaE("#C98B7F", "#C98B7F")).toBe(0);
  });

  it("clusters pixels deterministically", () => {
    const px = [...Array(30)].flatMap((_, i) => (i < 20 ? [255, 95, 162, 255] : [31, 27, 36, 255]));
    const c = kmeans(px, 2);
    expect(c[0].share).toBeCloseTo(2 / 3, 2);
    expect(c[0].rgb).toEqual([255, 95, 162]);
  });
});

describe("Hallmark", () => {
  const body = (prevHash: string): HallmarkBody => ({
    submissionId: "s1",
    title: "Post",
    versionId: "v2",
    versionN: 2,
    contentHash: "",
    rulebookVersion: "3.2",
    rulebookHash: "abc",
    findings: [{ id: "f1", ruleId: "VOICE-02", severity: "medium", status: "dismissed", reason: "Gen-Z exception" }],
    approvals: [{ role: "reviewer", by: "Arjun", decision: "approved", at: "2026-10-26T10:00:00Z" }],
    ai: { models: [], calls: 0, redactions: 0, mode: "rules-only" },
    prevHash,
    issuedAt: "2026-10-26T10:00:00Z",
  });

  it("canonicalises key order before hashing", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });

  it("verifies content, body and chain, and detects tampering", async () => {
    const content = "Meet Daily Shield SPF 50.";
    const first = await sealHallmark({ ...body(GENESIS), contentHash: await sha256Hex(content) }, "h1", 1);
    const second = await sealHallmark({ ...body(first.hash), contentHash: await sha256Hex(content) }, "h2", 2);
    expect((await verifyHallmark(first, content)).ok).toBe(true);
    expect((await verifyHallmark(second, content, first)).ok).toBe(true);
    expect((await verifyHallmark(second, content + "!", first)).contentMatches).toBe(false);
    const tampered = { ...second, findings: [] };
    expect((await verifyHallmark(tampered, content, first)).bodyMatches).toBe(false);
    expect((await verifyHallmark(second, content, { ...first, hash: "f".repeat(64) })).chainMatches).toBe(false);
  });
});

describe("fixes that collide", () => {
  const ctx = { kit: VELVRA_KIT, channel: "email" as const, today: "2026-10-26" };
  const f = (id: string, ruleId: string, start: number, end: number, replacement: string, over: object = {}) => ({
    id,
    ruleId,
    start,
    end,
    quote: "",
    severity: "medium" as const,
    category: "tone" as const,
    origin: "rule" as const,
    fix: { kind: "replace" as const, replacement, label: "" },
    ...over,
  });

  it("composes fixes in one sentence and only flags true overlaps", () => {
    const text = "Our sunblock is insane today.";
    const plan = planFixes(text, [f("a", "TERM-04", 4, 12, "Daily Shield SPF 50"), f("b", "VOICE-02", 16, 22, "really good")], ctx);
    expect(plan.conflicts).toEqual([]);
    expect(plan.composed).toHaveLength(1);
    expect(plan.composed[0].ids).toEqual(["a", "b"]);
    expect(applyFixPlan(text, [f("a", "TERM-04", 4, 12, "Daily Shield SPF 50"), f("b", "VOICE-02", 16, 22, "really good")], plan).text).toBe("Our Daily Shield SPF 50 is really good today.");
  });

  it("defaults an overlap to the more serious fix and reports the loser", () => {
    const text = "Results guaranteed forever now.";
    const low = f("low", "VOICE-02", 8, 26, "x", { severity: "low" });
    const high = f("high", "CLAIM-02", 0, 18, "Results that build with daily use", { severity: "high", category: "claim" });
    const plan = planFixes(text, [low, high], ctx);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].defaultId).toBe("high");
    const r = applyFixPlan(text, [low, high], plan);
    expect(r.applied).toEqual(["high"]);
    expect(r.conflicts).toEqual(["low"]);
  });

  it("merges when one fix's words contain the other's, and validates the result", () => {
    const text = "This omg insane sunscreen is here.";
    const outer = f("outer", "VOICE-02", 5, 15, "really good", { quote: "omg insane" });
    const inner = f("inner", "VOICE-02", 9, 15, "good", { quote: "insane" });
    const plan = planFixes(text, [outer, inner], ctx);
    expect(plan.conflicts[0].merged).toBe("really good");
    const r = applyFixPlan(text, [outer, inner], plan, { [plan.conflicts[0].id]: { kind: "text", text: plan.conflicts[0].merged! } });
    expect(r.text).toBe("This really good sunscreen is here.");
    expect(r.applied.sort()).toEqual(["inner", "outer"]);
  });

  it("refuses a merge that adds a number, a banned word or changes approved wording", () => {
    const before = "It is a great sunscreen.";
    const fix = f("a", "CLAIM-01", 6, 11, "shown in our study", { category: "claim", quote: "great" });
    expect(validateMerge(before, "It is a 90% better sunscreen.", [fix], ctx).ok).toBe(false);
    expect(validateMerge(before, "It is a whitening sunscreen.", [fix], ctx).problems.join()).toMatch(/TERM-05/);
    expect(validateMerge(before, "It is shown in a study sunscreen.", [fix], ctx).problems.join()).toMatch(/approved wording/);
  });

  it("a deletion at a sentence start leaves the next word free for its own fix", () => {
    const text = "OMG insane results here.";
    const findings = ruleChecks(text, VELVRA_KIT, "instagram").filter((x) => x.ruleId === "VOICE-02");
    expect(findings).toHaveLength(2);
    const fixes = findings.map((x, i) => ({ id: String(i), start: x.start, end: x.end, fix: x.fix, ruleId: x.ruleId, quote: x.quote, severity: x.severity, category: x.category, origin: x.origin }));
    const plan = planFixes(text, fixes);
    expect(plan.conflicts).toEqual([]);
    expect(applyFixPlan(text, fixes, plan).text).toBe("Really good results here.");
  });

  it("says plainly when an Intent Card gave it nothing to check", () => {
    const blank = { goal: "", keyMessage: "", cta: "", confirmed: true, draftedBy: "creator" as const };
    const h = intentCheck("Before.", "After.", blank);
    expect(h.checked).toBe(false);
    const v = intentVerdict(h);
    expect(v.verdict).toBe("unchecked");
    expect(v.summary).not.toMatch(/Intent kept/);
  });
});

describe("fix acceptance", () => {
  const ev = (findingId: string, kind: FixEvent["kind"], at: number, over: Partial<FixEvent> = {}): FixEvent => ({ id: `${findingId}${at}`, at: new Date(at * 1000).toISOString(), kind, ruleId: "TERM-04", findingId, submissionId: "s", role: "creator", ...over });

  it("counts accepted and lightly edited over decided, with the last event winning", () => {
    const [row] = acceptanceByRule([
      ev("a", "offered", 1), ev("a", "accepted", 2),
      ev("b", "offered", 1), ev("b", "edited", 2, { editShare: 0.2 }),
      ev("c", "offered", 1), ev("c", "edited", 2, { editShare: 0.6 }),
      ev("d", "offered", 1), ev("d", "dismissed", 2),
      ev("e", "offered", 1), ev("e", "accepted", 2), ev("e", "undone", 3),
      ev("f", "offered", 1),
    ]);
    expect(row).toMatchObject({ ruleId: "TERM-04", offered: 6, decided: 4, accepted: 2, rate: 0.5 });
  });

  it("leaves out automated runs, and has no rate before a decision", () => {
    expect(acceptanceByRule([ev("a", "accepted", 1, { automated: true })])).toEqual([]);
    expect(acceptanceByRule([ev("a", "offered", 1)])[0].rate).toBeNull();
  });

  it("measures how much of a suggestion was edited", () => {
    expect(editShare("even tone", "even tone")).toBe(0);
    expect(editShare("abcd", "abcf")).toBe(0.25);
    expect(editShare("", "x")).toBe(1);
  });
});

describe("the sample whose fixes collide", () => {
  const ctx = { kit: VELVRA_KIT, channel: "instagram" as const, today: "2026-10-26" };
  const text = "OMG 😍🔥💧🌞 our new Daily Shield is here. Shop now via the link in bio";
  const fixes = ruleChecks(text, VELVRA_KIT, "instagram")
    .filter((f) => f.fix && f.fix.kind === "replace")
    .map((f, i) => ({ id: String(i), start: f.start, end: f.end, fix: f.fix, ruleId: f.ruleId, quote: f.quote, severity: f.severity, category: f.category, origin: f.origin, factId: f.factId }));

  it("collides, and the merge reads the same as the winning fix", () => {
    const plan = planFixes(text, fixes, ctx);
    expect(plan.conflicts).toHaveLength(1);
    const c = plan.conflicts[0];
    expect(c.merged).toBe("");
    const merged = applyFixPlan(text, fixes, plan, { [c.id]: { kind: "text", text: c.merged! } }).text;
    expect(merged).toBe("Our new Daily Shield is here. Shop now via the link in bio");
    expect(applyFixPlan(text, fixes, plan).text).toBe(merged);
  });
});
