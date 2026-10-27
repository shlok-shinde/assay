// Gemini over REST (models/{model}:generateContent) with JSON output.
// Order of attempts: every available key on the primary model, then the next
// model in the fallback chain, all inside one time budget. A 429 or 401/403 is
// about the key, so the next key is tried; a 404, 5xx or timeout is about the
// model (retired, overloaded or slow for everyone), so the next model is tried,
// and a slow model is tried last on the following calls.
import type { KeyPool } from "./keys";

// The chain ends on Google's "-latest" aliases, so a renamed or retired model
// degrades to the current Flash model instead of turning AI off. gemini-3.6-flash
// leads the judge chain: on the live free tier it answers in about 2 s, while
// gemini-3.8-flash ran past the 8 s attempt limit on every logged call.
export const DEFAULT_MODELS = {
  judge: ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-flash-latest"],
  lite: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"],
};

export function modelChain(tier: "judge" | "lite", env: Record<string, string | undefined> = process.env): string[] {
  const override = tier === "judge" ? env.GEMINI_MODEL : env.GEMINI_MODEL_LITE;
  const chain = DEFAULT_MODELS[tier];
  return override?.trim() ? [override.trim(), ...chain.filter((m) => m !== override.trim())] : chain;
}

export interface GeminiCall {
  system: string;
  user: string;
  schema?: object;
  tier: "judge" | "lite";
}

/** `attempts` lists each try as model, outcome and seconds (never content or key values), for the call log. */
export type GeminiResult =
  | { ok: true; json: unknown; model: string; keyLabel: string; attempts: string }
  | { ok: false; reason: "unconfigured" | "rate_limited" | "timeout" | "error"; message: string; attempts?: string };

export interface GeminiOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  budgetMs?: number;
  env?: Record<string, string | undefined>;
}

const log = (msg: string) => console.info(`[ai] ${msg}`);

/** One slow attempt must leave time for the fallbacks inside the budget. */
const ATTEMPT_MS = 8_000;
/** Thinking adds seconds per call; these tasks are short classification and rewriting. */
const THINKING = { judge: "low", lite: "minimal" } as const;

/** Parses Gemini's 429 body: retryDelay ("32s") and whether a per-day quota ran out. */
export function parse429(body: unknown): { retryMs?: number; daily: boolean } {
  const details: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string; quotaMetric?: string }[] }[] =
    (body as { error?: { details?: [] } })?.error?.details ?? [];
  let retryMs: number | undefined;
  let daily = false;
  for (const d of details) {
    if (d.retryDelay) {
      const s = parseFloat(d.retryDelay);
      if (Number.isFinite(s)) retryMs = Math.ceil(s * 1000);
    }
    for (const v of d.violations ?? []) if (/per ?day/i.test(`${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`)) daily = true;
  }
  const message = (body as { error?: { message?: string } })?.error?.message ?? "";
  if (/per day|daily/i.test(message)) daily = true;
  return { retryMs, daily };
}

export async function callGemini(pool: KeyPool, call: GeminiCall, opts: GeminiOptions = {}): Promise<GeminiResult> {
  if (pool.size === 0) return { ok: false, reason: "unconfigured", message: "No Gemini keys are configured" };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? opts.env?.GEMINI_BASE_URL ?? process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  let sawRateLimit = false;
  const tries: string[] = [];
  const note = (model: string, what: string, t: number) => tries.push(`${model.replace(/^gemini-/, "")} ${what} ${((Date.now() - t) / 1000).toFixed(1)}s`);
  const attempts = () => tries.join(", ");

  // A model may reject thinkingConfig or responseJsonSchema with a 400. Each 400 moves this key to the
  // next request shape; without the schema field the schema goes in the prompt, and the output is
  // zod-validated either way.
  const shapes = call.schema
    ? [{ schema: true, thinking: true }, { schema: false, thinking: true }, { schema: true, thinking: false }, { schema: false, thinking: false }]
    : [{ schema: false, thinking: true }, { schema: false, thinking: false }];
  const schemaInPrompt = call.schema ? `${call.system}\n\nAnswer with one JSON object that matches this JSON Schema:\n${JSON.stringify(call.schema)}` : call.system;

  const shapeKey = (model: string) => `${model}|${call.schema ? "schema" : "plain"}`;
  for (const model of pool.preferFast(modelChain(call.tier, opts.env))) {
    let shape = pool.learnedShape(shapeKey(model));
    const keys = pool.order(model);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { ok: false, reason: "timeout", message: "AI time budget used up", attempts: attempts() };
      const { schema, thinking } = shapes[shape];
      const body = {
        systemInstruction: { parts: [{ text: schema ? call.system : schemaInPrompt }] },
        contents: [{ role: "user", parts: [{ text: call.user }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          ...(schema ? { responseJsonSchema: call.schema } : {}),
          ...(thinking ? { thinkingConfig: { thinkingLevel: THINKING[call.tier] } } : {}),
        },
      };
      let res: Response;
      const t = Date.now();
      try {
        res = await fetchImpl(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key.value },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(remaining, ATTEMPT_MS)),
        });
      } catch (e) {
        const name = (e as Error).name;
        log(`model=${model} key=${key.label} network-or-timeout ${name}`);
        note(model, name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error", t);
        if (name === "TimeoutError" || name === "AbortError") {
          pool.slow(model);
          break;
        }
        continue;
      }
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null;
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        try {
          const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
          log(`model=${model} key=${key.label} ok`);
          note(model, "ok", t);
          pool.learnShape(shapeKey(model), shape);
          return { ok: true, json, model, keyLabel: key.label, attempts: attempts() };
        } catch {
          log(`model=${model} key=${key.label} unparseable-output`);
          note(model, "unparseable", t);
          continue;
        }
      }
      const errBody = await res.json().catch(() => null);
      // Google's error message names the field it rejected; it never echoes the prompt.
      const why = res.status === 400 ? ` ${String((errBody as { error?: { message?: string } })?.error?.message ?? "").slice(0, 160)}` : "";
      log(`model=${model} key=${key.label} status=${res.status}${why}`);
      note(model, String(res.status), t);
      if (res.status === 429) {
        sawRateLimit = true;
        const limit = parse429(errBody);
        log(`model=${model} key=${key.label} ${limit.daily ? "daily quota" : `retry in ${Math.round((limit.retryMs ?? 60_000) / 1000)} s`}`);
        pool.rateLimited(key.label, limit, model);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        pool.invalid(key.label);
        continue;
      }
      if (res.status >= 500) pool.slow(model);
      if (res.status === 404 || res.status >= 500) break; // retired or overloaded: next model in the chain
      if (res.status === 400 && shape < shapes.length - 1) {
        shape++;
        i--;
        continue;
      }
      if (res.status === 400) break;
    }
  }
  if (Date.now() >= deadline) return { ok: false, reason: "timeout", message: "AI time budget used up", attempts: attempts() };
  return sawRateLimit || modelChain(call.tier, opts.env).every((m) => pool.available(m).length === 0)
    ? { ok: false, reason: "rate_limited", message: "Every Gemini key is rate-limited right now", attempts: attempts() }
    : { ok: false, reason: "error", message: "Gemini did not return a usable answer", attempts: attempts() };
}
