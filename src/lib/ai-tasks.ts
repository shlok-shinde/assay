// The only AI tasks the server accepts. Each one has a typed input and a
// typed output, validated with zod on both sides of the Gemini call. The
// route is not an open prompt proxy.
import { z } from "zod";

const str = (max: number) => z.string().max(max);
const channel = z.enum(["instagram", "email", "website", "linkedin", "brochure"]);
const ruleIn = z.object({ id: str(20), title: str(120), text: str(600), dos: z.array(str(300)).max(6), donts: z.array(str(300)).max(6) });
const intentIn = z.object({ goal: str(200), keyMessage: str(300), cta: str(200) });

export const judgeInput = z.object({
  channel,
  audience: str(120),
  intent: intentIn,
  rules: z.array(ruleIn).max(20),
  segments: z.array(z.object({ id: str(10), text: str(8000) })).min(1).max(40),
  claims: z
    .array(z.object({ key: str(800), text: str(800), candidates: z.array(z.object({ id: str(20), statement: str(400) })).max(5) }))
    .max(20),
});

export const judgeOutput = z.object({
  findings: z
    .array(
      z.object({
        segment: str(10),
        rule_id: str(20),
        quote: str(600),
        start: z.number().int().min(0),
        end: z.number().int().min(0),
        reason: str(600),
        fix: str(600).optional().default(""),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(30),
  factChoices: z.array(z.object({ key: str(800), factId: str(20) })).max(20).optional().default([]),
});

export const matchFactsInput = z.object({ claims: judgeInput.shape.claims });
export const matchFactsOutput = z.object({ factChoices: z.array(z.object({ key: str(800), factId: str(20) })).max(20) });

export const intentCheckInput = z.object({
  before: str(4000),
  after: str(4000),
  intent: intentIn,
  /** The rule each applied fix answers, so a compliance edit is not read as a lost message. */
  changes: z.array(z.object({ rule: str(200), before: str(500), after: str(500) })).max(20).optional(),
});
export const intentCheckOutput = z.object({ kept: z.boolean(), explanation: str(400) });

export const draftIntentInput = z.object({ text: str(6000), channel });
export const draftIntentOutput = z.object({ goal: str(200), keyMessage: str(300), cta: str(200) });

export const draftRulesInput = z.object({ pages: z.array(z.object({ page: z.number().int().min(1), text: str(8000) })).min(1).max(60) });
export const draftRulesOutput = z.object({
  rules: z
    .array(
      z.object({
        title: str(120),
        text: str(600),
        category: z.enum(["tone", "term", "message", "claim", "visual", "accessibility", "legal"]),
        severity: z.enum(["high", "medium", "low"]),
        page: z.number().int().min(1),
        quote: str(600),
      }),
    )
    .max(25),
});

export const clarifyRuleInput = z.object({
  rule: ruleIn,
  examples: z.array(z.object({ quote: str(400), reason: str(300).optional(), status: str(30), audience: str(120), channel: str(20) })).max(6),
});
export const clarifyRuleOutput = z.object({ text: str(600), dos: z.array(str(300)).max(4), donts: z.array(str(300)).max(4), rationale: str(400) });

export const TASKS = {
  judge: { input: judgeInput, output: judgeOutput, tier: "judge" as const },
  matchFacts: { input: matchFactsInput, output: matchFactsOutput, tier: "lite" as const },
  intentCheck: { input: intentCheckInput, output: intentCheckOutput, tier: "lite" as const },
  draftIntent: { input: draftIntentInput, output: draftIntentOutput, tier: "lite" as const },
  draftRules: { input: draftRulesInput, output: draftRulesOutput, tier: "lite" as const },
  clarifyRule: { input: clarifyRuleInput, output: clarifyRuleOutput, tier: "judge" as const },
};

export type TaskName = keyof typeof TASKS;
export type TaskInput<T extends TaskName> = z.infer<(typeof TASKS)[T]["input"]>;
export type TaskOutput<T extends TaskName> = z.infer<(typeof TASKS)[T]["output"]>;

/** Total characters of text in a task input; the route caps this at 8,000. */
export function textLength(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((n, v) => n + textLength(v), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((n: number, v) => n + textLength(v), 0);
  return 0;
}

export const INPUT_CAP = 8000;

export type AiRouteResponse<T> =
  | { ok: true; data: T; model: string; ms: number; redactions: number; attempts?: string }
  | { ok: false; reason: "offline" | "rate_limited" | "timeout" | "error" | "unconfigured" | "bad_request" | "too_large" | "throttled"; message: string; attempts?: string };
