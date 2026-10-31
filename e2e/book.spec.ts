import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import book from "../src/seed/velvra-book.json";
import { SAMPLES } from "../src/seed/samples";
import { freshWorkspace, stubAi } from "./helpers";

// Every finding names the page of the brand book its rule comes from. Here each of those names is opened:
// the drawer must show that page, with the cited paragraph boxed in gold, the right paragraph and not just
// some box. Rules and the book are checked against the same JSON the app reads its citations from.

const PAGES = book.pages.length;
const paragraphs = new Map(book.pages.flatMap((p) => p.blocks.flatMap((b) => ("id" in b && b.id ? [[b.id as string, { page: p.page, text: b.text }] as const] : []))));
/** The comparison the app uses: the PDF breaks lines and joins ligatures, so whitespace and case are stripped. */
const squash = (s: string) => s.normalize("NFKC").replace(/[­​]/g, "").replace(/\s+/g, "").toLowerCase();

const drawer = (page: Page) => page.getByRole("dialog", { name: /Brand book, page \d+/ });

/** The words the page's text layer holds inside the gold box: what the box actually marks. */
async function boxedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const mark = document.querySelector("[data-highlight]")!.getBoundingClientRect();
    return [...document.querySelectorAll(".pdf-text span:not(.markedContent)")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        return el.textContent && x >= mark.left && x <= mark.right && y >= mark.top && y <= mark.bottom;
      })
      .map((el) => el.textContent)
      .join(" ");
  });
}

/** Opens one citation and checks the drawer: the page it says, the paragraph it boxes, and that it closes onto the same button. */
async function checkCitation(page: Page, cite: Locator) {
  const label = (await cite.innerText()).replace(/\s+/g, " ").trim();
  const pageNo = Number(/p\.(\d+)/.exec(label)![1]);
  await cite.click();
  const d = drawer(page);
  await expect(d).toBeVisible();
  await expect(d.getByText(`Page ${pageNo} of ${PAGES}`)).toBeVisible();
  const mark = d.locator("[data-highlight]");
  await expect(mark, `a box on page ${pageNo} for “${label}”`).toBeVisible({ timeout: 30_000 });
  const box = (await mark.boundingBox())!;
  const frame = (await d.locator("[data-book-page]").boundingBox())!;
  expect(box.width).toBeGreaterThan(40);
  expect(box.height).toBeGreaterThan(12);
  expect(box.x).toBeGreaterThanOrEqual(frame.x - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
  const id = (await d.locator("[data-paragraph]").getAttribute("data-paragraph"))!;
  const cited = paragraphs.get(id)!;
  expect(cited.page, `paragraph ${id} is on the page the citation says`).toBe(pageNo);
  expect(squash(await boxedText(page)), `the box on ${id} holds that paragraph`).toBe(squash(cited.text));
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await expect(cite).toBeFocused();
}

test.describe("every citation opens the book at its paragraph", () => {
  test.setTimeout(240_000);
  for (const sample of SAMPLES) {
    test(`${sample.title}`, async ({ page }) => {
      await stubAi(page, "off");
      await freshWorkspace(page);
      await page.goto(`/app/new?sample=${sample.id}`);
      await expect(page.locator("#copy")).not.toHaveValue("");
      await page.getByRole("button", { name: "Run check" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(sample.title, { timeout: 90_000 });
      await expect(page.getByRole("tab", { name: /^Findings \d+/ })).toBeVisible();
      await page.getByRole("radio", { name: /^All \d+/ }).click();

      const cards = page.getByRole("article", { name: /^Finding \d+$/ });
      const n = await cards.count();
      if (n === 0) {
        // A clean draft has no findings and so nothing to cite.
        await expect(page.getByRole("tab", { name: /Findings 0/ })).toBeVisible();
        return;
      }
      let opened = 0;
      for (let i = 0; i < n; i++) {
        const cites = cards.nth(i).locator("button.cite");
        const count = await cites.count();
        // Every finding cites its rule; a fact adds a second citation.
        expect(count, `finding ${i + 1} cites its rule`).toBeGreaterThan(0);
        for (let k = 0; k < count; k++) {
          const cite = cards.nth(i).locator("button.cite").nth(k);
          await cite.scrollIntoViewIfNeeded();
          await checkCitation(page, cite);
          opened++;
        }
      }
      expect(opened).toBeGreaterThanOrEqual(n);
    });
  }
});

test.describe("the drawer", () => {
  test("opens and closes from the keyboard, keeps focus inside, and pages", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/new?sample=monsoon-email");
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Monsoon offer: email", { timeout: 60_000 });
    const cite = page.getByRole("article").filter({ hasText: /CLAIM-01 ·/ }).first().locator("button.cite").first();
    await cite.focus();
    await page.keyboard.press("Enter");
    const d = drawer(page);
    await expect(d).toBeVisible();
    // The frame is up first; the close button has focus before the PDF has drawn.
    await expect(d.getByRole("button", { name: "Close the brand book" })).toBeFocused();
    await expect(d.locator("[data-highlight]")).toBeVisible({ timeout: 30_000 });

    // Tab goes round the drawer and never reaches the page behind it.
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("dialog.drawer"))).toBe(true);
    }

    // Paging moves off the cited page, drops the box, and Back to page returns to it with the box.
    const cited = Number(/Page (\d+) of/.exec(await d.locator("[data-page-number]").innerText())![1]);
    await d.getByRole("button", { name: "Next page" }).click();
    await expect(d.getByText(`Page ${cited + 1} of ${PAGES}`)).toBeVisible();
    await expect(d.locator("[data-highlight]")).toHaveCount(0);
    await d.getByRole("button", { name: `Back to page ${cited}` }).click();
    await expect(d.getByText(`Page ${cited} of ${PAGES}`)).toBeVisible();
    await expect(d.locator("[data-highlight]")).toBeVisible({ timeout: 30_000 });
    await d.getByRole("button", { name: "Previous page" }).click();
    await expect(d.getByText(`Page ${cited - 1} of ${PAGES}`)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
    await expect(cite).toBeFocused();
  });

  test("has no serious or critical accessibility violations with a page open", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/new?sample=monsoon-email");
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Monsoon offer: email", { timeout: 60_000 });
    await page.getByRole("article").filter({ hasText: /CLAIM-01 ·/ }).first().locator("button.cite").first().click();
    await expect(drawer(page).locator("[data-highlight]")).toBeVisible({ timeout: 30_000 });
    // The drawer slides in; contrast is a fact about where it comes to rest.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    const results = await new AxeBuilder({ page }).include("dialog.drawer").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
  });

  test("says plainly when the paragraph can't be found, and still shows the page", async ({ page }) => {
    await stubAi(page, "off");
    // A different two-page PDF stands in for the book: page 2 is there, but this paragraph is not in its text.
    await page.route("**/samples/velvra-brand-book.pdf", (route) => route.fulfill({ path: "public/samples/velvra-brochure.pdf", contentType: "application/pdf" }));
    await page.goto("/app/book?page=2&p=p2-0-1");
    await expect(page.locator("[data-book-page='2'][data-state='ready']")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("This paragraph couldn't be found in the page's text, so nothing is boxed. The page is shown as it is.")).toBeVisible();
    await expect(page.locator("[data-highlight]")).toHaveCount(0);
  });

  test("a book that fails to open says so and Retry opens it", async ({ page }) => {
    await stubAi(page, "off");
    let tries = 0;
    await page.route("**/samples/velvra-brand-book.pdf", (route) => (tries++ === 0 ? route.abort("failed") : route.continue()));
    await page.goto("/app/book?page=18&p=p18-6.1-1");
    const frame = page.locator("[data-book-page='18']");
    await expect(frame.getByText("The brand book page didn't open. Check the connection and try again.")).toBeVisible({ timeout: 30_000 });
    await frame.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator("[data-highlight]")).toBeVisible({ timeout: 30_000 });
  });

  test("a rule with no book paragraph opens its own record and says so", async ({ page }) => {
    await stubAi(page, "off");
    // A second brand starts on Assay's starter rules, which cite no page of any book.
    await page.addInitScript(() => {
      localStorage.setItem("assay:brands", JSON.stringify([{ id: "plain-co", name: "Plain Co", dbName: "assay-plain-co", kitId: "plain-co", demo: false }]));
      localStorage.setItem("assay:active-brand", "plain-co");
    });
    await page.goto("/app/new");
    await page.locator("#title").fill("Guarantee");
    await page.locator("#copy").fill("Visible results guaranteed with our new serum.");
    await page.locator("#intent-keyMessage").fill("A serum");
    await page.getByLabel("I confirm this is what the draft is for").check();
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Guarantee", { timeout: 60_000 });
    const card = page.getByRole("article").filter({ hasText: /CLAIM-02 ·/ }).first();
    await card.locator("button.cite").first().click();
    const d = page.getByRole("dialog", { name: /CLAIM-02 record/ });
    await expect(d).toBeVisible();
    await expect(d.getByText("This rule isn't from a brand book", { exact: false })).toBeVisible();
    await expect(d.getByText("Never guarantee results or promise anything permanent.")).toBeVisible();
    await expect(d.locator("[data-book-page]")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
  });
});

