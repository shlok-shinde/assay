// The check pipeline: parse → rule checks → claims → AI judgment → evidence
// verifier → merge and rank. AI results are cached per paragraph and
// rulebook version, so a re-check only sends paragraphs that changed.
import type { Channel, CheckedClaim, DroppedFinding, ImageAsset, IntentCard, KitContent, PageSpan } from "@/lib/types";
import { analyzeClaims, claimCandidates, type ClaimCandidate } from "./claims";
import { hashJson } from "./hash";
import { mergeFindings } from "./merge";
import { redact, toOriginal } from "./redact";
import { activeRules, appliesTo, ruleChecks } from "./rules";
import { paragraphs } from "./text";
import type { RawFinding } from "./types";
import { verifyAiFindings, type AiFindingIn } from "./verifier";
import type { VisualReport } from "./visual";

export interface JudgeRequest {
  channel: Channel;
  audience: string;
  intent: Pick<IntentCard, "goal" | "keyMessage" | "cta">;
  rules: { id: string; title: string; text: string; dos: string[]; donts: string[] }[];
  segments: { id: string; text: string }[];
  claims: { key: string; text: string; candidates: { id: string; statement: string }[] }[];
}

export interface JudgeResponse {
  findings: (AiFindingIn & { segment: string })[];
  factChoices: { key: string; factId: string }[];
}

export type AiOutcome<T> =
  | { ok: true; data: T; model: string; ms: number; redactions: number }
  | { ok: false; reason: "offline" | "rate_limited" | "timeout" | "error" | "unconfigured"; message: string };

export interface AiClient {
  judge(req: JudgeRequest): Promise<AiOutcome<JudgeResponse>>;
}

export interface CacheStore {
  get(key: string): Promise<{ data: SegmentCache; model: string; at: string; seeded?: boolean } | undefined>;
  set(key: string, data: SegmentCache, model: string): Promise<void>;
}

/** What the cache keeps per paragraph: AI findings with offsets relative to the paragraph. */
export interface SegmentCache {
  findings: AiFindingIn[];
  factChoices: { key: string; factId: string }[];
}

export interface CheckInput {
  text: string;
  channel: Channel;
  audience: string;
  intent: IntentCard;
  kit: KitContent;
  rulebookVersion: string;
  confidential: boolean;
  today: string;
  pages?: PageSpan[];
  image?: ImageAsset;
  ai: AiClient | null;
  cache: CacheStore | null;
  visual?: (image: ImageAsset, kit: KitContent) => Promise<VisualReport>;
}

export interface CheckOutput {
  findings: RawFinding[];
  claims: CheckedClaim[];
  dropped: DroppedFinding[];
  relocated: number;
  mode: "rules+ai" | "rules-only" | "confidential";
  banner?: string;
  aiCalls: number;
  aiModel?: string;
  redactions: number;
  segmentsTotal: number;
  segmentsReused: number;
  visual?: VisualReport;
  ms: number;
}

export async function segmentKey(segment: string, input: CheckInput, rulesHash: string) {
  return hashJson({ v: 1, segment, channel: input.channel, audience: input.audience, intent: [input.intent.goal, input.intent.keyMessage, input.intent.cta], rulesHash });
}

