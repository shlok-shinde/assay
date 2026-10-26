// Runs one typed AI task: validate, cap, redact, call Gemini, validate the
// output, map offsets back. Content is never logged.
import { z } from "zod";
import { INPUT_CAP, TASKS, textLength, type AiRouteResponse, type TaskName } from "@/lib/ai-tasks";
import { redact, toOriginal, type Redaction } from "@/engine/redact";
import { callGemini, type GeminiOptions } from "./gemini";
import type { KeyPool } from "./keys";
import { SYSTEM } from "./prompts";

function geminiSchema(schema: z.ZodType): object {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) if (k !== "$schema" && k !== "additionalProperties") out[k] = strip(x);
      return out;
    }
    return v;
  };
  return strip(json) as object;
}

/** Redacts every string inside a value. Returns the count of redactions. */
function redactDeep<T>(value: T): { value: T; count: number } {
  let count = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = redact(v);
      count += r.redactions.length;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, count };
}

export async function runTask(task: string, rawInput: unknown, pool: KeyPool, opts: GeminiOptions = {}): Promise<AiRouteResponse<unknown>> {
  if (!(task in TASKS)) return { ok: false, reason: "bad_request", message: "Unknown task" };
  const spec = TASKS[task as TaskName];
  const parsed = spec.input.safeParse(rawInput);
  if (!parsed.success) return { ok: false, reason: "bad_request", message: "Input does not match the task schema" };
  if (textLength(parsed.data) > INPUT_CAP) return { ok: false, reason: "too_large", message: `Input is over ${INPUT_CAP} characters` };
  const t0 = Date.now();

  // Server-side redaction, as a second line behind the browser's.
  let input: unknown = parsed.data;
  let redactions = 0;
  const segmentMaps = new Map<string, Redaction[]>();
  if (task === "judge") {
    const d = parsed.data as z.infer<typeof TASKS.judge.input>;
    const segments = d.segments.map((s) => {
      const r = redact(s.text);
      redactions += r.redactions.length;
      segmentMaps.set(s.id, r.redactions);
      return { ...s, text: r.text };
    });
    const rest = redactDeep({ ...d, segments: [] });
    redactions += rest.count;
    input = { ...rest.value, segments };
  } else {
    const r = redactDeep(parsed.data);
    input = r.value;
    redactions = r.count;
  }

  const result = await callGemini(
    pool,
    { system: SYSTEM[task as TaskName], user: JSON.stringify(input), schema: geminiSchema(spec.output), tier: spec.tier },
    opts,
  );
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  const out = spec.output.safeParse(result.json);
  if (!out.success) return { ok: false, reason: "error", message: "The AI answer did not match the expected shape" };

  let data: unknown = out.data;
  if (task === "judge") {
    const d = out.data as z.infer<typeof TASKS.judge.output>;
    data = {
      ...d,
      findings: d.findings.flatMap((f) => {
        const map = segmentMaps.get(f.segment) ?? [];
        const start = toOriginal(f.start, map);
        const end = toOriginal(f.end, map);
        return start === null || end === null ? [] : [{ ...f, start, end }];
      }),
    };
  }
  return { ok: true, data, model: result.model, ms: Date.now() - t0, redactions };
}