test.describe("the deep link", () => {
  test("opens the cited page with its paragraph boxed, pages, and keeps the address true", async ({ page }) => {
    await stubAi(page, "off");
    await page.goto("/app/book?page=18&p=p18-6.1-1");
    await expect(page.getByRole("heading", { name: "Velvra Brand Book v3", level: 1 })).toBeVisible();
    await expect(page.getByText("Page 18 of 28")).toBeVisible();
    await expect(page.getByText("Page 18, §6.1 · cited by CLAIM-01")).toBeVisible();
    await expect(page.locator("[data-highlight]")).toBeVisible({ timeout: 30_000 });
    expect(squash(await boxedText(page))).toBe(squash(paragraphs.get("p18-6.1-1")!.text));

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Page 19 of 28")).toBeVisible();
    await expect(page).toHaveURL(/page=19&p=p18-6\.1-1/);
    await expect(page.locator("[data-highlight]")).toHaveCount(0);
    await page.getByRole("button", { name: "Back to page 18" }).click();
    await expect(page.locator("[data-highlight]")).toBeVisible({ timeout: 30_000 });

    // The index of citations opens any other paragraph.
    await page.getByRole("link", { name: /p\.19 §6\.3/ }).click();
    await expect(page).toHaveURL(/page=19&p=p19-6\.3-1/);
    await expect(page.locator("[data-highlight]")).toBeVisible({ timeout: 30_000 });
    expect(squash(await boxedText(page))).toBe(squash(paragraphs.get("p19-6.3-1")!.text));
  });

  test("a paragraph that isn't in the book still shows the page, and says so", async ({ page }) => {
    await stubAi(page, "off");
    await page.goto("/app/book?page=3&p=nope");
    await expect(page.getByText("That paragraph isn't in this book, so the page is shown without a box.")).toBeVisible();
    await expect(page.getByText("Page 3 of 28")).toBeVisible();
    await expect(page.locator("[data-book-page='3'][data-state='ready']")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-highlight]")).toHaveCount(0);
  });

  test("a page number out of range falls back to the cited paragraph's page", async ({ page }) => {
    await stubAi(page, "off");
    await page.goto("/app/book?page=99&p=p18-6.1-1");
    await expect(page.getByText("Page 18 of 28")).toBeVisible();
  });
});
