import { describe, expect, it } from "vitest";
import { VELVRA_KIT } from "@/seed/velvra";
import { SAMPLES } from "@/seed/samples";
import { runCheck, type AiClient, type CacheStore, type CheckInput, type JudgeRequest, type SegmentCache } from "./pipeline";
import { factAlerts, repeatPatterns, ruleHealth, unclearScore } from "./health";
import type { Finding, Submission } from "@/lib/types";

const memoryCache = (): CacheStore & { size: () => number } => {
  const m = new Map<string, { data: SegmentCache; model: string; at: string }>();
  return {
    get: async (k) => m.get(k),
    set: async (k, data, model) => void m.set(k, { data, model, at: "2026-10-26" }),
    size: () => m.size,
  };
};

const base = (over: Partial<CheckInput> = {}): CheckInput => ({
  text: SAMPLES[0].text,
  channel: "instagram",
  audience: "Women 22–35",
  intent: { ...SAMPLES[0].intent, confirmed: true, draftedBy: "creator" },
  kit: VELVRA_KIT,
  rulebookVersion: "3.2",
  confidential: false,
  today: "2026-10-26",
  ai: null,
  cache: null,
  ...over,
});

const fakeAi = (calls: JudgeRequest[]): AiClient => ({
  async judge(req) {
    calls.push(req);
    const seg = req.segments[0];
    const at = seg.text.indexOf("OMG");
    return {
      ok: true,
      model: "fake-model",
      ms: 5,
      redactions: 0,
      data: {
        findings: [
          { segment: seg.id, rule_id: "VOICE-02", quote: "OMG", start: at, end: at + 3, reason: "Hype.", fix: "Meet", confidence: 0.86 },
          { segment: seg.id, rule_id: "VOICE-01", quote: "made-up quote", start: 0, end: 5, reason: "x", confidence: 0.9 },
          { segment: seg.id, rule_id: "MSG-01", quote: "Shop now", start: 0, end: 8, reason: "No pillar.", confidence: 0.7 },
        ],
        factChoices: [],
      },
    };
  },
});

