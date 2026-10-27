import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { freshWorkspace, LIVE, role, ruleCard, stubAi } from "./helpers";

test.describe("judge path", () => {
  test("sample → findings → fixes → submit → Compliance → Reviewer → Hallmark → Health", async ({ page }) => {
    const t0 = Date.now();
    const timings: Record<string, number> = {};
    const mark = (k: string) => (timings[k] = Date.now() - t0);
    await stubAi(page);
    await freshWorkspace(page);

    // 1. Open the sample.
    await page.goto("/app/new?sample=instagram-launch");
    await expect(page.locator("#copy")).toHaveValue(/OMG/);
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Monsoon launch: Instagram post", { timeout: 60_000 });
    mark("check");

    // 2. The Round 1 worked example: 8 findings from rule checks (live AI may add judgment findings), two high, cited.
    await expect(page.getByRole("tab", { name: LIVE ? /Findings (8|9|1\d)/ : /Findings 8/ })).toBeVisible();
    await expect(page.getByText("2 high-severity still open")).toBeVisible();
    const claim = ruleCard(page, "CLAIM-01");
    await expect(claim).toContainText("F-112");
    await expect(claim).toContainText("p.18 §6.1");
    for (const id of ["VOICE-02", "TERM-04", "VIS-01", "A11Y-01", "A11Y-04", "VIS-03"]) await expect(page.getByText(id).first()).toBeVisible();
    if (!LIVE) {
      await expect(page.getByText(/1 unverifiable AI finding dropped by the evidence verifier/)).toBeVisible();
      await expect(page.getByText(/AI judgment agrees/)).toBeVisible();
    }
    mark("findings");

    // 3. Accept the claim and term fixes, dismiss the tone finding with a reason, apply.
    await ruleCard(page, "CLAIM-01").getByRole("button", { name: "Accept" }).click();
    await ruleCard(page, "CLAIM-03").getByRole("button", { name: "Accept" }).click();
    await ruleCard(page, "TERM-04").getByRole("button", { name: "Accept" }).click();
    await expect(ruleCard(page, "CLAIM-01").getByRole("button", { name: "Dismiss with reason" })).toHaveCount(0);
    const tone = ruleCard(page, "VOICE-02");
    await tone.getByRole("button", { name: "Dismiss with reason" }).click();
    await tone.getByRole("textbox").fill("Launch-day post, playful tone agreed with the brand lead");
    await tone.getByRole("button", { name: "Confirm" }).click();
    await page.getByRole("button", { name: "Apply 3 fixes" }).click();
    await expect(page.getByText(/Intent kept: key message intact and strengthened/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("tab", { name: /Versions 2/ })).toBeVisible({ timeout: 60_000 });
    // The dismissal shows on the open finding and, once the re-check lands, under earlier versions too.
    await expect(page.getByText("Dismissed by Riya (agency intern)").first()).toBeVisible();
    mark("fixes");

    // 4. Submit: fixed claims still go to Compliance.
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("2 claims wait for Compliance")).toBeVisible();
    mark("submit");

    // 5. Compliance approves both claims, then the Reviewer approves.
    await role(page, "Compliance");
    await page.getByRole("button", { name: "Approve claim" }).first().click();
    await page.getByRole("button", { name: "Approve claim" }).first().click();
    await expect(page.getByRole("button", { name: "Approve claim" })).toHaveCount(0);
    await role(page, "Reviewer");
    // The creative's four image findings are still open: approving needs a reason, sealed into the Hallmark.
    // (Live AI may add a judgment finding of its own, so the count is only exact with the stub.)
    const n = LIVE ? "\\d+" : "4";
    await expect(page.getByText(new RegExp(`${n} findings are still open on v2: .*A11Y-01`))).toBeVisible();
    const approve = page.getByRole("button", { name: new RegExp(`^Approve with ${n} open$`) });
    await expect(approve).toBeDisabled();
    await page.getByLabel(/Reason to approve with them open/).fill("Creative already printed; corrected version ships next week");
    await approve.click();
    await expect(page.getByRole("heading", { name: "Hallmark #1" })).toBeVisible();
    await expect(page.getByText(new RegExp(`${n} approved while still open`))).toBeVisible();
    await expect(page.getByText("Approved while open").first()).toBeVisible();
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Verified: the content, the record and the chain all match their hashes.")).toBeVisible();
    mark("approve");

    // 6. Guideline Health.
    await page.getByRole("link", { name: "Guideline Health" }).first().click();
    await expect(page.getByText(/looks unclear/)).toBeVisible();
    await expect(page.getByText("F-107").first()).toBeVisible();
    await expect(page.getByText("6 of 6")).toBeVisible();
    mark("health");

    test.info().annotations.push({ type: "timings-ms", description: JSON.stringify(timings) });
    console.log("JUDGE_PATH_TIMINGS", JSON.stringify(timings));

    // The workspace survives a reload.
    await page.reload();
    await page.getByRole("link", { name: "Hallmarks" }).first().click();
    await expect(page.getByText("#1 ·")).toBeVisible();
    await role(page, "Creator");
  });

  test("Reset demo restores the seed", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/new?sample=linkedin-clean");
    await expect(page.locator("#copy")).toHaveValue(/R&D team/);
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByText(/rule checks only/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("tab", { name: /Findings 0/ })).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Reset demo" }).click();
    await expect(page.getByText("No drafts yet.")).toBeVisible();
  });
});

