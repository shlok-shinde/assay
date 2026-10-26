import { describe, expect, it } from "vitest";
import { KeyPool, nextPacificMidnight, parseKeys } from "./keys";
import { callGemini, modelChain, parse429 } from "./gemini";

describe("parseKeys", () => {
  it("reads a JSON array", () => {
    expect(parseKeys({ GEMINI_API_KEYS: '["k1","k2"]' }).keys).toEqual([
      { label: "GEMINI_API_KEYS[0]", value: "k1" },
      { label: "GEMINI_API_KEYS[1]", value: "k2" },
    ]);
  });

  it("reads a JSON object of label to key", () => {
    expect(parseKeys({ GEMINI_API_KEYS: '{"main":"k1","backup":"k2"}' }).keys.map((k) => k.label)).toEqual(["main", "backup"]);
  });

  it("reads comma, newline, space and semicolon lists", () => {
    expect(parseKeys({ GEMINI_API_KEYS: "k1, k2\nk3;k4 k5" }).keys.map((k) => k.value)).toEqual(["k1", "k2", "k3", "k4", "k5"]);
  });

  it("merges GEMINI_API_KEY and numbered keys, trims and dedupes", () => {
    const { keys } = parseKeys({ GEMINI_API_KEYS: ' "k1" , k2 ', GEMINI_API_KEY: "k2", GEMINI_API_KEY_3: " k3 ", GEMINI_API_KEY_9: "" });
    expect(keys.map((k) => k.value)).toEqual(["k1", "k2", "k3"]);
  });

  it("falls back to a list on broken JSON and never echoes a value in warnings", () => {
    const { keys, warnings } = parseKeys({ GEMINI_API_KEYS: "[secretA, secretB" });
    expect(keys.map((k) => k.value)).toEqual(["secretA", "secretB"]);
    expect(warnings.join(" ")).not.toMatch(/secret/);
    expect(warnings[0]).toContain("GEMINI_API_KEYS");
  });

  it("returns no keys when nothing is set", () => {
    expect(parseKeys({}).keys).toEqual([]);
  });
});

describe("KeyPool", () => {
  it("rotates the starting key on each call", () => {
    const pool = new KeyPool([
      { label: "a", value: "1" },
      { label: "b", value: "2" },
      { label: "c", value: "3" },
    ]);
    expect(pool.order().map((k) => k.label)).toEqual(["a", "b", "c"]);
    expect(pool.order().map((k) => k.label)).toEqual(["b", "c", "a"]);
  });

  it("cools a rate-limited key down and brings it back", () => {
    let now = 1_000_000;
    const pool = new KeyPool(
      [
        { label: "a", value: "1" },
        { label: "b", value: "2" },
      ],
      () => now,
    );
    pool.rateLimited("a", { retryMs: 30_000 });
    expect(pool.status()).toEqual({ keyCount: 2, keysAvailable: 1 });
    now += 30_001;
    expect(pool.status().keysAvailable).toBe(2);
  });

  it("cools a daily-quota key until Pacific midnight, and disables invalid keys", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    const pool = new KeyPool(
      [
        { label: "a", value: "1" },
        { label: "b", value: "2" },
      ],
      () => now,
    );
    pool.rateLimited("a", { daily: true });
    pool.invalid("b");
    expect(pool.available()).toEqual([]);
    expect(nextPacificMidnight(now)).toBe(Date.parse("2026-10-27T07:00:00Z"));
  });
});

