import { describe, expect, it } from "vitest";
import { clauses, findPhrases, paragraphs, sentences, stems } from "./text";
import { findQuantities, sameAmount } from "./quantities";
import { readability, syllables } from "./readability";
import { buildIndex, search } from "./bm25";
import { VELVRA_KIT } from "@/seed/velvra";

describe("text helpers", () => {
  it("finds whole-word phrases, longest first, without overlaps", () => {
    const hits = findPhrases("The best, the bestest and THE BEST serum", ["the best", "best"]);
    expect(hits.map((h) => h.text)).toEqual(["The best", "THE BEST"]);
  });

  it("does not split sentences after 'No.' before a number", () => {
    const s = sentences("We are No. 1 in India. Shop now!");
    expect(s.map((x) => x.text)).toEqual(["We are No. 1 in India.", "Shop now!"]);
  });

  it("splits clauses on conjunction commas and keeps offsets", () => {
    const text = "It sits light on skin, and our panel says it leaves no white cast.";
    const [s] = sentences(text);
    const cs = clauses(s);
    expect(cs).toHaveLength(2);
    expect(text.slice(cs[1].start, cs[1].end)).toBe(cs[1].text);
    expect(cs[1].text.startsWith(", and")).toBe(true);
  });

  it("splits paragraphs on blank lines", () => {
    expect(paragraphs("One.\nStill one.\n\nTwo.").map((p) => p.text)).toEqual(["One.\nStill one.", "Two."]);
  });

  it("stems simple plurals and -ing forms", () => {
    expect(stems("Running studies of spots")).toEqual(["runn", "studi", "spot"]);
  });
});

describe("quantities", () => {
  it("parses percentages, rupees, ml, SPF, n and durations with offsets", () => {
    const text = "82% of 40 participants, ₹649 for 50 ml, SPF 50, in just 7 days or two weeks";
    const q = findQuantities(text);
    expect(q.map((x) => `${x.value}${x.unit}`)).toEqual(["82percent", "40n", "649inr", "50ml", "50spf", "7day", "2week"]);
    for (const x of q) expect(text.slice(x.start, x.end)).toBe(x.raw);
  });

  it("compares durations across units", () => {
    expect(sameAmount({ value: 4, unit: "week" }, { value: 28, unit: "day" })).toBe(true);
    expect(sameAmount({ value: 4, unit: "week" }, { value: 7, unit: "day" })).toBe(false);
    expect(sameAmount({ value: 40, unit: "minute" }, { value: 40, unit: "day" })).toBe(false);
  });
});

describe("readability", () => {
  it("counts syllables roughly like Flesch expects", () => {
    expect(syllables("the")).toBe(1);
    expect(syllables("protection")).toBe(3);
    expect(syllables("everyday")).toBeGreaterThanOrEqual(3);
  });

  it("scores simple text higher than dense text", () => {
    const simple = readability("We make sunscreen. It is light. Wear it every day.");
    const dense = readability("Comprehensive photoprotective formulations necessitate meticulous dermatological evaluation methodologies.");
    expect(simple.flesch).toBeGreaterThan(dense.flesch);
  });
});

describe("BM25", () => {
  it("ranks the shipping fact first for a shipping clause", () => {
    const index = buildIndex(VELVRA_KIT.facts, VELVRA_KIT.synonyms);
    expect(search(index, "Orders over ₹499 ship free")[0].id).toBe("F-120");
  });

  it("uses synonyms so 'dark spots' finds the even-tone study", () => {
    const index = buildIndex(VELVRA_KIT.facts, VELVRA_KIT.synonyms);
    expect(search(index, "fades dark spots")[0].id).toBe("F-112");
  });
});
