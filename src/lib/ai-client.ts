// Browser side of the AI: calls the typed /api/ai route and records each call
// in the AI call log (task, model, outcome, timing, redaction count; never content).
import type { AiRouteResponse, TaskInput, TaskName, TaskOutput } from "./ai-tasks";
import type { AiClient } from "@/engine/pipeline";
import { db, nowIso, uid } from "@/store/db";

export interface AiStatus {
  aiConfigured: boolean;
  keyCount: number;
  keysAvailable: number;
  models: { judge: string[]; lite: string[] };
}

let statusPromise: Promise<AiStatus | null> | null = null;

export function aiStatus(refresh = false): Promise<AiStatus | null> {
  if (!statusPromise || refresh) {
    statusPromise = fetch("/api/status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AiStatus>) : null))
      .catch(() => null);
  }
  return statusPromise;
}

export async function aiTask<T extends TaskName>(task: T, input: TaskInput<T>): Promise<AiRouteResponse<TaskOutput<T>>> {
  const t0 = performance.now();
  let res: AiRouteResponse<TaskOutput<T>>;
  try {
    // The route gives up after 20 s; this caps the browser's wait too, so nothing that waits on the AI
    // (Submit waits for the AI pass) can hang on a stalled connection.
    const r = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, input }), signal: AbortSignal.timeout(25_000) });
    res = (await r.json()) as AiRouteResponse<TaskOutput<T>>;
  } catch (e) {
    res = (e as Error).name === "TimeoutError" ? { ok: false, reason: "timeout", message: "The AI route took too long" } : { ok: false, reason: "offline", message: "Could not reach the AI route" };
  }
  await db.aiLog.add({
    id: uid("ai"),
    at: nowIso(),
    task,
    model: res.ok ? res.model : undefined,
    ok: res.ok,
    ms: Math.round(performance.now() - t0),
    redactions: res.ok ? res.redactions : 0,
    outcome: res.ok ? "ok" : res.reason,
    attempts: res.attempts,
  });
  return res;
}

/** The pipeline's AI client, or null when the deployment has no keys. */
export async function pipelineAi(): Promise<AiClient | null> {
  const s = await aiStatus();
  if (!s?.aiConfigured) return null;
  return {
    async judge(req) {
      const r = await aiTask("judge", req);
      if (!r.ok) {
        const reason = r.reason === "throttled" || r.reason === "rate_limited" ? "rate_limited" : r.reason === "unconfigured" ? "unconfigured" : r.reason === "timeout" ? "timeout" : r.reason === "offline" ? "offline" : "error";
        return { ok: false, reason, message: r.message };
      }
      return { ok: true, data: { findings: r.data.findings, factChoices: r.data.factChoices }, model: r.model, ms: r.ms, redactions: r.redactions };
    },
  };
}
