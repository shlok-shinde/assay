// Flesch reading ease, computed in TypeScript (no external service).
import { sentences, words } from "./text";

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export interface Readability {
  words: number;
  sentences: number;
  syllables: number;
  flesch: number;
}

export function readability(text: string): Readability {
  const ws = words(text).filter((w) => /\p{L}/u.test(w.text));
  const ss = sentences(text).filter((s) => words(s.text).length > 0);
  const syl = ws.reduce((n, w) => n + syllables(w.text), 0);
  const wc = Math.max(1, ws.length);
  const sc = Math.max(1, ss.length);
  const flesch = 206.835 - 1.015 * (wc / sc) - 84.6 * (syl / wc);
  return { words: ws.length, sentences: ss.length, syllables: syl, flesch: Math.round(flesch * 10) / 10 };
}
