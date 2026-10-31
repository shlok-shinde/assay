import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { stubAi } from "./helpers";

// A judge who opened the Round 2 app has this database in their browser. It is restored at its real
// schema, then the current build upgrades it on open: nothing may be lost and old Hallmarks must verify.
const file = JSON.parse(readFileSync("e2e/fixtures/round2-workspace.json", "utf8")) as {
  images: Record<string, string>;
  dump: { version: number; stores: Record<string, { keyPath: string | null; autoIncrement: boolean; indexes: { name: string; keyPath: string; unique: boolean; multiEntry: boolean }[]; rows: unknown[] }> };
};

function restore(page: Page) {
  const json = JSON.stringify(file.dump, (_k, v) => (typeof v === "string" && v.startsWith("@image:") ? file.images[v.slice(7)] : v));
  return page.evaluate(
    (text) =>
      new Promise<void>((resolve, reject) => {
        const dump = JSON.parse(text) as typeof file.dump;
        const del = indexedDB.deleteDatabase("assay");
        del.onerror = () => reject(del.error);
        del.onsuccess = () => {
          const open = indexedDB.open("assay", dump.version);
          open.onerror = () => reject(open.error);
          open.onupgradeneeded = () => {
            for (const [name, s] of Object.entries(dump.stores)) {
              const store = open.result.createObjectStore(name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
              for (const i of s.indexes) store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
            }
          };
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction([...db.objectStoreNames], "readwrite");
            for (const [name, s] of Object.entries(dump.stores)) for (const row of s.rows) tx.objectStore(name).put(row);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        };
      }),
    json,
  );
}

/** Row counts and how many version rows still hold a creative inline, read without the app's own code. */
const inspect = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ version: number; counts: Record<string, number>; inline: number; blobs: number }>((resolve, reject) => {
        const open = indexedDB.open("assay");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names);
          const counts: Record<string, number> = {};
          for (const n of names) tx.objectStore(n).count().onsuccess = (e) => (counts[n] = (e.target as IDBRequest<number>).result);
          const versions = tx.objectStore("versions").getAll();
          tx.oncomplete = () => {
            const inline = (versions.result as { image?: { dataUrl: string } }[]).filter((v) => v.image?.dataUrl).length;
            const version = db.version;
            db.close();
            resolve({ version, counts, inline, blobs: counts.blobs ?? 0 });
          };
        };
      }),
  );

test.describe("a Round 2 browser opens this build", () => {
  test.beforeEach(async ({ page }) => {
    await stubAi(page);
    // A plain file on the same origin: the app must not be running, or it would hold the database open.
    await page.goto("/label/manifest.json");
    await restore(page);
  });

  test("the upgrade adds tables and loses nothing", async ({ page }) => {
    const before = Object.fromEntries(Object.entries(file.dump.stores).map(([n, s]) => [n, s.rows.length]));
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible();
    await expect(page.getByText("Monsoon launch: Instagram post").first()).toBeVisible();
    await expect.poll(async () => (await inspect(page)).inline, { timeout: 30_000 }).toBe(0);
    const after = await inspect(page);
    expect(after.version).toBeGreaterThan(file.dump.version);
    for (const [name, n] of Object.entries(before)) {
      if (name === "meta" || name === "audit" || name === "aiLog") expect(after.counts[name]).toBeGreaterThanOrEqual(n);
      else expect(after.counts[name], name).toBe(n);
    }
    // Every version pointed at the same creative or two; each file is now kept once.
    expect(after.blobs).toBeGreaterThan(0);
    expect(after.blobs).toBeLessThan(before.versions);
  });

  test("old Hallmarks still verify, before and after the creatives move", async ({ page }) => {
    await page.goto("/app/hallmarks");
    await expect(page.getByText("#2 ·")).toBeVisible();
    await page.getByRole("link", { name: /Monsoon launch: Instagram post/ }).first().click();
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Verified: the content, the record and the chain all match their hashes.")).toBeVisible();
    await expect.poll(async () => (await inspect(page)).inline, { timeout: 30_000 }).toBe(0);
    await page.reload();
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Verified: the content, the record and the chain all match their hashes.")).toBeVisible();
  });

  test("the half-done draft still works: its creative shows and it can be re-checked", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("link", { name: /Monsoon launch: Instagram post/ }).first().click();
    await expect(page.getByRole("img").first()).toBeVisible();
    await page.goto("/app/new?sample=instagram-launch");
    await expect(page.locator("#copy")).toHaveValue(/OMG/);
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("tab", { name: /Findings 8/ })).toBeVisible({ timeout: 60_000 });
  });
});
