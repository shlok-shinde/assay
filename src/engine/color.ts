// Colour maths for the visual checks: WCAG contrast, CIEDE2000 distance
// (via culori) and a small deterministic k-means over pixels.
import { differenceCiede2000 } from "culori";
import type { PaletteColor } from "@/lib/types";

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

/** sRGB channel value (0-255) to linear light, precomputed. */
const LIN = Float64Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

export function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const ciede = differenceCiede2000();

export function deltaE(a: string, b: string): number {
  return ciede(a, b);
}

export function nearestPaletteColor(hex: string, palette: PaletteColor[]): { color: PaletteColor; deltaE: number } {
  let best = { color: palette[0], deltaE: Infinity };
  for (const c of palette) {
    const d = deltaE(hex, c.hex);
    if (d < best.deltaE) best = { color: c, deltaE: d };
  }
  return best;
}

export interface Cluster {
  rgb: RGB;
  share: number;
}

/**
 * K-means on RGBA pixel data. Deterministic: centres start at evenly spaced
 * pixels sorted by luminance, so the same image always gives the same result.
 */
export function kmeans(data: Uint8ClampedArray | number[], k: number, iterations = 12): Cluster[] {
  // Flat typed arrays and one luminance per pixel: the same result as the plain version, but it runs
  // once per OCR line on every check, so boxing pixels and recomputing luminance in the sort froze the page.
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) if (data[i + 3] > 127) n++;
  if (!n) return [];
  const px = new Float64Array(n * 3);
  const lum = new Float64Array(n);
  for (let i = 0, j = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] <= 127) continue;
    px[j * 3] = data[i];
    px[j * 3 + 1] = data[i + 1];
    px[j * 3 + 2] = data[i + 2];
    lum[j] = 0.2126 * LIN[data[i]] + 0.7152 * LIN[data[i + 1]] + 0.0722 * LIN[data[i + 2]];
    j++;
  }
  // Array.prototype.sort is stable, so ties keep pixel order, as before.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => lum[a] - lum[b]);
  const kk = Math.min(k, n);
  const centres = new Float64Array(kk * 3);
  for (let c = 0; c < kk; c++) {
    const p = order[Math.floor(((c + 0.5) * n) / k)];
    centres[c * 3] = px[p * 3];
    centres[c * 3 + 1] = px[p * 3 + 1];
    centres[c * 3 + 2] = px[p * 3 + 2];
  }
  const assign = new Uint8Array(n);
  const sums = new Float64Array(kk * 4);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const dr = px[i * 3] - centres[c * 3];
        const dg = px[i * 3 + 1] - centres[c * 3 + 1];
        const db = px[i * 3 + 2] - centres[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    sums.fill(0);
    for (let i = 0; i < n; i++) {
      const s = assign[i] * 4;
      sums[s] += px[i * 3];
      sums[s + 1] += px[i * 3 + 1];
      sums[s + 2] += px[i * 3 + 2];
      sums[s + 3]++;
    }
    for (let c = 0; c < kk; c++)
      if (sums[c * 4 + 3]) for (let ch = 0; ch < 3; ch++) centres[c * 3 + ch] = sums[c * 4 + ch] / sums[c * 4 + 3];
  }
  const counts = new Array<number>(kk).fill(0);
  for (let i = 0; i < n; i++) counts[assign[i]]++;
  return Array.from({ length: kk }, (_, c) => ({ rgb: [Math.round(centres[c * 3]), Math.round(centres[c * 3 + 1]), Math.round(centres[c * 3 + 2])] as RGB, share: counts[c] / n }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

/** Foreground and background of a text box: the two clusters, background being the larger. */
export function textColors(data: Uint8ClampedArray | number[]): { fg: RGB; bg: RGB; ratio: number } | null {
  const [a, b] = kmeans(data, 2, 8);
  if (!a || !b) return null;
  return { fg: b.rgb, bg: a.rgb, ratio: contrastRatio(a.rgb, b.rgb) };
}
