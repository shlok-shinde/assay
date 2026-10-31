// The layer underneath every team write. If it misses a write, a teammate never sees it; if it notes a write from the server,
// the browser sends it straight back. So: real Dexie, real transactions.
import { afterEach, describe, expect, it } from "vitest";
import { CHANGED_EVENT, captureChanges, FROM_SERVER } from "./capture";
import { AssayDB } from "./db";

let open: AssayDB | null = null;
const fresh = async () => {
  const d = new AssayDB(`capture-test-${Math.random()}`);
  captureChanges(d);
  await d.open();
  open = d;
  return d;
};
const settled = (d: AssayDB, n: number) => expect.poll(() => d.syncRows.count(), { timeout: 2000 }).toBe(n);

afterEach(async () => {
  await open?.delete();
  open = null;
});

const comment = (id: string) => ({ id, submissionId: "s", author: "a", role: "creator" as const, text: "t", at: "x" });

describe("Noting local writes", () => {
  it("notes single writes, and which row and operation", async () => {
    const d = await fresh();
    await d.comments.add(comment("c1"));
    await settled(d, 1);
    await d.comments.delete("c1");
    await settled(d, 2);
    const rows = await d.syncRows.orderBy("seq").toArray();
    expect(rows.map((r) => [r.tbl, r.rowId, r.op])).toEqual([["comments", "c1", "put"], ["comments", "c1", "delete"]]);
  });

  it("notes writes inside a store transaction that doesn't include syncRows", async () => {
    const d = await fresh();
    await d.transaction("rw", [d.comments, d.audit], async () => {
      await d.comments.bulkAdd([comment("c1"), comment("c2")]);
      await d.audit.add({ id: "a1", at: "x", actor: "a", role: "creator", action: "y", target: "z" });
    });
    await settled(d, 3);
  });

  it("notes nothing when the transaction rolls back", async () => {
    const d = await fresh();
    await d.transaction("rw", [d.comments], async () => {
      await d.comments.add(comment("c1"));
      throw new Error("no");
    }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    expect(await d.syncRows.count()).toBe(0);
  });

  it("leaves writes from the server alone", async () => {
    const d = await fresh();
    await d.transaction("rw", [d.comments], async (tx) => {
      (tx.idbtrans as unknown as Record<string, unknown>)[FROM_SERVER] = true;
      await d.comments.put(comment("c1"));
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(await d.syncRows.count()).toBe(0);
    expect(await d.comments.get("c1")).toBeTruthy();
  });

  it("leaves tables that don't travel alone, and says when something changed", async () => {
    const d = await fresh();
    let told = 0;
    const listen = () => told++;
    window.addEventListener(CHANGED_EVENT, listen);
    await d.meta.put({ key: "role", value: "creator" });
    await d.aiCache.put({ key: "k", task: "judge", model: "m", at: "x", data: {} });
    await new Promise((r) => setTimeout(r, 100));
    expect(await d.syncRows.count()).toBe(0);
    await d.comments.add(comment("c1"));
    await settled(d, 1);
    window.removeEventListener(CHANGED_EVENT, listen);
    expect(told).toBeGreaterThan(0);
  });
});
