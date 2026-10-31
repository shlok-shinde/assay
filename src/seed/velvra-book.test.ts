import { beforeAll, describe, expect, it } from "vitest";
import { pdfText } from "@/lib/parse";
import { BOOK, bookParagraph, citationFor, compareText } from "@/lib/book";
import { CHANNEL_LIMITS, VELVRA_FACTS, VELVRA_RULES } from "./velvra";

// The book cites itself: each paragraph claims a page, and the rules claim a page and a section.
// These tests read the real PDF, so a layout change that moves a paragraph fails here.
let pageText: Map<number, string>;

beforeAll(async () => {
  const buffer = await (await fetch(BOOK.file)).arrayBuffer();
  const { text, pages } = await pdfText(buffer);
  pageText = new Map(pages.map((p) => [p.page, compareText(text.slice(p.start, p.end))]));
});

describe("the Velvra Brand Book", () => {
  it("has the pages it says it has", () => {
    expect(pageText.size).toBe(28);
    expect(BOOK.pages.map((p) => p.page)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
  });

  it("prints every paragraph on the page it claims", () => {
    const missing: string[] = [];
    for (const page of BOOK.pages) {
      for (const b of page.blocks) {
        if (b.id && !pageText.get(page.page)!.includes(compareText(b.text))) missing.push(b.id);
      }
    }
    expect(missing).toEqual([]);
  });

  it("gives every paragraph a unique id", () => {
    const ids = BOOK.pages.flatMap((p) => p.blocks.flatMap((b) => (b.id ? [b.id] : [])));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cites each rule at its page and section, in the rule's own words", () => {
    for (const rule of VELVRA_RULES) {
      const citation = citationFor(rule.id);
      expect(citation, rule.id).toBeTruthy();
      expect(citation!.page, rule.id).toBe(rule.source.page);
      expect(`§${citation!.section}`, rule.id).toBe(rule.source.section);
      expect(compareText(citation!.text), rule.id).toBe(compareText(rule.text));
    }
  });

  it("registers each Claim Ledger fact with its statement, wording, owner, source and dates", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = (iso: string) => `${Number(iso.slice(8))} ${months[Number(iso.slice(5, 7)) - 1]}`;
    for (const fact of VELVRA_FACTS) {
      const citation = citationFor(fact.id);
      expect(citation, fact.id).toBeTruthy();
      expect(compareText(citation!.text), fact.id).toBe(compareText(fact.statement));
      expect([25, 26, 27]).toContain(citation!.page);
      const page = pageText.get(citation!.page)!;
      expect(page, fact.id).toContain(compareText(`Approved wording: ${fact.approvedWording}`));
      expect(page, fact.id).toContain(compareText(`Owner: ${fact.owner}. Source: ${fact.source}.`));
      if (fact.footnote) expect(page, fact.id).toContain(compareText(`Footnote: ${fact.footnote}`));
      if (fact.validTo) expect(page, fact.id).toContain(compareText(`to ${day(fact.validTo)} ${fact.validTo.slice(0, 4)}`));
    }
  });

  it("states the channel limits the engine enforces", () => {
    const count = (n: number, one: string, many = `${one}s`) => (n === 0 ? `no ${many}` : `${n} ${n === 1 ? one : many}`);
    for (const [channel, l] of Object.entries(CHANNEL_LIMITS)) {
      const text = citationFor(`LIMIT-${channel}`)!.text;
      const emoji = l.maxEmoji === 0 ? "no emoji" : `${l.maxEmoji} emoji`;
      expect(text, channel).toContain(`${emoji}, ${count(l.maxExclamation, "exclamation mark")}, ${count(l.maxCapsWords, "all-caps word")}, reading score ${l.readabilityMin} or higher`);
    }
  });

  it("looks paragraphs up, and refuses unknown ones", () => {
    expect(bookParagraph("p18-6.1-1")?.page).toBe(18);
    expect(bookParagraph("nope")).toBeUndefined();
    expect(citationFor("NOPE-1")).toBeUndefined();
  });
});
