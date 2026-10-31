import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { freshWorkspace, stubAi } from "./helpers";

const switcher = (page: Page) => page.getByRole("button", { name: /Switch brand/ });
const toasts = (page: Page) => page.getByRole("status", { name: "Notifications" });

/** Adds a brand from the set-up screen and waits until Assay has reloaded onto it and landed on its checklist. */
async function addBrand(page: Page, name: string) {
  await page.goto("/app/setup");
  await expect(page.getByRole("heading", { name: "Add a brand", level: 1 })).toBeVisible();
  await page.getByLabel("Brand name").fill(name);
  await page.getByRole("button", { name: "Create brand and switch to it" }).click();
  await expect(page.getByRole("heading", { name: `Set up ${name}`, level: 1 })).toBeVisible({ timeout: 30_000 });
}

/** A draft from scratch, checked by rule checks only. */
async function check(page: Page, d: { title: string; channel: string; text: string }) {
  await page.goto("/app/new");
  await page.locator("#title").fill(d.title);
  await page.locator("#channel").selectOption(d.channel);
  await page.locator("#copy").fill(d.text);
  await page.locator("#intent-goal").fill("Tell people about it");
  await page.locator("#intent-keyMessage").fill("A new thing");
  await page.getByLabel("I confirm this is what the draft is for").check();
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(d.title, { timeout: 60_000 });
}

