// Visual checks for PNG and JPG creatives, run entirely in the browser:
// palette (k-means + ΔE2000), text contrast (tesseract.js word boxes + a
// 2-cluster split per line), alt text and the hand-marked logo box.
import type { ImageAsset, KitContent } from "@/lib/types";
import { contrastRatio, deltaE, hexToRgb, kmeans, nearestPaletteColor, rgbToHex, textColors, type RGB } from "./color";
import type { RawFinding } from "./types";

export interface OcrLine {
  text: string;
  confidence: number;
  box: { x: number; y: number; w: number; h: number };
}

export interface VisualReport {
  findings: RawFinding[];
  dominant: { hex: string; share: number; nearest: string; deltaE: number }[];
  lines: (OcrLine & { fg: string; bg: string; ratio: number; large: boolean })[];
  ocr: "done" | "skipped" | "failed";
}

type Pixels = { data: Uint8ClampedArray; width: number; height: number };

function crop(img: Pixels, box: OcrLine["box"]): Uint8ClampedArray {
  const out: number[] = [];
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(img.width, Math.ceil(box.x + box.w));
  const y1 = Math.min(img.height, Math.ceil(box.y + box.h));
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 6000)));
  for (let y = y0; y < y1; y += step)
    for (let x = x0; x < x1; x += step) {
      const i = (y * img.width + x) * 4;
      out.push(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]);
    }
  return new Uint8ClampedArray(out);
}

/** Pure part of the visual check, given decoded pixels and OCR lines. Unit-tested. */
export function visualFindings(img: Pixels, asset: ImageAsset, kit: KitContent, lines: OcrLine[] | null): VisualReport {
  const rules = new Map(kit.rules.filter((r) => r.active && !r.pending).map((r) => [r.id, r]));
  const findings: RawFinding[] = [];
  const whole = { x: 0, y: 0, w: img.width, h: img.height };

  // Palette: dominant colours more than ΔE 10 from every brand colour.
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 20000)));
  const sample: number[] = [];
  for (let y = 0; y < img.height; y += step)
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 4;
      sample.push(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]);
    }
  const clusters = kmeans(sample, 5);
  const dominant = clusters
    .filter((c) => c.share >= 0.15)
    .map((c) => {
      const hex = rgbToHex(c.rgb);
      const n = nearestPaletteColor(hex, kit.palette);
      return { hex, share: c.share, nearest: `${n.color.name} ${n.color.hex}`, deltaE: Math.round(n.deltaE) };
    });
  const vis01 = rules.get("VIS-01");
  if (vis01) {
    for (const d of dominant.filter((d) => d.deltaE > 10)) {
      findings.push({
        ruleId: vis01.id,
        relatedRuleIds: [],
        category: "visual",
        severity: vis01.severity,
        origin: "rule",
        start: -1,
        end: -1,
        region: whole,
        quote: `Colour ${d.hex} (${Math.round(d.share * 100)}% of the image)`,
        title: "Colour is off palette",
        reason: `${d.hex} is ΔE ${d.deltaE} from the nearest brand colour, ${d.nearest}. The limit is 10 (${vis01.id}).`,
        fix: { kind: "manual", replacement: `Use ${d.nearest} instead of ${d.hex}.`, label: "Swap to the palette colour" },
      });
    }
  }

  // Contrast for every OCR line; failing lines that share their colours form one text block.
  const reportLines: VisualReport["lines"] = [];
  const a11y01 = rules.get("A11Y-01");
  const failing: { line: OcrLine; fg: RGB; bg: RGB; ratio: number; large: boolean; min: number }[] = [];
  for (const line of lines ?? []) {
    if (line.text.replace(/[^\p{L}\p{N}]/gu, "").length < 3 || line.confidence < 30) continue;
    const colors = textColors(crop(img, line.box));
    if (!colors) continue;
    // Roughly 24 px text or larger counts as large text under WCAG.
    const large = line.box.h >= 32;
    const min = large ? 3 : 4.5;
    const ratio = Math.round(colors.ratio * 10) / 10;
    reportLines.push({ ...line, fg: rgbToHex(colors.fg), bg: rgbToHex(colors.bg), ratio, large });
    if (colors.ratio < min) failing.push({ line, fg: colors.fg, bg: colors.bg, ratio, large, min });
  }
  const blocks: (typeof failing)[] = [];
  for (const f of failing) {
    const prev = blocks[blocks.length - 1]?.at(-1);
    const near = prev && deltaE(rgbToHex(prev.fg), rgbToHex(f.fg)) < 5 && deltaE(rgbToHex(prev.bg), rgbToHex(f.bg)) < 5 && f.line.box.y - (prev.line.box.y + prev.line.box.h) < prev.line.box.h;
    if (near) blocks[blocks.length - 1].push(f);
    else blocks.push([f]);
  }
  for (const block of a11y01 ? blocks : []) {
    const first = block[0];
    const x = Math.min(...block.map((b) => b.line.box.x));
    const y = Math.min(...block.map((b) => b.line.box.y));
    const box = { x, y, w: Math.max(...block.map((b) => b.line.box.x + b.line.box.w)) - x, h: Math.max(...block.map((b) => b.line.box.y + b.line.box.h)) - y };
    const ratio = Math.min(...block.map((b) => b.ratio));
    const best = [...kit.palette].sort((p, q) => contrastRatio(hexToRgb(q.hex), first.bg) - contrastRatio(hexToRgb(p.hex), first.bg))[0];
    const bestRatio = Math.round(contrastRatio(hexToRgb(best.hex), first.bg) * 10) / 10;
    findings.push({
      ruleId: a11y01!.id,
      relatedRuleIds: [],
      category: "accessibility",
      severity: a11y01!.severity,
      origin: "rule",
      start: -1,
      end: -1,
      region: box,
      quote: `“${block.map((b) => b.line.text).join(" ")}”`,
      title: "Low text contrast",
      reason: `Text contrast is ${ratio}:1 (${rgbToHex(first.fg)} on ${rgbToHex(first.bg)}), below the ${first.min}:1 WCAG AA minimum for ${first.large ? "large" : "normal"} text (${a11y01!.id}).`,
      fix: { kind: "manual", replacement: `Use ${best.name} ${best.hex} for this text (${bestRatio}:1 on this background).`, label: "Change the text colour" },
    });
  }

  const a11y04 = rules.get("A11Y-04");
  if (a11y04 && !asset.alt.trim()) {
    findings.push({
      ruleId: a11y04.id,
      relatedRuleIds: [],
      category: "accessibility",
      severity: a11y04.severity,
      origin: "rule",
      start: -1,
      end: -1,
      region: whole,
      quote: asset.fileName,
      title: "Image alt text is missing",
      reason: `The creative has no alt text, so screen-reader users miss it (${a11y04.id}).`,
      fix: { kind: "manual", replacement: "Describe the image in one sentence, including any text in it.", label: "Write alt text" },
    });
  }

  const vis03 = rules.get("VIS-03");
  if (vis03 && asset.logoBox) {
    const b = asset.logoBox;
    const clear = kit.logo.clearSpaceRatio * b.h;
    const tight = b.x < clear || b.y < clear || img.width - (b.x + b.w) < clear || img.height - (b.y + b.h) < clear;
    if (b.w < kit.logo.minWidthPx || tight) {
      findings.push({
        ruleId: vis03.id,
        relatedRuleIds: [],
        category: "visual",
        severity: vis03.severity,
        origin: "rule",
        start: -1,
        end: -1,
        region: b,
        quote: `Logo box ${Math.round(b.w)}×${Math.round(b.h)} px`,
        title: b.w < kit.logo.minWidthPx ? "Logo is too small" : "Logo needs more clear space",
        reason:
          (b.w < kit.logo.minWidthPx ? `The logo is ${Math.round(b.w)} px wide, below the ${kit.logo.minWidthPx} px minimum (${vis03.id}).` : "") +
          (tight ? ` Clear space is under half the logo height on at least one side.` : "") +
          " Measured from the logo box marked by hand; automatic logo detection is planned for Round 3.",
        fix: { kind: "manual", replacement: `Scale the logo to at least ${kit.logo.minWidthPx} px wide.`, label: "Resize the logo" },
      });
    }
  }
  return { findings, dominant, lines: reportLines, ocr: lines ? "done" : "skipped" };
}

