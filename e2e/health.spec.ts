import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { freshWorkspace, role, stubAi } from "./helpers";

// The seeded demo history is fixed, so its ranking is too: MSG-01 is the most unclear rule and has no code
// patterns, VOICE-02 is next and does (a lexical rule), TERM-04 has plenty of findings and no pushback.
const TOP = "MSG-01";
const SECOND = "VOICE-02";

async function openHealth(page: Page, as: "Brand Admin" | "Creator" = "Brand Admin") {
  await freshWorkspace(page);
  if (as !== "Creator") await role(page, as);
  await page.goto("/app/health");
  await expect(page.getByText(/looks unclear/)).toBeVisible();
}

const ruleButton = (page: Page, id: string) => page.getByRole("button", { name: new RegExp(`^${id}`) });
const draftPanel = (page: Page, id: string) => page.getByRole("region", { name: `Clarification for ${id}` });
const toasts = (page: Page) => page.getByRole("status", { name: "Notifications" });

test.describe("Promise 3: one-click clarification", () => {
  test("the first sentence names the rule to reword, and its streak is sized from the score", async ({ page }) => {
    await stubAi(page);
    await openHealth(page);
    await expect(page.getByText(new RegExp(`Reword ${TOP} first: it looks unclear`))).toBeVisible();
    // The touchstone is an image with its score in words.
    const stone = page.getByRole("img", { name: /^Unclear score \d+ out of 100/ }).first();
    await expect(stone).toHaveAttribute("aria-label", /Unclear score 46 out of 100\. A rule counts as unclear from 25\./);
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    const streak = stone.locator("[data-bar]").first();
    const [stoneBox, streakBox] = [await stone.boundingBox(), await streak.boundingBox()];
    // 46 of 100 of the stone's inner width (the stone less 4px each side).
    expect(streakBox!.width / (stoneBox!.width - 8)).toBeGreaterThan(0.43);
    expect(streakBox!.width / (stoneBox!.width - 8)).toBeLessThan(0.49);
  });

  test("an AI draft is previewed in place, then one click publishes it, with Undo in the row", async ({ page }) => {
    await stubAi(page);
    await openHealth(page);
    await page.getByRole("button", { name: "Draft a clarification with AI" }).click();
    const panel = draftPanel(page, TOP);
    await expect(panel.getByText("Drafted by AI (stub-model)")).toBeVisible();
    // The preview: the version it becomes, before and after, and what stays pinned.
    await expect(panel.getByText(/Publishing makes a new rulebook version, v3\.3, that differs from v3\.2 by this one rule/)).toBeVisible();
    await expect(panel.getByText("Now, in v3.2")).toBeVisible();
    await expect(panel.getByText("After, in v3.3")).toBeVisible();
    await expect(panel.getByText("A calm launch line that names the product.")).toBeVisible();
    await expect(panel.getByText("No draft is in progress in this browser, so none stays on an old version.")).toBeVisible();
    // MSG-01 has no phrases matched in code, so there is no code note to make.
    await expect(panel.getByText(/code patterns won't change/)).toHaveCount(0);

    await panel.getByRole("button", { name: "Publish as v3.3" }).click();
    await expect(toasts(page)).toContainText(`Published v3.3: ${TOP} is reworded`);
    const row = page.getByRole("row").filter({ hasText: /Reworded in v3\.3/ });
    await expect(row).toBeVisible();
    await expect(draftPanel(page, TOP)).toHaveCount(0);

    // Undo restores the earlier version by publishing it again: v3.4, with the old wording.
    await row.getByRole("button", { name: "Undo (restore v3.2)" }).click();
    await expect(page.getByText(/Undone: v3\.4 restores v3\.2/)).toBeVisible();
    await page.goto("/app/kit?tab=versions");
    const v34 = page.locator("[data-version='3.4']");
    await expect(v34).toContainText("Rolled back to v3.2");
    await expect(page.locator("[data-version='3.3']")).toContainText("Clarification");
    await expect(page.locator("[data-version='3.3']")).toContainText("AI (stub-model)");
    await expect(page.locator("[data-version='3.3']")).toContainText("Most pushback was about where the line sits");
    await expect(page.locator("[data-version='3.3']")).toContainText(TOP);
  });

  test("a rule with phrases matched in code says its word-matching findings keep firing", async ({ page }) => {
    await stubAi(page);
    await openHealth(page);
    await ruleButton(page, SECOND).click();
    await page.getByRole("button", { name: "Use the template as a draft" }).click();
    const panel = draftPanel(page, SECOND);
    await expect(panel.getByText("This rule's code patterns won't change, so its word-matching findings keep firing.")).toBeVisible();
    // The template starts from the current wording, so there is nothing to publish until it is edited.
    await expect(panel.getByRole("button", { name: "Publish as v3.3" })).toBeDisabled();
    await expect(panel.getByText("Nothing would change yet: edit the wording above first.")).toBeVisible();
    const text = panel.getByLabel("Clarified rule text");
    await text.fill(`${await text.inputValue()} A single exclamation mark in a launch post is fine.`);
    await expect(panel.getByRole("button", { name: "Publish as v3.3" })).toBeEnabled();
    await expect(panel.getByText("Drafted by Template, then edited")).toBeVisible();
  });

  test("drafts in progress are listed as staying on the version they started on", async ({ page }) => {
    await stubAi(page);
    await freshWorkspace(page);
    await page.goto("/app/new?sample=linkedin-clean");
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("R&D update: LinkedIn post", { timeout: 60_000 });
    await role(page, "Brand Admin");
    await page.goto("/app/health");
    await page.getByRole("button", { name: "Use the template as a draft" }).click();
    const panel = draftPanel(page, TOP);
    await expect(panel.getByText("R&D update: LinkedIn post")).toBeVisible();
    await expect(panel.getByText("stays on v3.2")).toBeVisible();
  });

  test("only a Brand Admin can publish, and the page says so", async ({ page }) => {
    await stubAi(page);
    await openHealth(page, "Creator");
    await page.getByRole("button", { name: "Draft a clarification with AI" }).click();
    const panel = draftPanel(page, TOP);
    await expect(panel.getByRole("button", { name: "Publish as v3.3" })).toBeDisabled();
    await expect(panel.getByText("Only a Brand Admin can publish. Switch to Brand Admin in the top bar to publish this.")).toBeVisible();
  });

  test("with no AI key drafting is off and says why, and the template suggestion still works", async ({ page }) => {
    await stubAi(page, "off");
    await openHealth(page);
    const ask = page.getByRole("button", { name: "Draft a clarification with AI" });
    await expect(ask).toBeDisabled();
    await expect(page.getByText(/No AI key is set on this deployment, so drafting with the AI is off\./)).toBeVisible();
    await page.getByRole("button", { name: "Use the template as a draft" }).click();
    await expect(draftPanel(page, TOP).getByText("Drafted by Template, then edited")).toBeVisible();
    // Nothing was invented: no AI draft appeared.
    await expect(page.getByText(/Drafted by AI/)).toHaveCount(0);
  });

  test("a draft never carries over to another rule (the wrong-rule bug)", async ({ page }) => {
    await stubAi(page);
    await openHealth(page);
    // Start a draft on the first rule and change its wording...
    await page.getByRole("button", { name: "Use the template as a draft" }).click();
    const first = draftPanel(page, TOP);
    await first.getByLabel("Clarified rule text").fill("Wording meant only for the first rule.");
    await expect(first.getByRole("button", { name: "Publish as v3.3" })).toBeEnabled();

    // ...then open another rule: the draft is gone, and so is the way to publish it.
    await ruleButton(page, SECOND).click();
    await expect(draftPanel(page, TOP)).toHaveCount(0);
    await expect(draftPanel(page, SECOND)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Publish as/ })).toHaveCount(0);
    await expect(page.getByText("Wording meant only for the first rule.")).toHaveCount(0);

    // Publishing on the second rule changes that rule and nothing else.
    await page.getByRole("button", { name: "Draft a clarification with AI" }).click();
    await draftPanel(page, SECOND).getByRole("button", { name: "Publish as v3.3" }).click();
    await expect(page.getByText(/Reworded in v3\.3/)).toBeVisible();
    await page.goto("/app/kit?tab=versions");
    const v33 = page.locator("[data-version='3.3']");
    await expect(v33).toContainText(`Changed ${SECOND}.`);
    await expect(v33).not.toContainText(TOP);
    await page.goto("/app/kit?tab=rules");
    await page.getByRole("button", { name: new RegExp(`^${TOP}`) }).click();
    await expect(page.getByLabel("Rule text")).not.toHaveValue(/Wording meant only for the first rule/);
  });

  test("the Brand Kit's version list shows provenance and rolls back from a confirmation", async ({ page }) => {
    await stubAi(page);
    await openHealth(page);
    await page.getByRole("button", { name: "Draft a clarification with AI" }).click();
    await draftPanel(page, TOP).getByRole("button", { name: "Publish as v3.3" }).click();
    await expect(page.getByText(/Reworded in v3\.3/)).toBeVisible();
    await page.goto("/app/kit?tab=versions");
    // The seeded version cannot be rolled back to from itself, the older one can.
    await expect(page.locator("[data-version='3.3']").getByRole("button", { name: /Roll back/ })).toHaveCount(0);
    await page.locator("[data-version='3.2']").getByRole("button", { name: "Roll back to v3.2" }).click();
    const dialog = page.getByRole("dialog", { name: "Roll back to v3.2?" });
    await expect(dialog).toContainText("Nothing is deleted");
    await dialog.getByRole("button", { name: "Roll back to v3.2" }).click();
    await expect(page.locator("[data-version='3.4']")).toContainText("Restores the content of v3.2. Nothing was deleted.");
    await expect(page.locator("[data-version='3.3']")).toBeVisible();
  });
});

