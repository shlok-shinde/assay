// The check pipeline: parse → rule checks → claims → AI judgment → evidence
// verifier → merge and rank. AI results are cached per paragraph and
// rulebook version, so a re-check only sends paragraphs that changed. With
// deferAi the rule checks return at once and the AI runs as a second pass.
import { INPUT_CAP, textLength } from "@/lib/ai-tasks";
import type { Channel, CheckedClaim, DroppedFinding, ImageAsset, IntentCard, KitContent, PageSpan, Rule } from "@/lib/types";
import { buildDocIndex, search } from "./bm25";
import { analyzeClaims, claimCandidates } from "./claims";
import { hashJson } from "./hash";
import { mergeFindings } from "./merge";
import { redact, toOriginal, type Redacted } from "./redact";
import { activeRules, appliesTo, ruleChecks } from "./rules";
import { looksNonEnglish, paragraphs } from "./text";
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
  | { ok: false; reason: "offline" | "rate_limited" | "timeout" | "error" | "unconfigured" | "too_large"; message: string };

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
  /** People the workspace knows about, hidden from the AI along with secrets and contact details. */
  names?: string[];
  /** Use cached AI results but do not call the AI: the caller runs it later and reports aiPending meanwhile. */
  deferAi?: boolean;
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
  /** deferAi was set and some paragraphs still need the AI. */
  aiPending: boolean;
  ms: number;
}

/** What the AI route accepts per call (see judgeInput). */
const MAX_JUDGE_RULES = 20;
const MAX_JUDGE_SEGMENTS = 40;
const MAX_JUDGE_CLAIMS = 20;
/** Calls per pass, on a free tier that allows about 15 a minute. A longer draft continues on the next run; its finished paragraphs are cached. */
const MAX_JUDGE_CALLS = 3;

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** A full imported book has more judgment rules than one call can carry: the ones closest to this draft go, most serious first when nothing matches. */
function rulesForDraft(rules: Rule[], text: string, intent: Pick<IntentCard, "goal" | "keyMessage">): Rule[] {
  if (rules.length <= MAX_JUDGE_RULES) return rules;
  const index = buildDocIndex(rules.map((r) => ({ id: r.id, text: [r.title, r.text, ...r.dos, ...r.donts].join(" ") })));
  const chosen = new Set(search(index, `${text} ${intent.goal} ${intent.keyMessage}`, MAX_JUDGE_RULES).map((x) => x.id));
  for (const r of [...rules].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])) if (chosen.size < MAX_JUDGE_RULES) chosen.add(r.id);
  return rules.filter((r) => chosen.has(r.id));
}

const clipRule = (r: Rule) => ({ id: r.id, title: r.title.slice(0, 120), text: r.text.slice(0, 600), dos: r.dos.slice(0, 6).map((d) => d.slice(0, 300)), donts: r.donts.slice(0, 6).map((d) => d.slice(0, 300)) });

interface JudgeItem {
  s: { text: string };
  i: number;
  redacted: Redacted;
  claims: JudgeRequest["claims"];
}

