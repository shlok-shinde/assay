import { describe, expect, it } from "vitest";
import { VELVRA_KIT } from "@/seed/velvra";
import { analyzeClaims } from "./claims";
import { mergeFindings } from "./merge";
import { ruleChecks, segmentHashtag } from "./rules";
import { SAMPLES } from "@/seed/samples";

const TODAY = "2026-10-26";
const check = (text: string, channel: Parameters<typeof ruleChecks>[2]) =>
  mergeFindings([...ruleChecks(text, VELVRA_KIT, channel), ...analyzeClaims(text, VELVRA_KIT, TODAY).findings]);

describe("claims against the ledger", () => {
  it("flags the Round 1 worked example claim against F-112", () => {
    const text = "OMG 😍 our new sunblock is clinically proven to erase dark spots in just 7 days!";
    const { claims, findings } = analyzeClaims(text, VELVRA_KIT, TODAY);
    expect(claims[0]).toMatchObject({ status: "contradicted", factId: "F-112" });
    const f = findings[0];
    expect(f.ruleId).toBe("CLAIM-01");
    expect(f.reason).toContain("4 weeks");
    expect(f.reason).toContain("Clinically proven");
    expect(f.fix?.footnote).toBe("*In-house study, 40 participants, 2025.");
  });

  it("swaps only the wrong figure for an offer", () => {
    const { findings } = analyzeClaims("Take 25% off with code RAIN25.", VELVRA_KIT, TODAY);
    expect(findings[0]).toMatchObject({ factId: "F-107", claimStatus: "contradicted" });
    expect(findings[0].fix?.replacement).toBe("20% off with code RAIN25");
  });

  it("marks a claim outdated when its fact has expired", () => {
    const { claims, findings } = analyzeClaims("It leaves no white cast.", VELVRA_KIT, TODAY);
    expect(claims[0]).toMatchObject({ status: "outdated", factId: "F-115" });
    expect(findings[0].reason).toContain("30 Jun 2025");
  });

  it("supports correct claims and raises nothing", () => {
    const { claims, findings } = analyzeClaims("Orders over ₹499 ship free. Water-resistant for 40 minutes.", VELVRA_KIT, TODAY);
    expect(claims.map((c) => c.status)).toEqual(["supported", "supported"]);
    expect(findings).toHaveLength(0);
  });

  it("flags a supported offer as outdated once its validity date passes", () => {
    const { claims } = analyzeClaims("Take 20% off this monsoon.", VELVRA_KIT, "2026-12-01");
    expect(claims[0].status).toBe("outdated");
  });

  it("asks for a footnote on a supported study claim", () => {
    const { findings } = analyzeClaims("In our 4-week study, 82% saw a visibly more even skin tone.", VELVRA_KIT, TODAY);
    expect(findings[0].ruleId).toBe("CLAIM-05");
  });
});

describe("rule checks", () => {
  it("reproduces the four text findings of the Round 1 worked example", () => {
    const f = check(SAMPLES[0].text, "instagram");
    expect(f.map((x) => x.ruleId)).toEqual(["CLAIM-01", "CLAIM-03", "VOICE-02", "TERM-04"]);
    expect(f[0].relatedRuleIds).toContain("MSG-02");
    expect(f[1].relatedRuleIds).toContain("TERM-03");
    expect(f.filter((x) => x.severity === "high")).toHaveLength(2);
  });

  it("finds the email's offer, expired panel claim, link text and missing disclaimer", () => {
    const f = check(SAMPLES[1].text, "email");
    const ids = f.map((x) => `${x.ruleId}${x.factId ? ":" + x.factId : ""}`);
    expect(ids).toEqual(expect.arrayContaining(["CLAIM-01:F-107", "CLAIM-01:F-115", "A11Y-02", "LEGAL-01"]));
  });

  it("keeps the clean LinkedIn post clean", () => {
    expect(check(SAMPLES[4].text, "linkedin")).toHaveLength(0);
  });

  it("flags banned fairness language as high severity", () => {
    const f = check("A whitening finish for every skin type.", "website");
    expect(f.find((x) => x.ruleId === "TERM-05")?.severity).toBe("high");
  });

  it("flags runs of exclamation marks and lowercase hashtags", () => {
    const f = check("your skin will thank you!!! #sunscreentok", "instagram");
    expect(f.map((x) => x.ruleId)).toEqual(expect.arrayContaining(["VOICE-02", "A11Y-05"]));
    expect(f.find((x) => x.ruleId === "A11Y-05")?.fix?.replacement).toBe("#SunscreenTok");
  });

  it("segments hashtags with a vocabulary", () => {
    expect(segmentHashtag("dailyprotection", new Set(["daily", "protection"]))).toEqual(["daily", "protection"]);
    expect(segmentHashtag("xyzzy", new Set(["daily"]))).toBeNull();
  });

  it("only requires the SPF disclaimer on email and website", () => {
    expect(check("Daily Shield SPF 50 for every day.", "instagram").some((x) => x.ruleId === "LEGAL-01")).toBe(false);
    expect(check("Daily Shield SPF 50 for every day.", "website").some((x) => x.ruleId === "LEGAL-01")).toBe(true);
    expect(check("Daily Shield SPF 50. Reapply every 2 hours.", "website").some((x) => x.ruleId === "LEGAL-01")).toBe(false);
  });

  it("respects inactive rules", () => {
    const kit = { ...VELVRA_KIT, rules: VELVRA_KIT.rules.map((r) => (r.id === "TERM-04" ? { ...r, active: false } : r)) };
    expect(ruleChecks("our new sunblock", kit, "instagram").some((x) => x.ruleId === "TERM-04")).toBe(false);
  });
});