describe("check pipeline", () => {
  it("with deferAi, returns the rule checks without calling the AI, then the AI pass adds its findings", async () => {
    const calls: JudgeRequest[] = [];
    const cache = memoryCache();
    const first = await runCheck(base({ ai: fakeAi(calls), cache, deferAi: true }));
    expect(calls).toHaveLength(0);
    expect(first.aiPending).toBe(true);
    expect(first.mode).toBe("rules+ai");
    expect(first.banner).toBeUndefined();
    const second = await runCheck(base({ ai: fakeAi(calls), cache }));
    expect(calls).toHaveLength(1);
    expect(second.aiPending).toBe(false);
    expect(second.findings.length).toBeGreaterThan(first.findings.length - 1);
    // Once cached, a deferred check has nothing left for the AI.
    expect((await runCheck(base({ ai: fakeAi(calls), cache, deferAi: true }))).aiPending).toBe(false);
  });

  it("runs rule checks only without an AI client, and says so", async () => {
    const out = await runCheck(base());
    expect(out.mode).toBe("rules-only");
    expect(out.banner).toContain("rule checks only");
    expect(out.findings).toHaveLength(4);
    expect(out.aiCalls).toBe(0);
  });

  it("merges verified AI findings, drops invented ones, and relocates bad offsets", async () => {
    const calls: JudgeRequest[] = [];
    const out = await runCheck(base({ ai: fakeAi(calls), cache: memoryCache() }));
    expect(out.mode).toBe("rules+ai");
    expect(out.aiCalls).toBe(1);
    expect(out.dropped).toHaveLength(1);
    expect(out.relocated).toBe(1);
    const voice = out.findings.find((f) => f.ruleId === "VOICE-02")!;
    expect(voice.confidence).toBe(0.86);
    expect(out.findings.some((f) => f.ruleId === "MSG-01" && f.origin === "ai")).toBe(true);
    expect(calls[0].rules.map((r) => r.id)).toEqual(["VOICE-01", "VOICE-02", "VOICE-03", "MSG-01", "MSG-02"]);
  });

  it("re-uses cached paragraphs and only sends what changed", async () => {
    const calls: JudgeRequest[] = [];
    const cache = memoryCache();
    const text = `${SAMPLES[0].text}\n\nSecond paragraph about daily protection.`;
    await runCheck(base({ text, ai: fakeAi(calls), cache }));
    const again = await runCheck(base({ text: text.replace("daily protection", "daily care"), ai: fakeAi(calls), cache }));
    expect(calls[1].segments).toHaveLength(1);
    expect(again.segmentsReused).toBe(1);
    const third = await runCheck(base({ text: text.replace("daily protection", "daily care"), ai: fakeAi(calls), cache }));
    expect(third.aiCalls).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it("falls back to rule checks with a banner when the AI is rate-limited", async () => {
    const ai: AiClient = { judge: async () => ({ ok: false, reason: "rate_limited", message: "busy" }) };
    const out = await runCheck(base({ ai }));
    expect(out.mode).toBe("rules-only");
    expect(out.banner).toContain("rate limit");
    expect(out.findings).toHaveLength(4);
  });

  it("sends nothing in Confidential mode", async () => {
    const calls: JudgeRequest[] = [];
    const out = await runCheck(base({ ai: fakeAi(calls), confidential: true }));
    expect(calls).toHaveLength(0);
    expect(out.mode).toBe("confidential");
  });

  it("redacts personal data before the AI sees it", async () => {
    const calls: JudgeRequest[] = [];
    await runCheck(base({ text: "OMG write to riya@bloom.in now", ai: fakeAi(calls) }));
    expect(calls[0].segments[0].text).not.toContain("riya@bloom.in");
  });

  it("adds page numbers from PDF page spans", async () => {
    const [p1, p2] = SAMPLES[3].pages!;
    const text = `${p1}\n\n${p2}`;
    const out = await runCheck(base({ text, channel: "brochure", pages: [{ page: 1, start: 0, end: p1.length }, { page: 2, start: p1.length + 2, end: text.length }] }));
    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.findings.every((f) => f.page === 2)).toBe(true);
  });
});

describe("Guideline Health", () => {
  const sub = (id: string, audience: string, status: Submission["status"] = "approved"): Submission => ({
    id, title: id, channel: "instagram", audience, campaign: "c", creator: "x", agency: "Bloom Social", status,
    intent: { goal: "", keyMessage: "", cta: "", confirmed: true, draftedBy: "creator" }, rulebookVersion: "3.2", createdAt: "", updatedAt: "",
  });
  const finding = (id: string, sid: string, ruleId: string, status: Finding["status"]): Finding => ({
    id, checkId: "c", submissionId: sid, versionId: "v", ruleId, relatedRuleIds: [], category: "tone", severity: "medium", origin: "rule",
    start: 0, end: 3, quote: "lowkey insane", title: "", reason: "", status,
    resolution: status === "dismissed" ? { by: "x", role: "creator", reason: "Gen-Z exception", at: "" } : undefined,
  });

  it("weights dismissals and contests most", () => {
    expect(unclearScore(10, 5, 0, 0, 0)).toBe(18);
    expect(unclearScore(10, 5, 5, 0, 0)).toBe(35);
    expect(unclearScore(0, 0, 0, 0, 0)).toBe(0);
  });

  it("flags a rule dismissed mostly for one audience and suggests a scoped exception", () => {
    const subs = [1, 2, 3, 4, 5].map((i) => sub(`s${i}`, i < 5 ? "Gen Z, 18–24" : "Women 22–35"));
    const fs = subs.map((s, i) => finding(`f${i}`, s.id, "VOICE-02", i < 4 ? "dismissed" : "accepted"));
    const h = ruleHealth(VELVRA_KIT, fs, subs).find((x) => x.rule.id === "VOICE-02")!;
    expect(h.unclear).toBe(true);
    expect(h.topAudience).toEqual({ audience: "Gen Z, 18–24", share: 1 });
    expect(h.suggestion).toContain("Gen Z, 18–24");
    expect(repeatPatterns(fs, subs)[0]).toMatchObject({ ruleId: "VOICE-02", count: 5 });
  });

  it("lists facts expiring within 30 days and expired facts", () => {
    const alerts = factAlerts(VELVRA_KIT.facts, "2026-10-26");
    expect(alerts.map((a) => a.fact.id)).toEqual(["F-115", "F-107"]);
    expect(alerts[1].daysLeft).toBe(25);
  });
});