// ---- Browser-only helpers ------------------------------------------------

export async function decodeImage(dataUrl: string): Promise<Pixels & { canvas: HTMLCanvasElement }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width: canvas.width, height: canvas.height, canvas };
}

/** A contrast-stretched greyscale copy, so OCR can read low-contrast text. Contrast is measured on the original. */
export function ocrCanvas(src: Pixels): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d")!;
  const out = ctx.createImageData(src.width, src.height);
  let min = 255;
  let max = 0;
  const grey = new Float32Array(src.width * src.height);
  for (let i = 0; i < grey.length; i++) {
    const g = 0.299 * src.data[i * 4] + 0.587 * src.data[i * 4 + 1] + 0.114 * src.data[i * 4 + 2];
    grey[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < grey.length; i++) {
    const v = ((grey[i] - min) / range) * 255;
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

let workerPromise: Promise<import("tesseract.js").Worker> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(({ createWorker }) =>
      createWorker("eng", 1, {
        workerPath: "/vendor/tesseract/worker.min.js",
        corePath: "/vendor/tesseract/core",
        langPath: "/vendor/tesseract/lang",
        gzip: true,
      }),
    );
  }
  return workerPromise;
}

/** Starts loading the OCR engine and its English data, so the first check does not wait for the download. */
export function warmOcr() {
  void getWorker().catch(() => {
    workerPromise = null;
  });
}

export async function ocrLines(src: Pixels): Promise<OcrLine[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(ocrCanvas(src), {}, { blocks: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines) {
        const { x0, y0, x1, y1 } = line.bbox;
        lines.push({ text: line.text.trim(), confidence: line.confidence, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
      }
  return lines;
}

export async function analyzeImage(asset: ImageAsset, kit: KitContent): Promise<VisualReport> {
  const px = await decodeImage(asset.dataUrl);
  let lines: OcrLine[] | null = null;
  let failed = false;
  try {
    lines = await ocrLines(px);
  } catch {
    failed = true;
  }
  const report = visualFindings(px, asset, kit, lines);
  return failed ? { ...report, ocr: "failed" } : report;
}

export type { RGB };
