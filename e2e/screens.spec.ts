import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { freshWorkspace, role, stubAi } from "./helpers";

// The screens that were wired to the store in Round 3: a whole brand book imported with its PDF kept, a draft's
// report as a download and as a printable page, and the team pages (without a server: the team spec covers that).

const UPDATE_BOOK = "public/samples/velvra-brand-book-update.pdf";
const INSTAGRAM = "Monsoon launch: Instagram post";
const alert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const squash = (s: string) => s.normalize("NFKC").replace(/[­​]/g, "").replace(/\s+/g, "").toLowerCase();
const drawer = (page: Page) => page.getByRole("dialog", { name: /Brand book, page \d+/ });

async function settled(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  await page.waitForFunction(() => [...document.querySelectorAll('[role="tabpanel"] > div')].every((el) => getComputedStyle(el).opacity === "1"));
}

async function noSeriousViolations(page: Page, label: string) {
  await settled(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${label} · ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

/** The words the page's text layer holds inside the gold box. */
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

/** Opens the Brand Kit's import tab as an admin, and uploads the update pages. */
async function importUpdatePages(page: Page) {
  await page.goto("/app/kit?tab=import");
  await role(page, "Brand Admin");
  await page.getByLabel("Brand book file").setInputFiles(UPDATE_BOOK);
}

/** A write to the browser's own database behind the app's back. */
async function rawKit(page: Page, change: "badQuote" | "dropBook") {
  await page.evaluate(async (change) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("assay");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["kits", "books"], "readwrite");
      if (change === "dropBook") tx.objectStore("books").clear();
      else {
        const kits = tx.objectStore("kits");
        kits.openCursor().onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          const kit = cursor.value;
          for (const r of kit.rules) if (r.source?.bookId) r.source.quote = "words that are not anywhere in this book";
          cursor.update(kit);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, change);
}

test.describe("Importing a whole brand book", () => {
  test("is read in batches, says what happened, and each rule's citation opens its own PDF at the quoted words", async ({ page }) => {
    await stubAi(page);
    // The AI answers the one batch, slowly enough to be seen, with one quote that is on the page and one that is not.
    await page.route("**/api/ai", async (route) => {
      const body = route.request().postDataJSON() as { task: string };
      if (body.task !== "draftRules") return route.fallback();
      await new Promise((r) => setTimeout(r, 900));
      return route.fulfill({
        json: {
          ok: true,
          data: {
            rules: [
              { title: "Never call a product a miracle", text: "Do not call a product a miracle, in any channel.", category: "message", severity: "medium", page: 2, quote: "Never call a product a miracle, in any channel." },
              { title: "Invented rule", text: "A rule the book does not hold.", category: "tone", severity: "low", page: 1, quote: "This sentence is not in the book at all." },
            ],
          },
          model: "stub-model",
          ms: 5,
          redactions: 0,
        },
      });
    });
    await freshWorkspace(page);
    await importUpdatePages(page);

    await expect(page.getByText(/^Reading batch 1 of 1$/)).toBeVisible();
    const note = page.getByRole("status").filter({ hasText: "candidate rule" });
    await expect(note).toBeVisible({ timeout: 60_000 });
    await expect(note).toContainText(/\d+ candidate rules? from 4 pages of velvra-brand-book-update\.pdf\. None is active until you approve it\./);
    // One batch holds all four pages, so the AI read them all; the second quote is not on page 1, so it is dropped.
    await expect(note).toContainText("The AI (stub-model) read all 4 pages.");
    await expect(note).toContainText("1 AI candidate was dropped because its quote wasn't on the page it cited.");
    await expect(note).toContainText("Facts and terms aren't imported. Enter them by hand in the Claim Ledger and Terms tabs.");
    await noSeriousViolations(page, "import done");

    // The AI's rule keeps its quote; its citation opens the imported PDF with those words boxed.
    const item = page.getByRole("listitem").filter({ hasText: "Do not call a product a miracle" }).first();
    await item.getByRole("button", { name: /^Open page \d+ of velvra-brand-book-update\.pdf$/ }).click();
    const d = drawer(page);
    await expect(d).toBeVisible();
    await expect(d.getByText("Page 2 of 4")).toBeVisible({ timeout: 30_000 });
    await expect(d.getByText("The words this rule quotes are boxed in gold on the page.")).toBeVisible({ timeout: 30_000 });
    const mark = d.locator("[data-highlight]");
    await expect(mark).toBeVisible();
    expect(squash(await boxedText(page))).toBe(squash("Never call a product a miracle, in any channel."));
    await expect(d.getByText("Never call a product a miracle, in any channel.").first()).toBeVisible();
    await noSeriousViolations(page, "imported citation open");
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
  });

  test("a heuristic rule's quote is boxed too; an unmatched quote says so; a missing book keeps the no-page statement", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await importUpdatePages(page);
    const note = page.getByRole("status").filter({ hasText: "candidate rule" });
    await expect(note).toContainText("The AI read none of the pages, so all 4 pages went through the must, never, always, avoid and don't heuristic.", { timeout: 60_000 });

    const open = () => page.getByRole("button", { name: /^Open page \d+ of velvra-brand-book-update\.pdf$/ }).first();
    await open().click();
    await expect(drawer(page).locator("[data-highlight]")).toBeVisible({ timeout: 30_000 });
    await expect(drawer(page).getByText("The words this rule quotes are boxed in gold on the page.")).toBeVisible();
    await page.keyboard.press("Escape");

    // A quote that is not on its page: the page is shown, with a plain note, and no box.
    await rawKit(page, "badQuote");
    await page.reload();
    await open().click();
    await expect(drawer(page).getByText("The words this rule quotes couldn't be found in the page's text, so nothing is boxed. The page is shown as it is.")).toBeVisible({ timeout: 30_000 });
    await expect(drawer(page).locator("[data-highlight]")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The file is gone: the existing statement, and the rule as the rulebook holds it.
    await rawKit(page, "dropBook");
    await page.reload();
    await open().click();
    const d = drawer(page);
    await expect(d.getByText(/That file isn't kept in this workspace, so there is no page to open\./)).toBeVisible({ timeout: 30_000 });
    await expect(d.locator("[data-highlight]")).toHaveCount(0);
  });
});

test.describe("A draft's report", () => {
  async function draft(page: Page) {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/new?sample=instagram-launch");
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(INSTAGRAM, { timeout: 60_000 });
  }

  test("downloads as Markdown", async ({ page }) => {
    await draft(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download report" }).click()]);
    expect(download.suggestedFilename()).toBe("monsoon-launch-instagram-post-report.md");
    const path = test.info().outputPath("report.md");
    await download.saveAs(path);
    const markdown = await readFile(path, "utf8");
    expect(markdown).toContain(`# ${INSTAGRAM}`);
    expect(markdown).toContain("## Findings (8)");
    expect(markdown).toContain("| Severity | Rule |");
    await expect(page.getByRole("status", { name: "Notifications" })).toContainText("Report downloaded.");
  });

  test("has a print page: the record as a document, light paper, no app around it when printed", async ({ page }) => {
    await draft(page);
    await page.getByRole("link", { name: "Print view" }).click();
    await expect(page).toHaveURL(/\/app\/s\/[^/]+\/report$/);
    const sheet = page.getByRole("article", { name: "Draft report" });
    await expect(sheet.getByRole("heading", { level: 1 })).toHaveText(INSTAGRAM);
    await expect(sheet.getByRole("heading", { level: 2, name: "Findings (8)" })).toBeVisible();
    // Real tables, real lists, and the draft's own words in a code block.
    await expect(sheet.getByRole("table").first().getByRole("columnheader", { name: "Severity" })).toBeVisible();
    await expect(sheet.getByRole("row")).not.toHaveCount(0);
    await expect(sheet.locator("pre")).toContainText("OMG");
    await expect(sheet.getByRole("listitem").filter({ hasText: "Channel: instagram" })).toBeVisible();
    await noSeriousViolations(page, "report page");

    // Print asks the browser to print; the button itself does not print.
    await page.evaluate(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => void ((window as unknown as { __printed: number }).__printed += 1);
    });
    await page.getByRole("button", { name: "Print" }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);

    // As printed: the shell and the buttons are gone, the paper is white, the words are black, and nothing moves.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
    await expect(page.getByRole("radiogroup", { name: "Viewing as" })).toBeHidden();
    const look = await sheet.evaluate((el) => {
      const s = getComputedStyle(el);
      const h = getComputedStyle(el.querySelector("h1")!);
      return { background: s.backgroundColor, color: s.color, heading: h.color, radius: s.borderTopLeftRadius, animation: s.animationName, transition: s.transitionDuration };
    });
    expect(look.background).toBe("rgb(255, 255, 255)");
    expect(look.color).toBe("rgb(0, 0, 0)");
    expect(look.radius).toBe("0px");
    expect(look.animation).toBe("none");
    await page.emulateMedia({ media: "screen" });
  });

  test("shows a draft's own markup as words, never as markup", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/new");
    await page.locator("#title").fill("Markup <b>draft</b>");
    await page.locator("#copy").fill('Hello <img src=x onerror="window.__xss=1"> and <script>window.__xss=2</script> **not bold** `code`.');
    await page.locator("#intent-goal").fill("Launch awareness");
    await page.locator("#intent-keyMessage").fill("Hello");
    await page.locator("#intent-cta").fill("Shop");
    await page.getByLabel("I confirm this is what the draft is for").check();
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Markup", { timeout: 60_000 });
    await page.getByRole("link", { name: "Print view" }).click();
    const sheet = page.getByRole("article", { name: "Draft report" });
    await expect(sheet.getByRole("heading", { level: 1 })).toHaveText("Markup <b>draft</b>");
    await expect(sheet.locator("pre")).toContainText('<img src=x onerror="window.__xss=1">');
    await expect(sheet.locator("pre")).toContainText("<script>window.__xss=2</script>");
    expect(await sheet.locator("img, script, b").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("a report for a draft that is not here says so", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/s/not-a-draft/report");
    await expect(page.getByRole("heading", { name: "This draft has no report to show." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to drafts" })).toBeVisible();
  });
});

test.describe("Team pages, without a team server", () => {
  const status = (page: Page, body: unknown) => page.route("**/api/team/status", (route) => route.fulfill({ json: body }));

  test("/team says plainly when there is no database, and when there is no email", async ({ page }) => {
    await status(page, { enabled: false, email: false });
    await page.goto("/team");
    const off = page.getByTestId("team-off");
    await expect(off).toContainText("This deployment has no database");
    await expect(off).toContainText("The demo and any brands kept in this browser still work");
    await expect(page.getByRole("button", { name: "Email me a link" })).toHaveCount(0);
    await noSeriousViolations(page, "team off, no database");

    await page.unrouteAll();
    await status(page, { enabled: true, email: false });
    await page.goto("/team");
    await expect(page.getByTestId("team-off")).toContainText("no email service, so sign-in links can't be sent");
    await expect(page.getByTestId("team-off")).toContainText("The demo and any brands kept in this browser still work");
  });

  test("/team offers both paths, says what a sent link is, and shows a test link as a link", async ({ page }) => {
    await status(page, { enabled: true, email: true, signedIn: null, workspaces: [] });
    await page.route("**/api/team/start", (route) => route.fulfill({ json: { ok: true, testLink: "http://localhost:3210/team/verify#abcdefghijklmnopqrstuvwxyz0123456789" } }));
    await page.route("**/api/team/signin", (route) => route.fulfill({ json: { ok: true } }));
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "Create a team workspace" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await noSeriousViolations(page, "team page, both forms");

    const create = page.getByRole("region", { name: "Create a team workspace" });
    await create.getByLabel("Workspace name").fill("Northwind Skin");
    await create.getByLabel("Your name").fill("Ada Admin");
    await create.getByLabel("Your email").fill("ada@example.com");
    await create.getByRole("button", { name: "Email me a link" }).click();
    await expect(create.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(create).toContainText("We sent a link to ada@example.com.");
    await expect(create).toContainText("The link works once and expires in 30 minutes.");
    await expect(create.getByRole("link", { name: /localhost:3210\/team\/verify#/ })).toBeVisible();

    const sign = page.getByRole("region", { name: "Sign in", exact: true });
    await sign.getByLabel("Your email").fill("cara@example.com");
    await sign.getByRole("button", { name: "Email me a link" }).click();
    await expect(sign).toContainText("If cara@example.com belongs to a team workspace, we sent it a sign-in link.");
    await expect(sign.getByRole("link")).toHaveCount(0);
  });

  test("/team lists a signed-in person's workspaces", async ({ page }) => {
    await status(page, { enabled: true, email: true, signedIn: "ada@example.com", workspaces: [{ workspaceId: "w1", workspaceName: "Northwind Skin", name: "Ada", role: "admin" }] });
    let signedOut = 0;
    await page.route("**/api/team/signout", (route) => (signedOut++, route.fulfill({ json: { ok: true } })));
    await page.goto("/team");
    await expect(page.getByText("Signed in as ada@example.com.")).toBeVisible();
    await expect(page.locator("[data-workspace='Northwind Skin']")).toContainText("You are Ada, Brand Admin");
    await expect(page.getByRole("button", { name: "Open Northwind Skin" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.poll(() => signedOut).toBe(1);
  });

  test("/team/verify does not use the link until the button is pressed, and takes the code out of the address", async ({ page }) => {
    let verifies = 0;
    await page.route("**/api/team/verify", (route) => {
      verifies++;
      return route.fulfill({ status: 410, json: { ok: false, message: "That link has expired or was already used. Ask for a new one." } });
    });
    await page.goto("/team/verify#abcdefghijklmnopqrstuvwxyz0123456789");
    const go = page.getByRole("button", { name: "Continue to Assay" });
    await expect(go).toBeVisible();
    await page.waitForTimeout(1200);
    expect(verifies).toBe(0);
    expect(new URL(page.url()).hash).toBe("");
    await noSeriousViolations(page, "verify page");

    await go.click();
    await expect(alert(page)).toContainText("That link has expired or was already used. Ask for a new one.");
    expect(verifies).toBe(1);
    await expect(page.getByRole("link", { name: "Back to team sign-in" })).toHaveAttribute("href", "/team");
    await expect(go).toHaveCount(0);
  });

  test("/team/verify with no code says so, and links back", async ({ page }) => {
    await page.goto("/team/verify");
    await expect(page.getByRole("heading", { name: "This link has no code in it" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to team sign-in" })).toBeVisible();
  });
});

test.describe("A team workspace whose server will not open it", () => {
  const joinAs = async (page: Page, teamRole: string) => {
    await page.addInitScript((teamRole) => {
      const brand = { id: "team-w1", name: "Northwind Skin", dbName: "assay-team-w1", kitId: "w1", demo: false, team: { workspaceId: "w1", name: "Cara", role: teamRole } };
      window.localStorage.setItem("assay:brands", JSON.stringify([brand]));
      window.localStorage.setItem("assay:active-brand", "team-w1");
    }, teamRole);
  };

  test("a signed-out session says to sign in again, with a way to do it, and not the storage message", async ({ page }) => {
    await joinAs(page, "creator");
    await page.route("**/api/team/sync**", (route) => route.fulfill({ status: 401, json: { ok: false, message: "Sign in first." } }));
    await page.goto("/app");
    const gate = page.getByRole("heading", { name: "This team workspace can't open yet" });
    await expect(gate).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Sign in again to open this workspace." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to sign-in" })).toHaveAttribute("href", "/team");
    await expect(page.getByText(/IndexedDB/)).toHaveCount(0);
    await noSeriousViolations(page, "team gate");
  });

  test("a workspace with no rulebook yet says to ask its Brand Admin", async ({ page }) => {
    await joinAs(page, "creator");
    await page.route("**/api/team/sync**", (route) => route.fulfill({ json: { ok: true, role: "creator", name: "Cara", rows: [], cursor: 0, more: false } }));
    await page.goto("/app");
    await expect(page.getByRole("alert").filter({ hasText: "This workspace has no rulebook yet. Ask its Brand Admin to open it once, then try again." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to sign-in" })).toBeVisible();
  });
});
