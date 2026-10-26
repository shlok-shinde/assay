import { describe, expect, it } from "vitest";
import { VELVRA_KIT } from "@/seed/velvra";
import { verifyAiFindings } from "./verifier";
import { redact, toOriginal } from "./redact";
import { applyFixes, draftIntent, intentCheck } from "./fix";
import { contrastRatio, deltaE, hexToRgb, kmeans, nearestPaletteColor } from "./color";
import { canonicalJson, sha256Hex } from "./hash";
import { GENESIS, sealHallmark, verifyHallmark } from "./hallmark";
import type { HallmarkBody } from "@/lib/types";

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