describe("Gemini calls", () => {
  const env = { GEMINI_BASE_URL: "https://fake.test/v1beta" };
  const ok = (json: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 });
  const err = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

  it("parses retryDelay and daily quota from a 429", () => {
    expect(parse429({ error: { details: [{ "@type": "x.RetryInfo", retryDelay: "32s" }] } })).toEqual({ retryMs: 32_000, daily: false });
    expect(parse429({ error: { details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } }).daily).toBe(true);
  });

  it("moves to the next key on 429 and 401, and to the next model on 404", async () => {
    const seen: string[] = [];
    const pool = new KeyPool([
      { label: "a", value: "KEY_A" },
      { label: "b", value: "KEY_B" },
    ]);
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["x-goog-api-key"];
      const model = url.split("/models/")[1].split(":")[0];
      seen.push(`${model}:${key}`);
      if (model === modelChain("judge", {})[0]) return key === "KEY_A" ? err(429) : err(404);
      return key === "KEY_A" ? err(401) : ok({ hello: "world" });
    }) as typeof fetch;
    const r = await callGemini(pool, { system: "s", user: "u", tier: "judge" }, { fetchImpl, env });
    expect(r).toMatchObject({ ok: true, json: { hello: "world" }, keyLabel: "b" });
    expect(seen).toEqual(["gemini-3.8-flash:KEY_A", "gemini-3.8-flash:KEY_B", "gemini-3.6-flash:KEY_B"]);
    expect(pool.status().keysAvailable).toBe(1);
  });

  it("reports rate_limited when every key is cooling down", async () => {
    const pool = new KeyPool([{ label: "a", value: "1" }]);
    const fetchImpl = (async () => err(429, { error: { details: [{ retryDelay: "5s" }] } })) as unknown as typeof fetch;
    const r = await callGemini(pool, { system: "s", user: "u", tier: "lite" }, { fetchImpl, env });
    expect(r).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("is unconfigured with no keys, and honours GEMINI_MODEL overrides", async () => {
    expect(await callGemini(new KeyPool([]), { system: "s", user: "u", tier: "judge" }, { env })).toMatchObject({ reason: "unconfigured" });
    expect(modelChain("judge", { GEMINI_MODEL: "my-model" })).toEqual(["my-model", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"]);
  });

  it("on a 400, drops the schema field first (moving the schema into the prompt), then thinking", async () => {
    const bodies: string[] = [];
    const pool = new KeyPool([{ label: "a", value: "1" }]);
    const reject = (thinkingOk: boolean) =>
      (async (_url: string, init: RequestInit) => {
        const b = JSON.parse(String(init.body));
        const g = b.generationConfig;
        const inPrompt = b.systemInstruction.parts[0].text.includes('{"type":"object"}');
        bodies.push(`${g.thinkingConfig?.thinkingLevel ?? "-"}/${g.responseJsonSchema ? "schema" : inPrompt ? "prompt" : "-"}`);
        return g.responseJsonSchema || (g.thinkingConfig && !thinkingOk) ? err(400) : ok({ fine: true });
      }) as typeof fetch;
    const call = { system: "s", user: "u", tier: "lite" as const, schema: { type: "object" } };
    expect((await callGemini(pool, call, { fetchImpl: reject(true), env })).ok).toBe(true);
    expect(bodies.splice(0)).toEqual(["minimal/schema", "minimal/prompt"]);
    expect((await callGemini(pool, call, { fetchImpl: reject(false), env })).ok).toBe(true);
    expect(bodies).toEqual(["minimal/schema", "minimal/prompt", "-/schema", "-/prompt"]);
  });

  it("moves to the next model when one is overloaded (5xx), without burning the other keys on it", async () => {
    const seen: string[] = [];
    const pool = new KeyPool([
      { label: "a", value: "KEY_A" },
      { label: "b", value: "KEY_B" },
    ]);
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const model = url.split("/models/")[1].split(":")[0];
      seen.push(model);
      expect(JSON.parse(String(init.body)).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
      return model === "gemini-3.8-flash" ? err(503) : ok({ fine: true });
    }) as typeof fetch;
    const r = await callGemini(pool, { system: "s", user: "u", tier: "judge" }, { fetchImpl, env });
    expect(r).toMatchObject({ ok: true, model: "gemini-3.6-flash" });
    expect(seen).toEqual(["gemini-3.8-flash", "gemini-3.6-flash"]);
    expect(pool.status().keysAvailable).toBe(2);
  });

  it("gives up on a hanging model after one attempt's share of the budget", async () => {
    const pool = new KeyPool([{ label: "a", value: "1" }]);
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (url.includes("gemini-3.8-flash"))
        return new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("t", "TimeoutError"))));
      return ok({ fine: true });
    }) as typeof fetch;
    const t0 = Date.now();
    const r = await callGemini(pool, { system: "s", user: "u", tier: "judge" }, { fetchImpl, env });
    expect(r).toMatchObject({ ok: true, model: "gemini-3.6-flash" });
    expect(Date.now() - t0).toBeLessThan(9_500);
  }, 15_000);
});
