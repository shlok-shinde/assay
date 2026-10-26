import { describe, expect, it } from "vitest";
import { db } from "./db";
import { ensureSeeded, resetDemo } from "./actions";

describe("workspace seeding", () => {
  it("seeds a fresh workspace with the kit, rulebook v3.2 and the demo history", async () => {
    await db.delete();
    await db.open();
    await ensureSeeded();
    expect(await db.kits.count()).toBe(1);
    expect((await db.rulebooks.toArray()).map((r) => r.version)).toEqual(["3.2"]);
    expect(await db.submissions.count()).toBe(30);
    expect(await db.meta.get("seededAt")).toBeTruthy();
  });

  it("reseeds after Reset demo, repeatedly", async () => {
    for (let i = 0; i < 5; i++) {
      await resetDemo();
      expect(await db.kits.count()).toBe(1);
      expect(await db.rulebooks.count()).toBe(1);
    }
  });
});
