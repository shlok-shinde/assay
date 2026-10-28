// Visual checks for PNG and JPG creatives, run entirely in the browser: decoding and OCR here, the
// palette and contrast analysis (visual-core) in a Web Worker so it never blocks the page.
import type { ImageAsset, KitContent } from "@/lib/types";
import { visualFindings, type OcrLine, type Pixels, type VisualReport } from "./visual-core";

export { visualFindings, type OcrLine, type VisualReport } from "./visual-core";
export type { RGB } from "./color";

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

/**
 * Lines from Tesseract's TSV output: one row per word, grouped by block, paragraph and line. The TSV
 * is a single string, so it crosses back from the OCR worker almost for free; asking for `blocks`
 * instead copies every word and glyph with its alternatives, which froze the page for most of a second.
 */
export function linesFromTsv(tsv: string): OcrLine[] {
  const groups = new Map<string, { words: string[]; conf: number[]; x0: number; y0: number; x1: number; y1: number }>();
  for (const row of tsv.split("\n")) {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5") continue; // level 5 is a word
    const text = c[11].trim();
    if (!text) continue;
    const [left, top, width, height, conf] = [+c[6], +c[7], +c[8], +c[9], +c[10]];
    const key = `${c[2]}.${c[3]}.${c[4]}`;
    const g = groups.get(key) ?? { words: [], conf: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    g.words.push(text);
    g.conf.push(conf);
    g.x0 = Math.min(g.x0, left);
    g.y0 = Math.min(g.y0, top);
    g.x1 = Math.max(g.x1, left + width);
    g.y1 = Math.max(g.y1, top + height);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    text: g.words.join(" "),
    confidence: g.conf.reduce((a, b) => a + b, 0) / g.conf.length,
    box: { x: g.x0, y: g.y0, w: g.x1 - g.x0, h: g.y1 - g.y0 },
  }));
}

export async function ocrLines(src: Pixels): Promise<OcrLine[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(ocrCanvas(src), {}, { text: false, blocks: false, tsv: true });
  return linesFromTsv(data.tsv ?? "");
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
  const report = await findingsOffThread(px, asset, kit, lines);
  return failed ? { ...report, ocr: "failed" } : report;
}

let analyst: Worker | null | undefined;
let jobs = 0;

/** visualFindings in a Web Worker; on the main thread only if a worker cannot start. */
async function findingsOffThread(px: Pixels, asset: ImageAsset, kit: KitContent, lines: OcrLine[] | null): Promise<VisualReport> {
  if (analyst === undefined) {
    try {
      analyst = new Worker(new URL("./visual.worker.ts", import.meta.url), { type: "module" });
    } catch {
      analyst = null;
    }
  }
  if (!analyst) return visualFindings(px, asset, kit, lines);
  const worker = analyst;
  const id = ++jobs;
  const { dataUrl: _skip, ...meta } = asset;
  const data = px.data.slice(); // the worker takes this copy; the decoded image stays usable here
  return new Promise<VisualReport>((resolve) => {
    let settled = false;
    const finish = (report?: VisualReport) => {
      if (settled) return;
      settled = true;
      worker.removeEventListener("message", done);
      window.clearTimeout(timer);
      resolve(report ?? visualFindings(px, asset, kit, lines));
    };
    const done = (e: MessageEvent<{ id: number; report?: VisualReport; error?: string }>) => {
      if (e.data.id === id) finish(e.data.report);
    };
    // A check never waits on a worker that went quiet: after 8 s the page does the work itself.
    const timer = window.setTimeout(() => finish(), 8_000);
    worker.addEventListener("message", done);
    worker.addEventListener("error", () => finish(), { once: true });
    worker.postMessage({ id, data, width: px.width, height: px.height, asset: meta, kit, lines }, [data.buffer]);
  });
}