test.describe("Brands", () => {
  test.beforeEach(async ({ page }) => {
    await stubAi(page, "off");
  });

  test("a new brand opens on its own starter rules with none of Velvra in it, and its rules fire", async ({ page }) => {
    await freshWorkspace(page);
    await addBrand(page, "Northwind Test");

    // The shell is the new brand's: its name, its rulebook, and none of the demo's helpers.
    await expect(switcher(page)).toContainText("Northwind Test");
    await expect(switcher(page)).toContainText("Rulebook v1.0");
    await expect(page.getByRole("button", { name: "Reset demo" })).toHaveCount(0);
    await expect(page.getByText("Judge path")).toHaveCount(0);
    await expect(page.getByText("demo data in this browser")).toHaveCount(0);

    // Its starter rules check a draft: a guarantee fires CLAIM-02, a vague link fires A11Y-02.
    await check(page, { title: "Spring sale", channel: "email", text: "Results guaranteed on every order. Click here to shop." });
    for (const id of ["CLAIM-02", "A11Y-02"]) await expect(page.getByText(id).first()).toBeVisible({ timeout: 60_000 });

    // And nothing on any screen belongs to Velvra. (The set-up screen lists the demo among the brands in this browser, by name.)
    for (const path of ["/app", "/app/new", "/app/kit?tab=rules", "/app/kit?tab=facts", "/app/kit?tab=terms", "/app/kit?tab=assets", "/app/kit?tab=import", "/app/kit?tab=versions", "/app/health", "/app/review", "/app/hallmarks", "/app/inbox"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("#main")).toBeVisible();
      await expect(page.locator("body"), path).not.toContainText(/velvra|daily shield|sunscreen|dermatologist/i);
    }
  });

  test("switching back to the demo keeps the demo's data, and the new brand keeps its own", async ({ page }) => {
    await stubAi(page);
    await freshWorkspace(page);
    // Some work in the demo: a checked draft.
    await page.goto("/app/new?sample=instagram-launch");
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Monsoon launch: Instagram post", { timeout: 60_000 });

    await addBrand(page, "Northwind Test");
    await page.goto("/app");
    await expect(page.getByText("No drafts yet. Paste your first draft on the New draft screen.")).toBeVisible();
    await expect(page.getByText("Monsoon launch")).toHaveCount(0);
    await check(page, { title: "Northwind post", channel: "instagram", text: "Guaranteed to work." });

    // Back to the demo from the switcher.
    await switcher(page).click();
    const brands = page.getByRole("group", { name: "Brands in this browser" });
    await expect(brands.getByRole("button", { name: "Northwind Test", exact: true })).toHaveAttribute("aria-current", "true");
    await brands.getByRole("button", { name: "Velvra · demo", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(switcher(page)).toContainText("Velvra");
    await expect(switcher(page)).toContainText("demo data in this browser");
    await expect(page.getByRole("link", { name: /Monsoon launch: Instagram post/ })).toBeVisible();
    await expect(page.getByText("Northwind post")).toHaveCount(0);
    // The demo's helpers are back, and its seeded history is whole.
    await expect(page.getByRole("button", { name: "Reset demo" })).toBeVisible();
    await expect(page.getByText("Judge path")).toBeVisible();
    await page.goto("/app/health");
    await expect(page.getByText(/looks unclear/)).toBeVisible();
    await expect(page.getByText(/Based on 30 seeded demo reviews/)).toBeVisible();

    // And the new brand still has its own draft.
    await switcher(page).click();
    await page.getByRole("group", { name: "Brands in this browser" }).getByRole("button", { name: "Northwind Test", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: /Northwind post/ })).toBeVisible();
  });

  test("the set-up checklist shows real completion and links to the Brand Kit's tabs", async ({ page }) => {
    await freshWorkspace(page);
    await addBrand(page, "Northwind Test");
    await expect(page.getByText("0 of 4 done")).toBeVisible();
    const steps = ["words", "palette", "facts", "rules"];
    for (const id of steps) await expect(page.locator(`[data-step='${id}']`)).not.toHaveAttribute("data-done", "");
    await expect(page.locator("[data-step='words']").getByRole("link", { name: /Add words/ })).toHaveAttribute("href", "/app/kit?tab=terms");
    await expect(page.locator("[data-step='palette']").getByRole("link", { name: /Add colours/ })).toHaveAttribute("href", "/app/kit?tab=assets");
    await expect(page.locator("[data-step='facts']").getByRole("link", { name: /Add facts/ })).toHaveAttribute("href", "/app/kit?tab=facts");
    await expect(page.locator("[data-step='rules']").getByRole("link", { name: /Edit rules/ })).toHaveAttribute("href", "/app/kit?tab=rules");

    // Add one of each in the Brand Kit, and the checklist follows.
    await page.getByRole("link", { name: /Add words/ }).click();
    const addTerm = page.getByRole("form", { name: "Add a term" });
    await addTerm.getByLabel("Not this (comma-separated)").fill("sun cream");
    await addTerm.getByLabel("Say this").fill("sunscreen");
    await addTerm.getByRole("button", { name: "Add term" }).click();
    await expect(toasts(page)).toContainText("Added TERM-01.");

    await page.goto("/app/kit?tab=assets");
    await page.getByLabel("Colour name").fill("Deep Sea");
    await page.getByLabel("Hex code").fill("#0b3c5d");
    await page.getByRole("button", { name: "Add colour" }).click();
    await expect(page.getByLabel("Deep Sea hex")).toHaveValue("#0B3C5D");

    await page.goto("/app/kit?tab=facts");
    await page.getByRole("button", { name: "Add fact" }).click();
    const form = page.getByRole("form", { name: "New fact" });
    await form.getByLabel("Statement").fill("Free delivery on orders over 500 rupees.");
    await form.getByLabel("Approved wording").fill("Free delivery on orders over ₹500");
    await form.getByLabel("Owner", { exact: true }).fill("Logistics");
    await form.getByRole("button", { name: "Add fact" }).click();
    await expect(toasts(page)).toContainText("Saved F-101 to the draft.");

    await page.goto("/app/kit?tab=rules");
    await page.getByRole("button", { name: "Add rule" }).click();
    await page.goto("/app/setup");
    await expect(page.getByText("4 of 4 done")).toBeVisible();
    for (const id of steps) await expect(page.locator(`[data-step='${id}']`)).toHaveAttribute("data-done", "");
    await expect(page.locator("[data-step='words']")).toContainText("1 term");
    await expect(page.locator("[data-step='palette']")).toContainText("1 colour");
    await expect(page.locator("[data-step='facts']")).toContainText("1 fact, 0 with an expiry date");
  });

  test("a colour must be a hex code and a date must be a date, with the error beside the field", async ({ page }) => {
    await freshWorkspace(page);
    await addBrand(page, "Northwind Test");

    await page.goto("/app/kit?tab=assets");
    await page.getByLabel("Colour name").fill("Broken");
    await page.getByLabel("Hex code").fill("banana");
    await page.getByRole("button", { name: "Add colour" }).click();
    const hex = page.getByLabel("Hex code");
    await expect(hex).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Use a hex colour like #B8860B (a # and 6 letters or digits).")).toBeVisible();
    await expect(page.getByLabel("Broken hex")).toHaveCount(0);
    // A short hex is accepted and written in full; editing a saved colour to something invalid shows the error and keeps the old one.
    await hex.fill("#abc");
    await page.getByRole("button", { name: "Add colour" }).click();
    const saved = page.getByLabel("Broken hex");
    await expect(saved).toHaveValue("#AABBCC");
    await saved.fill("#12345");
    await saved.blur();
    await expect(saved).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Use a hex colour like #B8860B (a # and 6 letters or digits).")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Broken hex")).toHaveValue("#AABBCC");
    // Removing a colour asks first.
    await page.getByRole("button", { name: "Remove Broken" }).click();
    await page.getByRole("dialog", { name: "Remove Broken?" }).getByRole("button", { name: "Remove colour" }).click();
    await expect(page.getByLabel("Broken hex")).toHaveCount(0);

    await page.goto("/app/kit?tab=facts");
    await page.getByRole("button", { name: "Add fact" }).click();
    const form = page.getByRole("form", { name: "New fact" });
    // Nothing is saved with its required fields empty.
    await form.getByRole("button", { name: "Add fact" }).click();
    await expect(form.getByText("Say what the fact is.")).toBeVisible();
    await expect(form.getByText("Name the team that owns this fact, so its expiry alert has someone to go to.")).toBeVisible();
    await form.getByLabel("Statement").fill("A fact");
    await form.getByLabel("Approved wording").fill("A fact.");
    await form.getByLabel("Owner", { exact: true }).fill("Legal");
    await form.getByLabel("Valid from").fill("2027-02-01");
    await form.getByLabel("Valid to").fill("2027-01-01");
    await form.getByRole("button", { name: "Add fact" }).click();
    await expect(form.getByLabel("Valid to")).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByText("Valid to (1 Jan 2027) is before valid from (1 Feb 2027).")).toBeVisible();
    await form.getByLabel("Valid to").fill("2027-03-01");
    await form.getByRole("button", { name: "Add fact" }).click();
    await expect(toasts(page)).toContainText("Saved F-101 to the draft.");
    // A saved fact can be edited (owner and expiry) and removed.
    const edit = page.getByRole("form", { name: "Fact F-101" });
    await edit.getByLabel("Owner", { exact: true }).fill("Compliance");
    await edit.getByLabel("Valid to").fill("2027-04-01");
    await edit.getByRole("button", { name: "Save to draft" }).click();
    await expect(page.getByRole("row", { name: /F-101/ })).toContainText("Compliance");
    await expect(page.getByRole("row", { name: /F-101/ })).toContainText("1 Apr 2027");
    await edit.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("dialog", { name: "Remove F-101?" }).getByRole("button", { name: "Remove fact" }).click();
    await expect(page.getByRole("row", { name: /F-101/ })).toHaveCount(0);
    await expect(page.getByText("No facts yet.")).toBeVisible();
  });

  test("words, rules and their phrases: what a brand adds fires in code once published", async ({ page }) => {
    await freshWorkspace(page);
    await addBrand(page, "Northwind Test");

    // A term: avoid "sun cream", say "sunscreen".
    await page.goto("/app/kit?tab=terms");
    const addTerm = page.getByRole("form", { name: "Add a term" });
    await addTerm.getByLabel("Not this (comma-separated)").fill("sun cream, sunblock");
    await addTerm.getByLabel("Say this").fill("sunscreen");
    await addTerm.getByRole("button", { name: "Add term" }).click();
    await expect(toasts(page)).toContainText("Added TERM-01.");
    await expect(page.getByRole("form", { name: "Term TERM-01" })).toBeVisible();
    // The avoid list may not contain the replacement.
    await addTerm.getByLabel("Not this (comma-separated)").fill("sunscreen");
    await addTerm.getByLabel("Say this").fill("sunscreen");
    await addTerm.getByRole("button", { name: "Add term" }).click();
    await expect(addTerm.getByText("That phrase is in the avoid list too.")).toBeVisible();

    // A rule of its own, with phrases checked in code.
    await page.goto("/app/kit?tab=rules");
    await page.getByRole("button", { name: "Add rule" }).click();
    const rule = page.getByRole("form", { name: "Rule CUSTOM-01" });
    await rule.getByLabel("Title").fill("No buzzwords");
    await rule.getByLabel("Rule text").fill("Do not use empty buzzwords.");
    // Phrases only appear once "checked in code" is on, and it needs at least one.
    await expect(rule.getByLabel("Phrases checked in code (one per line)")).toHaveCount(0);
    await rule.getByRole("checkbox", { name: "Phrases checked in code", exact: true }).check();
    await rule.getByRole("button", { name: "Save to draft" }).click();
    await expect(rule.getByText("Add at least one phrase, or untick “Phrases checked in code”.")).toBeVisible();
    await rule.getByLabel("Phrases checked in code (one per line)").fill("synergy\nbest-in-class");
    await rule.getByRole("button", { name: "Save to draft" }).click();
    await expect(toasts(page)).toContainText("Saved CUSTOM-01 to the draft.");

    await page.getByRole("button", { name: "Publish v1.1" }).click();
    await expect(page.getByText(/^Published rulebook v1\.1\./)).toBeVisible();

    // The published rulebook checks drafts: the term, the phrases and a starter rule all fire.
    await check(page, { title: "Launch note", channel: "website", text: "Our sun cream is full of synergy. Results guaranteed." });
    for (const id of ["TERM-01", "CUSTOM-01", "CLAIM-02"]) await expect(page.getByText(id).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("synergy").first()).toBeVisible();
  });

  test("a brand can be forgotten from the list, but not the one that is open or the demo", async ({ page }) => {
    await freshWorkspace(page);
    await addBrand(page, "Northwind Test");
    await page.goto("/app/setup");
    const list = page.getByRole("complementary", { name: "Brands in this browser" });
    await expect(list.getByText("Open now")).toBeVisible();
    await expect(list.getByRole("button", { name: "Forget" })).toHaveCount(0);
    await list.getByRole("button", { name: "Switch to Velvra" }).click();
    await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible({ timeout: 30_000 });
    await page.goto("/app/setup");
    await expect(page.getByRole("heading", { name: "Add a brand", level: 1 })).toBeVisible();
    await expect(list.getByRole("button", { name: "Switch to Velvra" })).toHaveCount(0);
    await list.getByRole("button", { name: "Forget" }).click();
    await page.getByRole("dialog", { name: "Forget Northwind Test?" }).getByRole("button", { name: "Forget brand" }).click();
    await expect(list.getByText("Northwind Test")).toHaveCount(0);
  });

  test("the name is checked before a brand is added", async ({ page }) => {
    await freshWorkspace(page);
    await page.goto("/app/setup");
    await page.getByRole("button", { name: "Create brand and switch to it" }).click();
    await expect(page.getByText("Give the brand a name.")).toBeVisible();
    await page.getByLabel("Brand name").fill("velvra");
    await page.getByRole("button", { name: "Create brand and switch to it" }).click();
    await expect(page.getByText("A brand with that name already exists in this browser.")).toBeVisible();
  });

  test("the set-up screen, the Brand Kit editors and the brand switcher have no serious or critical accessibility violations", async ({ page }) => {
    await freshWorkspace(page);
    await addBrand(page, "Northwind Test");
    const scan = async (label: string, exclude?: string) => {
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
      const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
      const results = await (exclude ? builder.exclude(exclude) : builder).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
    };
    for (const path of ["/app/setup", "/app/kit?tab=terms", "/app/kit?tab=assets", "/app/kit?tab=facts", "/app/kit?tab=rules"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await scan(path);
    }
    // The switcher is a menu that floats over the links under it, so those links are left out of this one scan.
    await page.goto("/app/setup");
    await switcher(page).click();
    await expect(page.getByRole("group", { name: "Brands in this browser" })).toBeVisible();
    await scan("/app/setup with the switcher open", "nav[aria-label='Main']");
  });
});
