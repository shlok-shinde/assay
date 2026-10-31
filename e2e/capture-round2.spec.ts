import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { freshWorkspace, role, ruleCard, stubAi } from "./helpers";

// Run once, against the Round 2 build (tag round-2-final), to record what a judge's browser really
// holds: E2E_CAPTURE=1 pnpm e2e capture-round2. e2e/upgrade.spec.ts restores the file at schema v1.
test.skip(!process.env.E2E_CAPTURE, "Only run against the Round 2 build, with E2E_CAPTURE=1");

test("capture a Round 2 workspace", async ({ page }) => {
  test.setTimeout(240_000);
  await stubAi(page);
  await freshWorkspace(page);

  // A draft taken all the way to a Hallmark, with an image and a fix version.
  await page.goto("/app/new?sample=instagram-launch");
  await expect(page.locator("#copy")).toHaveValue(/OMG/);
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByRole("tab", { name: /Findings 8/ })).toBeVisible({ timeout: 60_000 });
  await ruleCard(page, "CLAIM-01").getByRole("button", { name: "Accept" }).click();
  await ruleCard(page, "CLAIM-03").getByRole("button", { name: "Accept" }).click();
  await ruleCard(page, "TERM-04").getByRole("button", { name: "Accept" }).click();
  const tone = ruleCard(page, "VOICE-02");
  await tone.getByRole("button", { name: "Dismiss with reason" }).click();
  await tone.getByRole("textbox").fill("Launch-day post, playful tone agreed with the brand lead");
  await tone.getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("button", { name: "Apply 3 fixes" }).click();
  await expect(page.getByRole("tab", { name: /Versions 2/ })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("2 claims wait for Compliance")).toBeVisible();
  await role(page, "Compliance");
  await page.getByRole("button", { name: "Approve claim" }).first().click();
  await page.getByRole("button", { name: "Approve claim" }).first().click();
  await expect(page.getByRole("button", { name: "Approve claim" })).toHaveCount(0);
  await role(page, "Reviewer");
  await page.getByLabel(/Reason to approve with them open/).fill("Creative already printed; corrected version ships next week");
  await page.getByRole("button", { name: /^Approve with \d+ open$/ }).click();
  await expect(page.getByRole("heading", { name: "Hallmark #1" })).toBeVisible();

  // A second Hallmark chained to the first, and a draft left half done.
  await role(page, "Creator");
  await page.goto("/app/new?sample=linkedin-clean");
  await expect(page.locator("#copy")).toHaveValue(/R&D team/);
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByRole("tab", { name: /Findings \d+/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("button", { name: "Submit for review" }).click();
  await role(page, "Reviewer");
  await page.getByRole("button", { name: /^Approve/ }).click();
  await expect(page.getByRole("heading", { name: "Hallmark #2" })).toBeVisible();
  await role(page, "Creator");
  await page.goto("/app/new?sample=genz-caption");
  await expect(page.locator("#copy")).toHaveValue(/lowkey/);
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByText("VOICE-02").first()).toBeVisible({ timeout: 60_000 });

  const dump = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("assay");
        open.onerror = () => reject(open.error);
        open.onsuccess = async () => {
          const db = open.result;
          const stores: Record<string, unknown> = {};
          const tx = db.transaction([...db.objectStoreNames]);
          await Promise.all(
            [...db.objectStoreNames].map(
              (name) =>
                new Promise<void>((done) => {
                  const s = tx.objectStore(name);
                  const req = s.getAll();
                  req.onsuccess = () => {
                    stores[name] = {
                      keyPath: s.keyPath,
                      autoIncrement: s.autoIncrement,
                      indexes: [...s.indexNames].map((i) => ({ name: i, keyPath: s.index(i).keyPath, unique: s.index(i).unique, multiEntry: s.index(i).multiEntry })),
                      rows: req.result,
                    };
                    done();
                  };
                }),
            ),
          );
          const version = db.version;
          db.close();
          resolve({ version, stores });
        };
      }),
  );

  // A creative is about a megabyte and every version repeats it, so the file keeps each one once.
  const images: Record<string, string> = {};
  const json = JSON.stringify(dump, (_k, v) => {
    if (typeof v === "string" && v.startsWith("data:") && v.length > 1000) {
      const h = createHash("sha256").update(v).digest("hex");
      images[h] = v;
      return `@image:${h}`;
    }
    return v;
  });
  mkdirSync("e2e/fixtures", { recursive: true });
  writeFileSync("e2e/fixtures/round2-workspace.json", JSON.stringify({ capturedFrom: "round-2-final (de7c9c3)", capturedAt: new Date().toISOString(), images, dump: JSON.parse(json) }));
});
