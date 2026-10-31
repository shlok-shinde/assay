// Visual checks for PNG and JPG creatives, run entirely in the browser: decoding and OCR here, the
// palette and contrast analysis (visual-core) in a Web Worker so it never blocks the page.
import type { ImageAsset, KitContent } from "@/lib/types";
import { findWordmark, visualFindings, type OcrLine, type Pixels, type VisualReport } from "./visual-core";

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
  // Transparent pixels read as black, which would invent dark colours and contrast failures. Creatives sit on white unless they say otherwise.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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

const OCR_MS = 60_000;
let ocrTurn: Promise<unknown> = Promise.resolve();

/**
 * One job at a time on the shared OCR worker, since a job can change its reading mode. A failure or a stall
 * drops the worker, so the next try starts clean instead of joining a dead one.
 */
function withOcr<T>(ms: number, job: (worker: import("tesseract.js").Worker) => Promise<T>): Promise<T> {
  const run = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("OCR took too long")), ms);
    });
    try {
      return await Promise.race([getWorker().then(job), timeout]);
    } catch (e) {
      const stuck = workerPromise;
      workerPromise = null;
      void stuck?.then((w) => w.terminate()).catch(() => undefined);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  const result = ocrTurn.then(run, run);
  ocrTurn = result.catch(() => undefined);
  return result;
}

/** Reads a creative's text. */
export function ocrLines(src: Pixels, ms = OCR_MS): Promise<OcrLine[]> {
  return withOcr(ms, async (worker) => {
    const { data } = await worker.recognize(ocrCanvas(src), {}, { text: false, blocks: false, tsv: true });
    return linesFromTsv(data.tsv ?? "");
  });
}

/** A logo sits at the top or bottom of a creative, small. These strips, stretched and enlarged on their own, are where OCR can read it. */
const LOGO_STRIPS = [
  [0.8, 1],
  [0, 0.2],
] as const;
const LOGO_SCALE = 3;
// Tesseract's page modes, as strings so the OCR engine stays out of the first load. 6 is tesseract.js's default.
const SPARSE_WORDS = "11" as unknown as import("tesseract.js").PSM;
const WHOLE_BLOCK = "6" as unknown as import("tesseract.js").PSM;

/** Looks for the brand's wordmark, one strip at a time, in the OCR mode for scattered words. Finding nothing is not an error: the logo may be a picture. */
export function findLogo(src: Pixels, kit: Pick<KitContent, "name">): Promise<OcrLine["box"] | undefined> {
  return withOcr(OCR_MS, async (worker) => {
    await worker.setParameters({ tessedit_pageseg_mode: SPARSE_WORDS });
    try {
      for (const [from, to] of LOGO_STRIPS) {
        const top = Math.floor(from * src.height);
        const bottom = Math.floor(to * src.height);
        const strip = ocrCanvas({ data: src.data.subarray(top * src.width * 4, bottom * src.width * 4), width: src.width, height: bottom - top });
        const large = document.createElement("canvas");
        large.width = strip.width * LOGO_SCALE;
        large.height = strip.height * LOGO_SCALE;
        large.getContext("2d")!.drawImage(strip, 0, 0, large.width, large.height);
        const { data } = await worker.recognize(large, {}, { text: false, blocks: false, tsv: true });
        const box = findWordmark(linesFromTsv(data.tsv ?? ""), kit);
        if (box) return { x: box.x / LOGO_SCALE, y: box.y / LOGO_SCALE + top, w: box.w / LOGO_SCALE, h: box.h / LOGO_SCALE };
      }
      return undefined;
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: WHOLE_BLOCK });
    }
  });
}

export async function analyzeImage(asset: ImageAsset, kit: KitContent): Promise<VisualReport> {
  const px = await decodeImage(asset.dataUrl);
  let lines: OcrLine[] | null = null;
  let failed = false;
  let wordmark: OcrLine["box"] | undefined;
  try {
    lines = await ocrLines(px);
    if (!asset.logoBox) wordmark = await findLogo(px, kit);
  } catch {
    failed = !lines;
  }
  const report = await findingsOffThread(px, asset, kit, lines, wordmark);
  return failed ? { ...report, ocr: "failed" } : report;
}

let analyst: Worker | null | undefined;
let jobs = 0;

/** visualFindings in a Web Worker; on the main thread only if a worker cannot start. */
async function findingsOffThread(px: Pixels, asset: ImageAsset, kit: KitContent, lines: OcrLine[] | null, wordmark?: OcrLine["box"]): Promise<VisualReport> {
  if (analyst === undefined) {
    try {
      analyst = new Worker(new URL("./visual.worker.ts", import.meta.url), { type: "module" });
    } catch {
      analyst = null;
    }
  }
  if (!analyst) return visualFindings(px, asset, kit, lines, wordmark);
  const worker = analyst;
  const id = ++jobs;
  const { dataUrl: _skip, ...meta } = asset;
  const data = px.data.slice(); // the worker takes this copy; the decoded image stays usable here
  return new Promise<VisualReport>((resolve, reject) => {
    let settled = false;
    const finish = (report?: VisualReport) => {
      if (settled) return;
      settled = true;
      worker.removeEventListener("message", done);
      window.clearTimeout(timer);
      // This runs from a timer or an event, so a throw here would leave the check waiting forever.
      try {
        resolve(report ?? visualFindings(px, asset, kit, lines, wordmark));
      } catch (e) {
        reject(e);
      }
    };
    const done = (e: MessageEvent<{ id: number; report?: VisualReport; error?: string }>) => {
      if (e.data.id === id) finish(e.data.report);
    };
    // A check never waits on a worker that went quiet: after 8 s the page does the work itself.
    const timer = window.setTimeout(() => finish(), 8_000);
    worker.addEventListener("message", done);
    worker.addEventListener("error", () => finish(), { once: true });
    worker.postMessage({ id, data, width: px.width, height: px.height, asset: meta, kit, lines, wordmark }, [data.buffer]);
  });
}

