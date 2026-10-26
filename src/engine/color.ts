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
  const px: RGB[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) if (data[i + 3] > 127) px.push([data[i], data[i + 1], data[i + 2]]);
  if (!px.length) return [];
  const sorted = [...px].sort((a, b) => luminance(a) - luminance(b));
  let centres: RGB[] = Array.from({ length: Math.min(k, px.length) }, (_, i) => sorted[Math.floor(((i + 0.5) * sorted.length) / k)]);
  const assign = new Array<number>(px.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < px.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = (px[i][0] - centres[c][0]) ** 2 + (px[i][1] - centres[c][1]) ** 2 + (px[i][2] - centres[c][2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) {
      const s = sums[assign[i]];
      s[0] += px[i][0];
      s[1] += px[i][1];
      s[2] += px[i][2];
      s[3]++;
    }
    centres = centres.map((c, i) => (sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : c));
  }
  const counts = centres.map(() => 0);
  for (const a of assign) counts[a]++;
  return centres
    .map((rgb, i) => ({ rgb: rgb.map(Math.round) as RGB, share: counts[i] / px.length }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

/** Foreground and background of a text box: the two clusters, background being the larger. */
export function textColors(data: Uint8ClampedArray | number[]): { fg: RGB; bg: RGB; ratio: number } | null {
  const [a, b] = kmeans(data, 2, 8);
  if (!a || !b) return null;
  return { fg: b.rgb, bg: a.rgb, ratio: contrastRatio(a.rgb, b.rgb) };
}
