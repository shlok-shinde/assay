// Gemini over REST (models/{model}:generateContent) with JSON output.
// Order of attempts: every available key on the primary model, then the next
// model in the fallback chain, all inside one time budget.
import type { KeyPool } from "./keys";

export const DEFAULT_MODELS = {
  judge: ["gemini-3.8-flash", "gemini-3.6-flash"],
  lite: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
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

export type GeminiResult =
  | { ok: true; json: unknown; model: string; keyLabel: string }
  | { ok: false; reason: "unconfigured" | "rate_limited" | "timeout" | "error"; message: string };

export interface GeminiOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  budgetMs?: number;
  env?: Record<string, string | undefined>;
}

const log = (msg: string) => console.info(`[ai] ${msg}`);

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

  for (const model of modelChain(call.tier, opts.env)) {
    let useSchema = !!call.schema;
    const keys = pool.order();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { ok: false, reason: "timeout", message: "AI time budget used up" };
      const body = {
        systemInstruction: { parts: [{ text: call.system }] },
        contents: [{ role: "user", parts: [{ text: call.user }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          ...(useSchema ? { responseJsonSchema: call.schema } : {}),
        },
      };
      let res: Response;
      try {
        res = await fetchImpl(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key.value },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(remaining, 15_000)),
        });
      } catch (e) {
        log(`model=${model} key=${key.label} network-or-timeout ${(e as Error).name}`);
        continue;
      }
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null;
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        try {
          const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
          log(`model=${model} key=${key.label} ok`);
          return { ok: true, json, model, keyLabel: key.label };
        } catch {
          log(`model=${model} key=${key.label} unparseable-output`);
          continue;
        }
      }
      const errBody = await res.json().catch(() => null);
      log(`model=${model} key=${key.label} status=${res.status}`);
      if (res.status === 429) {
        sawRateLimit = true;
        pool.rateLimited(key.label, parse429(errBody));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        pool.invalid(key.label);
        continue;
      }
      if (res.status === 404) break; // model not available: next model in the chain
      if (res.status === 400 && useSchema) {
        // Older models reject responseJsonSchema: retry this key once without it (output is still zod-validated).
        useSchema = false;
        i--;
        continue;
      }
      if (res.status === 400) break;
    }
  }
  if (Date.now() >= deadline) return { ok: false, reason: "timeout", message: "AI time budget used up" };
  return sawRateLimit || pool.available().length === 0
    ? { ok: false, reason: "rate_limited", message: "Every Gemini key is rate-limited right now" }
    : { ok: false, reason: "error", message: "Gemini did not return a usable answer" };
}