test.describe("The acceptance rate", () => {
  /** Writes fix events the way the store does, straight into the workspace's IndexedDB, then reloads. */
  async function seedEvents(page: Page) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const at = (n: number) => `2026-10-30T10:0${n}:00.000Z`;
          const ev = (id: string, n: number, kind: string, ruleId: string, findingId: string, extra: object = {}) => ({ id, at: at(n), kind, ruleId, findingId, submissionId: "s1", role: "creator", ...extra });
          const rows = [
            // TERM-04: three fixes offered. One accepted, one dismissed, one accepted and then undone: n is 2, half accepted.
            ev("e1", 0, "offered", "TERM-04", "f1"),
            ev("e2", 1, "accepted", "TERM-04", "f1"),
            ev("e3", 0, "offered", "TERM-04", "f2"),
            ev("e4", 1, "dismissed", "TERM-04", "f2"),
            ev("e5", 0, "offered", "TERM-04", "f3"),
            ev("e6", 1, "accepted", "TERM-04", "f3"),
            ev("e7", 2, "undone", "TERM-04", "f3"),
            // CLAIM-01: only a test browser's decisions, which are left out.
            ev("e8", 0, "offered", "CLAIM-01", "f4", { automated: true }),
            ev("e9", 1, "accepted", "CLAIM-01", "f4", { automated: true }),
          ];
          const open = indexedDB.open("assay");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("events", "readwrite");
            rows.forEach((r) => tx.objectStore("events").put(r));
            tx.oncomplete = () => (db.close(), resolve());
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await page.reload();
  }

  test("counts decided fixes with their n, leaves automated runs out, and shows a dash where nothing is decided", async ({ page }) => {
    await stubAi(page);
    await openHealth(page);
    await seedEvents(page);
    await expect(page.getByText(/looks unclear/)).toBeVisible();
    const term = page.getByRole("row", { name: /TERM-04/ });
    await expect(term).toContainText("50%");
    await expect(term).toContainText("n 2");
    // Only automated decisions: no rate, a dash, and the words for it.
    const claim = page.getByRole("row", { name: /CLAIM-01/ });
    await expect(claim).toContainText("no fixes decided yet");
    await expect(claim).not.toContainText("%");
    await expect(page.getByText(/Automated test runs are left out of the acceptance rate/)).toBeVisible();
    // Open the rule: the same figure in words, with what was accepted and what was not decided.
    await ruleButton(page, "TERM-04").click();
    const note = page.locator("[data-clarify='TERM-04'] [data-acceptance='TERM-04']");
    await expect(note).toContainText("50%");
    await expect(note).toContainText("n 2: 1 accepted or lightly edited, 1 not decided");
    await expect(note).toContainText("Automated test runs are left out.");
    await ruleButton(page, "CLAIM-01").click();
    await expect(page.locator("[data-clarify='CLAIM-01'] [data-acceptance='CLAIM-01']")).toContainText("no fixes decided yet");
  });

  test("shows in the rule's detail in the Brand Kit", async ({ page }) => {
    await stubAi(page);
    await openHealth(page);
    await seedEvents(page);
    await page.goto("/app/kit?tab=rules");
    await page.getByRole("button", { name: /^TERM-04/ }).click();
    const note = page.locator("[data-acceptance='TERM-04']");
    await expect(note).toContainText("50%");
    await expect(note).toContainText("n 2");
    await page.getByRole("button", { name: /^TERM-05/ }).click();
    await expect(page.locator("[data-acceptance='TERM-05']")).toContainText("no fixes decided yet");
  });
});

test("Guideline Health has no serious or critical accessibility violations, with a draft open", async ({ page }) => {
  await stubAi(page);
  await openHealth(page);
  await page.getByRole("button", { name: "Draft a clarification with AI" }).click();
  await expect(draftPanel(page, TOP).getByRole("button", { name: "Publish as v3.3" })).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
});