export async function runCheck(input: CheckInput): Promise<CheckOutput> {
  const t0 = performance.now();
  const { text, kit, channel } = input;
  const segments = paragraphs(text);
  const judgmentRules = activeRules(kit).filter((r) => r.modes.includes("judgment") && appliesTo(r, channel));
  const rulesHash = await hashJson({ version: input.rulebookVersion, rules: judgmentRules });

  let mode: CheckOutput["mode"] = input.confidential ? "confidential" : input.ai ? "rules+ai" : "rules-only";
  let banner: string | undefined = input.confidential
    ? "Confidential mode is on for this Brand Kit: nothing was sent to an AI service. Rule checks only."
    : input.ai
      ? undefined
      : "AI judgment is not configured on this deployment. Showing rule checks only.";

  const aiFindings: RawFinding[] = [];
  const dropped: DroppedFinding[] = [];
  const factChoices: Record<string, string> = {};
  let relocated = 0;
  let aiCalls = 0;
  let aiModel: string | undefined;
  let redactions = 0;
  let reused = 0;

  if (mode === "rules+ai" && judgmentRules.length && segments.length) {
    const keys = await Promise.all(segments.map((s) => segmentKey(s.text, input, rulesHash)));
    const cached = await Promise.all(keys.map((k) => input.cache?.get(k)));
    const fresh = segments.map((s, i) => ({ s, i })).filter(({ i }) => !cached[i]);
    reused = segments.length - fresh.length;

    const collected: { segIndex: number; findings: AiFindingIn[]; model: string; cachedAt?: string }[] = [];
    cached.forEach((c, i) => {
      if (!c) return;
      collected.push({ segIndex: i, findings: c.data.findings, model: c.model, cachedAt: c.at });
      for (const fc of c.data.factChoices) factChoices[fc.key] = fc.factId;
      aiModel ??= c.model;
    });

    if (fresh.length && input.ai) {
      const redacted = fresh.map(({ s }) => redact(s.text));
      redactions = redacted.reduce((n, r) => n + r.redactions.length, 0);
      const candidates: ClaimCandidate[] = fresh.flatMap(({ s }) => claimCandidates(s.text, kit));
      const facts = new Map(kit.facts.map((f) => [f.id, f]));
      const req: JudgeRequest = {
        channel,
        audience: input.audience,
        intent: { goal: input.intent.goal, keyMessage: input.intent.keyMessage, cta: input.intent.cta },
        rules: judgmentRules.map((r) => ({ id: r.id, title: r.title, text: r.text, dos: r.dos, donts: r.donts })),
        segments: redacted.map((r, j) => ({ id: `s${fresh[j].i}`, text: r.text })),
        claims: candidates.map((c) => ({
          key: c.key,
          text: redact(c.text).text,
          candidates: c.candidates.map((id) => ({ id, statement: facts.get(id)?.statement ?? "" })),
        })),
      };
      const res = await input.ai.judge(req);
      aiCalls = 1;
      if (res.ok) {
        aiModel = res.model;
        redactions += res.redactions;
        for (const fc of res.data.factChoices) factChoices[fc.key] = fc.factId;
        for (let j = 0; j < fresh.length; j++) {
          const { s, i } = fresh[j];
          const map = redacted[j].redactions;
          const segFindings: AiFindingIn[] = [];
          for (const f of res.data.findings.filter((x) => x.segment === `s${i}`)) {
            const start = toOriginal(f.start, map);
            const end = toOriginal(f.end, map);
            if (start === null || end === null || /\[(SECRET|EMAIL|CARD|ID|PHONE)\]/.test(f.quote)) {
              dropped.push({ reason: "Quote overlaps redacted text", ruleId: f.rule_id });
              continue;
            }
            segFindings.push({ ...f, start, end });
          }
          const mine = candidates.filter((c) => s.text.includes(c.text)).map((c) => c.key);
          const choices = res.data.factChoices.filter((fc) => mine.includes(fc.key));
          await input.cache?.set(keys[i], { findings: segFindings, factChoices: choices }, res.model);
          collected.push({ segIndex: i, findings: segFindings, model: res.model });
        }
      } else {
        mode = "rules-only";
        banner =
          res.reason === "rate_limited"
            ? "The AI service is busy (free-tier rate limit). Showing rule checks only; try again in a minute."
            : res.reason === "timeout"
              ? "The AI service timed out. Showing rule checks only."
              : res.reason === "unconfigured"
                ? "AI judgment is not configured on this deployment. Showing rule checks only."
                : "The AI service is unavailable right now. Showing rule checks only.";
      }
    }

    for (const c of collected) {
      const seg = segments[c.segIndex];
      const absolute = c.findings.map((f) => ({ ...f, start: f.start + seg.start, end: f.end + seg.start }));
      const v = verifyAiFindings(text, absolute, kit, channel, c.model);
      dropped.push(...v.dropped);
      relocated += v.relocated;
      for (const f of v.kept) aiFindings.push(c.cachedAt ? { ...f, cached: { model: c.model, at: c.cachedAt } } : f);
    }
  }

  const claims = analyzeClaims(text, kit, input.today, factChoices);
  let findings = mergeFindings([...ruleChecks(text, kit, channel), ...claims.findings, ...aiFindings]);

  let visual: VisualReport | undefined;
  if (input.image && input.visual) {
    visual = await input.visual(input.image, kit);
    findings = [...findings, ...visual.findings];
  }

  if (input.pages?.length) {
    findings = findings.map((f) => {
      const p = input.pages!.find((pg) => f.start >= pg.start && f.start < pg.end);
      return p ? { ...f, page: p.page } : f;
    });
  }

  return {
    findings,
    claims: claims.claims,
    dropped,
    relocated,
    mode,
    banner,
    aiCalls,
    aiModel,
    redactions,
    segmentsTotal: segments.length,
    segmentsReused: reused,
    visual,
    ms: Math.round(performance.now() - t0),
  };
}
