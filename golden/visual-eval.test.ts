// pnpm eval:visual draws 20 fictional creatives in the browser, each with known faults by construction, runs the real visual
// check (real OCR, no hand-marked logo) over them, and writes precision and recall to docs/eval-visual-results.json. The truth
// here is what the generator drew, not a person's opinion. Skipped in a normal test run, because OCR makes it slow.
import { describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { contrastRatio, hexToRgb, type RGB } from "@/engine/color";
import { analyzeImage } from "@/engine/visual";
import { VELVRA_KIT } from "@/seed/velvra";

const SIZE = 1080;
const ON_PALETTE = VELVRA_KIT.palette.map((p) => p.hex);
const OFF_PALETTE = ["#FF5FA2", "#12B76A", "#2E5BFF", "#FFD400", "#7A1FA2"];
const LINES = ["Sun care for every day", "Light on skin all day", "Made for humid mornings", "Wear it every morning", "A gel that sits light"];
const LOGO_RULES = ["VIS-01", "VIS-03", "A11Y-01", "A11Y-04"] as const;
const CATEGORY: Record<string, string> = { "VIS-01": "visual", "VIS-03": "visual", "A11Y-01": "accessibility", "A11Y-04": "accessibility" };

const FACES = ["700 84px sans-serif", "700 84px serif", "italic 700 80px serif", "400 84px sans-serif", "700 72px monospace"];

/** Same output every run, so a change in the score means a change in the engine. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

const css = (c: RGB) => `rgb(${c[0]} ${c[1]} ${c[2]})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

/** The strongest palette ink on this ground, and a colour between them at about 2:1, which fails even for large text. */
function inks(bg: RGB) {
  const strong = [hexToRgb("#1F1B24"), hexToRgb("#FBF6EF")].sort((p, q) => contrastRatio(q, bg) - contrastRatio(p, bg))[0];
  let low = 0;
  let high = 1;
  for (let i = 0; i < 12; i++) {
    const t = (low + high) / 2;
    if (contrastRatio(mix(bg, strong, t), bg) < 2) low = t;
    else high = t;
  }
  return { strong, faint: mix(bg, strong, high) };
}

function draw(i: number) {
  const hex = [...ON_PALETTE, ...OFF_PALETTE][i % 10];
  const bg = hexToRgb(hex);
  const { strong, faint } = inks(bg);
  const lowContrast = i % 3 === 0;
  const logo = i % 5 === 4 ? "none" : i % 5 === 1 || i % 5 === 2 ? "small" : "ok";
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = css(bg);
  ctx.fillRect(0, 0, SIZE, SIZE);
  // A soft gradient on some grounds and film-like speckle on others: small enough to stay the same colour to a reader, but no longer flat.
  if (i % 4 === 1) {
    const shade = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    shade.addColorStop(0, "rgb(255 255 255 / 0.06)");
    shade.addColorStop(1, "rgb(0 0 0 / 0.06)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  if (i % 4 === 2) {
    const random = seeded(i + 1);
    for (let n = 0; n < 9000; n++) {
      ctx.fillStyle = random() > 0.5 ? "rgb(255 255 255 / 0.08)" : "rgb(0 0 0 / 0.08)";
      ctx.fillRect(random() * SIZE, random() * SIZE, 3, 3);
    }
  }
  ctx.fillStyle = css(lowContrast ? faint : strong);
  ctx.font = FACES[i % FACES.length];
  const words = LINES[i % LINES.length].split(" ");
  ctx.fillText(words.slice(0, 2).join(" "), 80, 300);
  ctx.fillText(words.slice(2).join(" "), 80, 400);
  ctx.fillStyle = css(strong);
  if (logo !== "none") {
    // Sized to a target width, so "too small" is what the generator meant, with clear space on every side.
    const target = logo === "small" ? 90 : 170;
    ctx.font = "700 100px sans-serif";
    const size = Math.round((100 * target) / ctx.measureText("velvra").width);
    ctx.font = `700 ${size}px sans-serif`;
    // Bottom on most, top on some, because that's where logos sit.
    ctx.fillText("velvra", 80, i % 3 === 2 ? 120 : SIZE - 110);
  }
  const alt = i % 2 ? "" : "A plain colour poster with a headline.";
  return {
    id: `creative-${i + 1}`,
    dataUrl: canvas.toDataURL("image/png"),
    alt,
    expect: new Set<string>([...(OFF_PALETTE.includes(hex) ? ["VIS-01"] : []), ...(lowContrast ? ["A11Y-01"] : []), ...(logo === "small" ? ["VIS-03"] : []), ...(alt ? [] : ["A11Y-04"])]),
  };
}

const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null);

describe("Visual checks against 20 drawn creatives", () => {
  it.runIf((import.meta.env as unknown as Record<string, unknown>).VITE_EVAL_VISUAL)("records precision and recall", { timeout: 300_000 }, async () => {
    const stats = new Map(LOGO_RULES.map((r) => [r as string, { tp: 0, fp: 0, fn: 0 }]));
    const disagreements: string[] = [];
    let logosFound = 0;
    let logosDrawn = 0;
    for (let i = 0; i < 20; i++) {
      const c = draw(i);
      const report = await analyzeImage({ dataUrl: c.dataUrl, width: SIZE, height: SIZE, alt: c.alt, fileName: `${c.id}.png` }, VELVRA_KIT);
      const found = new Set(report.findings.map((f) => f.ruleId));
      if (i % 5 !== 4) {
        logosDrawn++;
        if (report.logo) logosFound++;
      }
      for (const rule of LOGO_RULES) {
        const s = stats.get(rule)!;
        if (found.has(rule) && c.expect.has(rule)) s.tp++;
        else if (found.has(rule)) {
          s.fp++;
          disagreements.push(`FP ${c.id}: ${rule}`);
        } else if (c.expect.has(rule)) {
          s.fn++;
          disagreements.push(`FN ${c.id}: ${rule}`);
        }
      }
    }
    const row = (name: string, keys: string[]) => {
      const t = keys.reduce((a, k) => ({ tp: a.tp + stats.get(k)!.tp, fp: a.fp + stats.get(k)!.fp, fn: a.fn + stats.get(k)!.fn }), { tp: 0, fp: 0, fn: 0 });
      return { name, ...t, precision: ratio(t.tp, t.tp + t.fp), recall: ratio(t.tp, t.tp + t.fn) };
    };
    const results = {
      ranAt: new Date().toISOString(),
      creatives: 20,
      truth: "What a generator written by the builder with AI assistance drew, in five type styles on flat, gradient and speckled grounds. No person labelled these, and none is a photograph, so a good score here says little about busy photographic creatives.",
      rules: LOGO_RULES.map((r) => row(r, [r])),
      categories: ["visual", "accessibility"].map((c) => row(c, LOGO_RULES.filter((r) => CATEGORY[r] === c))),
      logosFound: { found: logosFound, of: logosDrawn, note: "Found by reading the wordmark; nothing was marked by hand. A logo that is a picture isn't covered." },
      disagreements,
    };
    await commands.writeFile("docs/eval-visual-results.json", JSON.stringify(results, null, 2) + "\n");
    expect(results.creatives).toBe(20);
  });
});
