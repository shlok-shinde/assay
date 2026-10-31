// The saved AI answers are only useful if the app's own cache keys find them. A rulebook or sample change
// moves the keys, and then the demo would silently call the AI instead.
import { describe, expect, it } from "vitest";
import { hashJson } from "@/engine/hash";
import { segmentKey, type CheckInput } from "@/engine/pipeline";
import { activeRules, appliesTo } from "@/engine/rules";
import { paragraphs } from "@/engine/text";
import cache from "./ai-cache.json";
import { SAMPLES } from "./samples";
import { VELVRA_KIT } from "./velvra";

const entries = cache as { key: string; model: string; at: string }[];

describe("Saved AI answers", () => {
  it.skipIf(!entries.length)("cover every paragraph of every sample's text, with a model and a date", async () => {
    const keys = new Set(entries.map((e) => e.key));
    const missing: string[] = [];
    for (const s of SAMPLES) {
      const rules = activeRules(VELVRA_KIT).filter((r) => r.modes.includes("judgment") && appliesTo(r, s.channel) && r.id.length <= 20);
      const rulesHash = await hashJson({ version: "3.2", rules });
      const input = { channel: s.channel, audience: s.audience, intent: { ...s.intent, confirmed: true, draftedBy: "creator" } } as CheckInput;
      for (const p of paragraphs(s.text)) if (!keys.has(await segmentKey(p.text, input, rulesHash))) missing.push(`${s.id}: ${p.text.slice(0, 40)}`);
    }
    expect(missing).toEqual([]);
    for (const e of entries) {
      expect(e.model).toBeTruthy();
      expect(Date.parse(e.at)).not.toBeNaN();
    }
  });
});
