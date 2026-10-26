// The Gemini key pool. Keys come from separate Google accounts, so each one
// has its own free-tier quota; the pool rotates through them and cools down
// or disables a key based on how Gemini answered. Key values are never
// logged or returned: only labels are.

export interface KeyEntry {
  label: string;
  value: string;
}

export interface ParsedKeys {
  keys: KeyEntry[];
  warnings: string[];
}

const clean = (s: string) => s.trim().replace(/^["']|["']$/g, "").trim();

function splitList(raw: string): string[] {
  return raw
    .replace(/^\[|\]$/g, "")
    .split(/[\s,;]+/)
    .map(clean)
    .filter(Boolean);
}

/** Reads GEMINI_API_KEYS (JSON array, JSON object of label → key, or a delimited list) plus GEMINI_API_KEY and GEMINI_API_KEY_1…9. */
export function parseKeys(env: Record<string, string | undefined>): ParsedKeys {
  const warnings: string[] = [];
  const found: KeyEntry[] = [];
  const raw = env.GEMINI_API_KEYS?.trim();
  if (raw) {
    if (raw.startsWith("[") || raw.startsWith("{")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        warnings.push("GEMINI_API_KEYS is not valid JSON; read it as a list instead");
      }
      if (Array.isArray(parsed)) {
        parsed.forEach((v, i) => {
          if (typeof v === "string" && clean(v)) found.push({ label: `GEMINI_API_KEYS[${i}]`, value: clean(v) });
          else warnings.push(`GEMINI_API_KEYS[${i}] is not a string; skipped`);
        });
      } else if (parsed && typeof parsed === "object") {
        for (const [label, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string" && clean(v)) found.push({ label: label.slice(0, 40), value: clean(v) });
          else warnings.push(`GEMINI_API_KEYS.${label.slice(0, 40)} is not a string; skipped`);
        }
      } else if (parsed === undefined) {
        splitList(raw).forEach((v, i) => found.push({ label: `GEMINI_API_KEYS[${i}]`, value: v }));
      }
    } else {
      splitList(raw).forEach((v, i) => found.push({ label: `GEMINI_API_KEYS[${i}]`, value: v }));
    }
  }
  if (env.GEMINI_API_KEY?.trim()) found.push({ label: "GEMINI_API_KEY", value: clean(env.GEMINI_API_KEY) });
  for (let i = 1; i <= 9; i++) {
    const v = env[`GEMINI_API_KEY_${i}`]?.trim();
    if (v) found.push({ label: `GEMINI_API_KEY_${i}`, value: clean(v) });
  }
  const seen = new Set<string>();
  const keys = found.filter((k) => {
    if (!k.value || seen.has(k.value)) return false;
    seen.add(k.value);
    return true;
  });
  return { keys, warnings };
}

/** Start of the next day in US Pacific time, when Gemini's daily free quota resets. */
export function nextPacificMidnight(now: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  const sinceMidnight = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + (now % 1000);
  return now - sinceMidnight + 86_400_000;
}

interface KeyState extends KeyEntry {
  /** Cooldown end per model ("*" for the whole key): Gemini's free-tier quotas are per model. */
  cooldownUntil: Record<string, number>;
  disabled: boolean;
}

export class KeyPool {
  private keys: KeyState[];
  private cursor = 0;

  constructor(
    entries: KeyEntry[],
    private now: () => number = Date.now,
  ) {
    this.keys = entries.map((e) => ({ ...e, cooldownUntil: {}, disabled: false }));
  }

  get size() {
    return this.keys.length;
  }

  private usable(k: KeyState, model: string | undefined, t: number) {
    return !k.disabled && (k.cooldownUntil["*"] ?? 0) <= t && (model === undefined || (k.cooldownUntil[model] ?? 0) <= t);
  }

  /** Keys usable right now, on one model if given. */
  available(model?: string): KeyEntry[] {
    const t = this.now();
    return this.keys.filter((k) => this.usable(k, model, t));
  }

  /** Available keys for one call on a model, starting from the next key in turn. */
  order(model?: string): KeyEntry[] {
    if (!this.keys.length) return [];
    const start = this.cursor % this.keys.length;
    this.cursor = (this.cursor + 1) % this.keys.length;
    const t = this.now();
    const rotated = [...this.keys.slice(start), ...this.keys.slice(0, start)];
    return rotated.filter((k) => this.usable(k, model, t)).map(({ label, value }) => ({ label, value }));
  }

  /**
   * 429: wait for Gemini's retryDelay, 60 s by default, or until Pacific midnight for a daily quota.
   * With a model, only that model cools down on this key; the key's other models keep their own quota.
   */
  rateLimited(label: string, opts: { retryMs?: number; daily?: boolean } = {}, model = "*") {
    const k = this.keys.find((x) => x.label === label);
    if (!k) return;
    const t = this.now();
    k.cooldownUntil[model] = opts.daily ? nextPacificMidnight(t) : t + (opts.retryMs ?? 60_000);
  }

  /** 401/403: the key is wrong or revoked; stop using it for the life of this instance. */
  invalid(label: string) {
    const k = this.keys.find((x) => x.label === label);
    if (k) k.disabled = true;
  }

  /** With models, a key counts as available while any of them can use it. */
  status(models?: string[]) {
    const t = this.now();
    const ready = this.keys.filter((k) => (models?.length ? models.some((m) => this.usable(k, m, t)) : this.usable(k, undefined, t)));
    return { keyCount: this.keys.length, keysAvailable: ready.length };
  }
}

let shared: KeyPool | null = null;

export function sharedPool(): KeyPool {
  if (!shared) {
    const { keys, warnings } = parseKeys(process.env);
    for (const w of warnings) console.warn(`[ai] ${w}`);
    shared = new KeyPool(keys);
  }
  return shared;
}