/** Groups paragraphs into calls the route will take. A paragraph too long for any call stays out, and the banner counts it as unread. */
function judgeBatches(items: JudgeItem[], room: number): JudgeItem[][] {
  const batches: JudgeItem[][] = [];
  let current: JudgeItem[] = [];
  let size = 0;
  let claims = 0;
  for (const item of items) {
    const cost = textLength({ id: `s${item.i}`, text: item.redacted.text }) + textLength(item.claims);
    if (cost > room) continue;
    if (current.length && (size + cost > room || current.length >= MAX_JUDGE_SEGMENTS || claims + item.claims.length > MAX_JUDGE_CLAIMS)) {
      batches.push(current);
      current = [];
      size = 0;
      claims = 0;
    }
    current.push(item);
    size += cost;
    claims += item.claims.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function segmentKey(segment: string, input: CheckInput, rulesHash: string) {
  return hashJson({ v: 1, segment, channel: input.channel, audience: input.audience, intent: [input.intent.goal, input.intent.keyMessage, input.intent.cta], rulesHash });
}

export async function runCheck(input: CheckInput): Promise<CheckOutput> {
  const t0 = performance.now();
  const { text, kit, channel } = input;
  const segments = paragraphs(text);
  const judgmentRules = rulesForDraft(activeRules(kit).filter((r) => r.modes.includes("judgment") && appliesTo(r, channel) && r.id.length <= 20), text, input.intent);
  const rulesHash = await hashJson({ version: input.rulebookVersion, rules: judgmentRules });

  let mode: CheckOutput["mode"] = input.confidential ? "confidential" : input.ai ? "rules+ai" : "rules-only";
  let banner: string | undefined = input.confidential
    ? "Confidential mode is on for this Brand Kit: nothing was sent to an AI service. Rule checks only."
    : input.ai
      ? undefined
      : "AI judgment is not configured on this deployment. Showing rule checks only.";

  const notes: string[] = [];
  const aiFindings: RawFinding[] = [];
  const dropped: DroppedFinding[] = [];
  const factChoices: Record<string, string> = {};
  let relocated = 0;
  let aiCalls = 0;
  let aiModel: string | undefined;
  let redactions = 0;
  let reused = 0;
  let aiPending = false;

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

    if (fresh.length && input.ai && input.deferAi) aiPending = true;
    else if (fresh.length && input.ai) {
      const facts = new Map(kit.facts.map((f) => [f.id, f]));
      const base = {
        channel,
        audience: input.audience.slice(0, 120),
        intent: { goal: input.intent.goal.slice(0, 200), keyMessage: input.intent.keyMessage.slice(0, 300), cta: input.intent.cta.slice(0, 200) },
        rules: judgmentRules.map(clipRule),
      };
      const items: JudgeItem[] = fresh.map(({ s, i }) => ({
        s,
        i,
        redacted: redact(s.text, input.names),
        claims: claimCandidates(s.text, kit)
          .filter((c) => c.text.length <= 800 && c.key.length <= 800)
          .slice(0, 20)
          .map((c) => ({ key: c.key, text: redact(c.text, input.names).text, candidates: c.candidates.slice(0, 5).map((id) => ({ id, statement: (facts.get(id)?.statement ?? "").slice(0, 400) })) })),
      }));
      let read = 0;
      let failed: Exclude<AiOutcome<JudgeResponse>, { ok: true }>["reason"] | undefined;
      for (const batch of judgeBatches(items, INPUT_CAP - textLength(base)).slice(0, MAX_JUDGE_CALLS)) {
        const req: JudgeRequest = { ...base, segments: batch.map((x) => ({ id: `s${x.i}`, text: x.redacted.text })), claims: batch.flatMap((x) => x.claims) };
        redactions += batch.reduce((n, x) => n + x.redacted.redactions.length, 0);
        const res = await input.ai.judge(req);
        aiCalls++;
        if (!res.ok) {
          failed = res.reason;
          break;
        }
        aiModel = res.model;
        redactions += res.redactions;
        for (const fc of res.data.factChoices) factChoices[fc.key] = fc.factId;
        for (const { i, redacted, claims: asked } of batch) {
          const map = redacted.redactions;
          const segFindings: AiFindingIn[] = [];
          for (const f of res.data.findings.filter((x) => x.segment === `s${i}`)) {
            const start = toOriginal(f.start, map);
            const end = toOriginal(f.end, map);
            if (start === null || end === null || /\[(SECRET|EMAIL|CARD|ID|PHONE|NAME)\]/.test(f.quote)) {
              dropped.push({ reason: "Quote overlaps redacted text", ruleId: f.rule_id });
              continue;
            }
            segFindings.push({ ...f, start, end });
          }
          const mine = asked.map((c) => c.key);
          const choices = res.data.factChoices.filter((fc) => mine.includes(fc.key));
          await input.cache?.set(keys[i], { findings: segFindings, factChoices: choices }, res.model);
          collected.push({ segIndex: i, findings: segFindings, model: res.model });
        }
        read += batch.length;
      }
      if (failed && !read) {
        mode = "rules-only";
        banner =
          failed === "rate_limited"
            ? "The AI service is busy (free-tier rate limit). Showing rule checks only; try again in a minute."
            : failed === "timeout"
              ? "The AI service timed out. Showing rule checks only."
              : failed === "unconfigured"
                ? "AI judgment is not configured on this deployment. Showing rule checks only."
                : failed === "too_large"
                  ? "This draft is too long for the AI to read in one pass. Showing rule checks only."
                  : "The AI service is unavailable right now. Showing rule checks only.";
      } else if (read < fresh.length) {
        banner = `The AI read ${read} of ${fresh.length} changed paragraphs${failed ? " before the service stopped answering" : ", the most it reads in one pass"}. The rest had rule checks only; run the AI again to continue.`;
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
    if (visual.ocr === "failed") notes.push("The text in the creative could not be read, so its contrast and wording were not checked. Run the check again.");
  }
  if (looksNonEnglish(text)) notes.push("This draft does not look like it is in English. The rules are written for English, so few or no findings here does not mean it passed.");
  if (notes.length) banner = [banner, ...notes].filter(Boolean).join(" ");

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
    aiPending,
    ms: Math.round(performance.now() - t0),
  };
}
