import { describe, expect, it } from "vitest";
import type { Fact, NotificationRow, Owner } from "@/lib/types";
import { VELVRA_KIT } from "@/seed/velvra";
import { alertMailto, buildAlertModel, daysUntil, stripGeometry, whenWords } from "./alerts";
import { nextFactId, nextRuleId, normaliseHex } from "./kit-helpers";
import { BATCH, pickBatch } from "./label-batch";

const fact = (id: string, owner: string, validTo?: string, validFrom?: string): Fact => ({ id, statement: `Statement ${id}`, approvedWording: "", inlineWording: "", kind: "spec", quantities: [], keywords: [], triggers: [], owner, source: "Brief 1", validFrom, validTo });
const note = (factId: string, validTo: string, threshold: number, at: string, readAt?: string): NotificationRow => ({ id: `n_${factId}_${threshold}`, key: `${factId}|${validTo}|${threshold}`, factId, ownerId: "x", threshold, at, readAt });

describe("The expiry inbox's model", () => {
  const today = "2026-10-31";
  const facts = [fact("F-1", "Marketing", "2026-11-20", "2026-09-15"), fact("F-2", "Marketing Insights", "2025-06-30"), fact("F-3", "Legal", "2027-03-31")];
  const owners: Owner[] = [{ id: "marketing", name: "Marketing", email: "marketing@velvra.example", simulated: true }];

  it("works days out from today, in words", () => {
    expect(daysUntil("2026-11-20", today)).toBe(20);
    expect(daysUntil("2025-06-30", today)).toBe(-488);
    expect(whenWords(20)).toBe("expires in 20 days");
    expect(whenWords(1)).toBe("expires in 1 day");
    expect(whenWords(0)).toBe("expires today");
    expect(whenWords(-1)).toBe("expired 1 day ago");
  });

  it("groups by owner, soonest first, one row per fact however many notices it has", () => {
    const rows = [note("F-1", "2026-11-20", 30, "2026-10-21T08:00:00Z"), note("F-1", "2026-11-20", 14, "2026-11-06T08:00:00Z", "2026-11-07T08:00:00Z"), note("F-2", "2025-06-30", 0, "2026-10-30T08:00:00Z")];
    const m = buildAlertModel(rows, owners, facts, today);
    expect(m.groups.map((g) => g.owner.name)).toEqual(["Marketing Insights", "Marketing"]);
    const marketing = m.groups[1];
    expect(marketing.items).toHaveLength(1);
    expect(marketing.items[0].notices).toHaveLength(2);
    expect(marketing.items[0].daysLeft).toBe(20);
    // A known owner keeps its address; one never seen has none, and is asked for it.
    expect(marketing.owner.simulated).toBe(true);
    expect(m.groups[0].owner.email).toBe("");
    // The sidebar's number counts facts with something unread, not notices.
    expect(m.unread).toBe(2);
    // The nearest expiry that has raised nothing.
    expect(m.next?.fact.id).toBe("F-3");
  });

  it("leaves out a notice once its fact was renewed or removed", () => {
    const renewed = [fact("F-1", "Marketing", "2027-01-31")];
    const rows = [note("F-1", "2026-11-20", 30, "2026-10-21T08:00:00Z"), note("F-9", "2026-11-20", 30, "2026-10-21T08:00:00Z")];
    const m = buildAlertModel(rows, owners, renewed, today);
    expect(m.groups).toEqual([]);
    expect(m.resolved).toBe(2);
    expect(m.unread).toBe(0);
  });

  it("puts today on the strip between its ends, and past the end once expired", () => {
    const live = stripGeometry("2026-09-15", "2026-11-20", today);
    expect(live.start).toBe(0);
    expect(live.end).toBe(100);
    expect(live.now).toBeCloseTo((46 / 66) * 100, 5);
    expect(live.expired).toBe(false);
    const gone = stripGeometry("2024-07-01", "2025-06-30", today);
    expect(gone.expired).toBe(true);
    expect(gone.now).toBe(100);
    expect(gone.end).toBeLessThan(100);
    // With no start date, the strip shows the 30 days before expiry.
    const bare = stripGeometry(undefined, "2026-11-20", today);
    expect(bare.hasFrom).toBe(false);
    expect(bare.now).toBeCloseTo((10 / 30) * 100, 5);
  });

  it("writes the alert as a mail with subject and body filled in", () => {
    const href = alertMailto(facts[0], 20, "a.b+c@x.test", "Northwind");
    expect(href.startsWith("mailto:a.b%2Bc%40x.test?subject=")).toBe(true);
    const query = new URLSearchParams(href.split("?")[1]);
    expect(query.get("subject")).toBe("Northwind Claim Ledger: F-1 expires in 20 days");
    expect(query.get("body")).toContain("F-1: Statement F-1");
    expect(query.get("body")).toContain("Valid to 2026-11-20, so it expires in 20 days.");
  });
});

describe("Brand Kit editors' rules", () => {
  it("reads a hex code or says it is not one", () => {
    expect(normaliseHex("#b8860b")).toBe("#B8860B");
    expect(normaliseHex(" #abc ")).toBe("#AABBCC");
    for (const bad of ["", "b8860b", "#12345", "#1234567", "#ggg", "rgb(0,0,0)", "banana"]) expect(normaliseHex(bad), bad).toBeNull();
  });

  it("numbers rules and facts past whatever has been deleted", () => {
    expect(nextRuleId([], "TERM")).toBe("TERM-01");
    expect(nextRuleId([{ id: "TERM-01" }, { id: "TERM-04" }, { id: "VOICE-09" }], "TERM")).toBe("TERM-05");
    expect(nextFactId([])).toBe("F-101");
    expect(nextFactId([{ id: "F-120" }, { id: "F-101" }])).toBe("F-121");
  });
});

describe("The labelling page's next set", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}` }));

  it("skips what this person did, takes the fewest labels first, then manifest order", () => {
    const set = pickBatch(items, { d0: 3, d1: 3, d2: 1 }, new Set(["d5"]), 5);
    // d3, d4, d6, d7 have no labels (d5 is done); then d2 has one.
    expect(set).toEqual(["d3", "d4", "d6", "d7", "d8"]);
    const rest = pickBatch(items, { d0: 3, d1: 3, d2: 1 }, new Set(items.slice(3).map((i) => i.id)), 5);
    expect(rest).toEqual(["d2", "d0", "d1"]);
  });

  it("hands out twenty at a time, and nothing once everything is done", () => {
    expect(BATCH).toBe(20);
    expect(pickBatch(items, {}, new Set())).toHaveLength(20);
    expect(pickBatch(items, {}, new Set(items.map((i) => i.id)))).toEqual([]);
  });
});

describe("The starter rules and the Velvra seed stay apart", () => {
  it("has no owner or fact id clash", () => {
    expect(nextFactId(VELVRA_KIT.facts)).toBe("F-126");
  });
});