test.describe("uploads and admin", () => {
  test.beforeEach(async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
  });

  test("DOCX upload finds fairness language, a guarantee and a medical claim", async ({ page }) => {
    await page.goto("/app/new");
    await page.getByLabel("Upload a file").setInputFiles("public/samples/velvra-product-page.docx");
    await expect(page.locator("#copy")).toHaveValue(/whitening/);
    await page.locator("#channel").selectOption("website");
    await page.getByLabel("I confirm this is what the draft is for").check();
    await page.getByRole("button", { name: "Run check" }).click();
    for (const id of ["TERM-05", "CLAIM-02", "CLAIM-04"]) await expect(page.getByText(id).first()).toBeVisible({ timeout: 60_000 });
  });

  test("PDF upload keeps page numbers on findings", async ({ page }) => {
    await page.goto("/app/new?sample=brochure-pdf");
    await expect(page.locator("#copy")).toHaveValue(/No\. 1 sunscreen/);
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByText("page 2").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("CLAIM-03").first()).toBeVisible();
  });

  test("an image upload without alt text is flagged", async ({ page }) => {
    await page.goto("/app/new");
    await page.getByLabel("Upload a file").setInputFiles("public/samples/velvra-monsoon-creative.png");
    await expect(page.getByLabel("Alt text")).toBeVisible();
    await page.locator("#title").fill("Creative only");
    await page.getByLabel("I confirm this is what the draft is for").check();
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByText("Image alt text is missing")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Low text contrast")).toBeVisible();
  });

  test("brand-book import drafts pending rules; approving and publishing makes v3.3", async ({ page }) => {
    await page.goto("/app/kit?tab=import");
    await role(page, "Brand Admin");
    await page.getByRole("button", { name: "Try the sample update pages" }).click();
    await expect(page.getByText(/candidate rule/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/page 2/).first()).toBeVisible();
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    const n = await approve.count();
    expect(n).toBeGreaterThan(3);
    await approve.first().click();
    for (let i = 1; i < n; i++) await page.getByRole("button", { name: "Reject" }).first().click();
    await expect(page.getByText("No imported rules are waiting.")).toBeVisible();
    await page.getByRole("button", { name: "Publish v3.3" }).click();
    await expect(page.getByText(/^Published rulebook v3\.3\. New drafts/)).toBeVisible();
  });

  test("an AI rate limit falls back to rule checks with a banner", async ({ page }) => {
    await page.unrouteAll();
    await stubAi(page, "rate_limited");
    await page.goto("/app/new?sample=genz-caption");
    await expect(page.locator("#copy")).toHaveValue(/lowkey/);
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByText(/free-tier rate limit/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("VOICE-02").first()).toBeVisible();
  });

  test("the phone layout folds the sidebar into a menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Guideline Health", exact: true })).toBeVisible();
  });
});

test.describe("accessibility (axe)", () => {
  for (const path of ["/", "/app", "/app/new?sample=instagram-launch", "/app/review", "/app/kit", "/app/health", "/app/hallmarks", "/about"]) {
    test(`no serious or critical violations on ${path}`, async ({ page }) => {
      await stubAi(page, "off");
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
    });
  }

  test("no serious or critical violations on a checked draft", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/new?sample=monsoon-email");
    await expect(page.locator("#copy")).toHaveValue(/RAIN25/);
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByText("CLAIM-01").first()).toBeVisible({ timeout: 60_000 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
  });
});
