import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { freshWorkspace, role, stubAi } from "./helpers";

// What a person does when things go wrong: a damaged file, a draft that never got its check, an AI that
// fails and then answers, a double click, a keyboard, a phone. Every state here is one the app has to
// get right without a page reload or a crash.

const toasts = (page: Page) => page.getByRole("status", { name: "Notifications" });
// Next's route announcer is also a role=alert, so it is left out.
const alert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

/** Opens a sample on New draft, runs its check, and waits for the draft's own screen. */
async function checkedSample(page: Page, sample: string, title: string) {
  await page.goto(`/app/new?sample=${sample}`);
  await expect(page.locator("#title")).toHaveValue(title);
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(title, { timeout: 60_000 });
  await expect(page.getByRole("tab", { name: /^Findings \d+/ })).toBeVisible();
}

const INSTAGRAM = "Monsoon launch: Instagram post";
const draftId = (page: Page) => new URL(page.url()).pathname.split("/").pop()!;

/** Cards deal in with a fade, and a dialog rises: contrast is a fact about the finished page. */
async function settled(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  // A tab's panel fades in with a script-driven tween, which the animation list does not hold.
  await page.waitForFunction(() => [...document.querySelectorAll('[role="tabpanel"] > div')].every((el) => getComputedStyle(el).opacity === "1"));
}

async function noSeriousViolations(page: Page, label: string) {
  await settled(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${label} · ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

/** Writes to the browser's own database behind the app's back: the way a second tab, a closed tab or a crash leaves things. */
async function rawStatus(page: Page, id: string, status: string) {
  await page.evaluate(
    async ({ id, status }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("assay");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("submissions", "readwrite");
        const store = tx.objectStore("submissions");
        const get = store.get(id);
        get.onsuccess = () => store.put({ ...get.result, status });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { id, status },
  );
}

/** Removes a draft's check and findings, as a check that never finished leaves it. */
async function rawForgetCheck(page: Page, id: string) {
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("assay");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["checks", "findings", "submissions"], "readwrite");
      for (const name of ["checks", "findings"]) {
        const store = tx.objectStore(name);
        store.openCursor().onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          if (cursor.value.submissionId === id) cursor.delete();
          cursor.continue();
        };
      }
      const subs = tx.objectStore("submissions");
      const get = subs.get(id);
      get.onsuccess = () => subs.put({ ...get.result, status: "draft" });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, id);
}

test.describe("Bad files never cost anything", () => {
  test("an empty, blank or damaged file keeps the pasted copy and says why", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/new");
    const copy = page.locator("#copy");
    await copy.fill("Daily Shield is lightweight daily protection.");
    await page.locator("#title").fill("Keep me");

    const upload = page.getByLabel("Upload a file");
    await upload.setInputFiles({ name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) });
    await expect(alert(page)).toContainText("empty.txt is empty, so nothing was changed.");
    await expect(copy).toHaveValue("Daily Shield is lightweight daily protection.");

    await upload.setInputFiles({ name: "blank.txt", mimeType: "text/plain", buffer: Buffer.from("  \n \t ") });
    await expect(alert(page)).toContainText("blank.txt has no text in it, so nothing was changed.");
    await expect(copy).toHaveValue("Daily Shield is lightweight daily protection.");

    await upload.setInputFiles({ name: "damaged.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("this is not a zip file at all") });
    await expect(alert(page)).toContainText("Could not read damaged.docx");
    await expect(copy).toHaveValue("Daily Shield is lightweight daily protection.");
    await expect(page.locator("#title")).toHaveValue("Keep me");

    await upload.setInputFiles({ name: "notes.xyz", mimeType: "application/octet-stream", buffer: Buffer.from("hello") });
    await expect(alert(page)).toContainText("notes.xyz is not a supported file");
    await expect(copy).toHaveValue("Daily Shield is lightweight daily protection.");
    await noSeriousViolations(page, "new draft with a file error");
  });

  test("a bad creative leaves the draft on the same version, with the reason in view", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedSample(page, "instagram-launch", INSTAGRAM);
    const replace = page.getByLabel("Replace the creative");

    await replace.setInputFiles({ name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) });
    await expect(alert(page).first()).toContainText("empty.png is empty, so nothing was changed.");
    await replace.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a picture") });
    await expect(alert(page).first()).toContainText("notes.txt is not a PNG or JPG, so the creative was not changed.");
    await replace.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not really a png") });
    await expect(alert(page).first()).toContainText("could not be decoded");

    // Nothing was saved: still one version, and the draft still opens.
    await expect(page.getByRole("tab", { name: /^Versions 1$/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(INSTAGRAM);
  });
});

test.describe("Moving a workspace in and out", () => {
  test("a damaged export changes nothing and says so beside the button", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedSample(page, "instagram-launch", INSTAGRAM);
    await page.goto("/about");
    const file = page.getByLabel("Workspace file");

    await file.setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from("this is not json") });
    await expect(alert(page)).toContainText("That file is not valid JSON.");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await file.setInputFiles({ name: "damaged.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "assay", format: 1, data: { kits: "nope" } })) });
    await expect(alert(page)).toContainText("That export is damaged, so nothing was changed.");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await noSeriousViolations(page, "about with an import error");

    await page.goto("/app");
    await expect(page.getByRole("link", { name: INSTAGRAM })).toBeVisible();
  });

  test("a good export is checked, confirmed, backed up, and then replaces the workspace", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedSample(page, "instagram-launch", INSTAGRAM);
    await page.goto("/about");

    // Export what there is now: one draft.
    const [exported] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export workspace/ }).click()]);
    expect(exported.suggestedFilename()).toMatch(/^assay-workspace-\d{4}-\d{2}-\d{2}\.json$/);
    const exportPath = test.info().outputPath("export.json");
    await exported.saveAs(exportPath);
    await expect(toasts(page)).toContainText("Workspace exported.");

    // Add a second draft that the export does not have.
    await page.goto("/app/new?sample=linkedin-clean");
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("R&D update", { timeout: 60_000 });
    await page.goto("/about");

    await page.getByLabel("Workspace file").setInputFiles(exportPath);
    const dialog = page.getByRole("dialog", { name: "Replace this workspace with the file?" });
    await expect(dialog).toContainText("holds 2 drafts");
    await expect(dialog).toContainText("is replaced by what is in export.json: 1 draft");
    await expect(dialog).toContainText("downloads a backup");
    await noSeriousViolations(page, "import confirmation");

    // Cancelling leaves it alone and downloads nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.goto("/app");
    await expect(page.getByRole("link", { name: /R&D update/ })).toBeVisible();

    await page.goto("/about");
    await page.getByLabel("Workspace file").setInputFiles(exportPath);
    const [backup] = await Promise.all([page.waitForEvent("download"), page.getByRole("dialog").getByRole("button", { name: "Back up and replace" }).click()]);
    expect(backup.suggestedFilename()).toMatch(/^assay-backup-before-import-/);
    const backupPath = test.info().outputPath("backup.json");
    await backup.saveAs(backupPath);
    // The backup is the workspace as it was: both drafts.
    const saved = JSON.parse(await readFile(backupPath, "utf8")) as { data: { submissions: { title: string; seeded?: boolean }[] } };
    const titles = saved.data.submissions.filter((s) => !s.seeded).map((s) => s.title);
    expect(titles).toHaveLength(2);
    expect(titles).toContain(INSTAGRAM);
    expect(titles.some((t) => t.startsWith("R&D update"))).toBe(true);

    await expect(page.getByRole("status").filter({ hasText: "Imported export.json" })).toBeVisible();
    await expect(toasts(page)).toContainText("Workspace imported.");
    await page.goto("/app");
    await expect(page.getByRole("link", { name: INSTAGRAM })).toBeVisible();
    await expect(page.getByRole("link", { name: /R&D update/ })).toHaveCount(0);
  });
});

test.describe("Deleting a draft", () => {
  test("asks first, goes back to the list, and says it is done", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedSample(page, "instagram-launch", INSTAGRAM);

    await page.getByRole("button", { name: "Delete draft" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this draft?" });
    await expect(dialog).toContainText(`“${INSTAGRAM}” and its version, findings and comments are removed from this browser.`);
    await noSeriousViolations(page, "delete confirmation");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(INSTAGRAM);

    await page.getByRole("button", { name: "Delete draft" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete draft" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(toasts(page)).toContainText("Draft deleted.");
    await expect(page.getByText("Nothing here yet")).toBeVisible();
  });

  test("a draft with reviewers or a Hallmark has no delete button", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedSample(page, "linkedin-clean", "R&D update: LinkedIn post");
    await expect(page.getByRole("button", { name: "Delete draft" })).toBeVisible();

    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText(/^In review\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete draft" })).toHaveCount(0);

    await role(page, "Reviewer");
    await page.getByRole("button", { name: /^Approve/ }).click();
    await expect(page.getByText(/^Approved and hallmarked\./)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Delete draft" })).toHaveCount(0);
  });

  test("when the draft changes under the dialog, the store's refusal shows and nothing is deleted", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedSample(page, "instagram-launch", INSTAGRAM);
    const id = draftId(page);

    await page.getByRole("button", { name: "Delete draft" }).click();
    // Another tab sends it to review while the question is open.
    await rawStatus(page, id, "in_review");
    await page.getByRole("dialog").getByRole("button", { name: "Delete draft" }).click();
    await expect(alert(page).first()).toContainText("This draft is with its reviewers or has a Hallmark, so it is kept as a record.");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(INSTAGRAM);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(INSTAGRAM);
  });
});

test.describe("A check that did not finish", () => {
  test("a version with no check offers Run the check, and running it gives the findings", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedSample(page, "instagram-launch", INSTAGRAM);
    await rawForgetCheck(page, draftId(page));
    await page.reload();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(INSTAGRAM);
    await expect(page.getByText("This version has not been checked.")).toBeVisible();
    await expect(page.getByTestId("next-step")).toContainText("run the check on v1");
    await expect(page.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
    await noSeriousViolations(page, "a draft with no check");

    await page.getByRole("button", { name: "Run the check" }).click();
    await expect(page.getByRole("tab", { name: /^Findings 8$/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Run the check" })).toHaveCount(0);
    await expect(page.getByText("2 high-severity still open")).toBeVisible();
  });

  test("a status request that never answers doesn't hold up the rule checks", async ({ page }) => {
    await stubAi(page);
    await freshWorkspace(page);
    await page.route("**/api/status", () => undefined);
    await page.goto("/app/new?sample=monsoon-email");
    await expect(page.locator("#copy")).toHaveValue(/RAIN25/);
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("tab", { name: /^Findings \d+/ })).toBeVisible({ timeout: 15_000 });
  });

  test("a check that fell back to rule checks says so, and Try the AI again reads it with the AI", async ({ page }) => {
    await stubAi(page, "rate_limited");
    await freshWorkspace(page);
    await checkedSample(page, "instagram-launch", INSTAGRAM);
    const banner = page.getByText(/free-tier rate limit/);
    await expect(banner).toBeVisible({ timeout: 60_000 });
    // The banner wraps inside its box on a narrow screen and stays in view on every tab.
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await banner.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("tab", { name: /^Versions/ }).click();
    await expect(banner).toBeVisible();
    await page.getByRole("tab", { name: /^Findings/ }).click();
    await noSeriousViolations(page, "the AI fell back");

    // The AI answers this time.
    await page.unrouteAll();
    await stubAi(page, "ok");
    await page.getByRole("button", { name: "Try the AI again" }).click();
    await expect(page.getByText(/free-tier rate limit/)).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Try the AI again" })).toHaveCount(0);
    await expect(page.getByText(/AI judgment in \d/)).toBeVisible();
  });

  test("Confidential mode says nothing was sent, and offers no AI to try again", async ({ page }) => {
    await stubAi(page);
    await freshWorkspace(page);
    await role(page, "Brand Admin");
    await page.goto("/about");
    await page.getByRole("switch", { name: /Send nothing to AI services/ }).click();
    await expect(page.getByRole("switch", { name: /Send nothing to AI services/ })).toBeChecked();
    await role(page, "Creator");
    await checkedSample(page, "instagram-launch", INSTAGRAM);
    await expect(page.getByText(/Confidential mode is on for this Brand Kit: nothing was sent to an AI service/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Try the AI again" })).toHaveCount(0);
  });
});

test.describe("Brand Kit", () => {
  test("publishing with nothing changed shows the store's sentence in place, and makes no version", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await role(page, "Brand Admin");
    await page.goto("/app/kit");
    await page.getByRole("button", { name: "Publish v3.3" }).click();
    await expect(alert(page)).toContainText("Nothing has changed since version 3.2.");
    await noSeriousViolations(page, "publish refused");
    await page.getByRole("tab", { name: /^Versions/ }).click();
    await expect(page.locator("[data-version]")).toHaveCount(1);
    await expect(page.locator("[data-version='3.2']")).toContainText("In use");
  });

  test("rolling back no longer says it overwrites the draft", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await role(page, "Brand Admin");
    await page.goto("/app/kit");
    await page.getByRole("button", { name: "Add rule" }).click();
    await page.getByRole("button", { name: "Publish v3.3" }).click();
    await expect(page.getByText(/^Published rulebook v3\.3\./)).toBeVisible();
    await page.getByRole("tab", { name: /^Versions/ }).click();
    await page.locator("[data-version='3.2']").getByRole("button", { name: "Roll back to v3.2" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("moves back only what differs");
    await expect(dialog).toContainText("edits you have not published yet stay as they are");
    await expect(dialog).not.toContainText(/replaced|lost/);
  });
});

test.describe("Tabs", () => {
  test("?tab=bad opens the first tab and not a blank panel, on the Brand Kit and on a draft", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/kit?tab=bad");
    await expect(page.getByRole("tab", { name: /^Rules/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel").getByRole("table")).toBeVisible();
    await page.goto("/app/kit?tab=terms");
    await expect(page.getByRole("tab", { name: /^Terms/ })).toHaveAttribute("aria-selected", "true");

    await checkedSample(page, "instagram-launch", INSTAGRAM);
    const here = page.url();
    await page.goto(`${here}?tab=bad`);
    await expect(page.getByRole("tab", { name: /^Findings/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel").getByRole("article").first()).toBeVisible();
    await page.goto(`${here}?tab=versions`);
    await expect(page.getByRole("tab", { name: /^Versions/ })).toHaveAttribute("aria-selected", "true");
  });

  test("arrow keys, Home and End move between tabs, and only the chosen tab is in the Tab order", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/kit");
    const list = page.getByRole("tablist", { name: "Brand Kit sections" });
    const tab = (name: RegExp) => list.getByRole("tab", { name });
    await tab(/^Rules/).focus();

    await page.keyboard.press("ArrowRight");
    await expect(tab(/^Claim Ledger/)).toBeFocused();
    await expect(tab(/^Claim Ledger/)).toHaveAttribute("aria-selected", "true");
    // The panel is named by its tab.
    await expect(page.getByRole("tabpanel", { name: /^Claim Ledger/ })).toBeVisible();
    await page.keyboard.press("End");
    await expect(tab(/^Versions/)).toBeFocused();
    await expect(tab(/^Versions/)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tab(/^Rules/)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(/^Versions/)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tab(/^Rules/)).toBeFocused();
    await expect(tab(/^Rules/)).toHaveAttribute("aria-selected", "true");

    // One stop in the Tab order: the chosen tab. Tab leaves the list for the panel.
    await expect(list.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(list.locator('[role="tab"][tabindex="-1"]')).toHaveCount(5);
    await page.keyboard.press("Tab");
    await expect(list.locator('[role="tab"]:focus')).toHaveCount(0);
    await noSeriousViolations(page, "brand kit tabs");
  });
});

test.describe("Comments", () => {
  test("a double click on Post posts the comment once", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedSample(page, "instagram-launch", INSTAGRAM);
    await page.getByRole("tab", { name: /^Comments/ }).click();
    const text = "Please check the SPF line before Friday.";
    await page.locator("#new-comment").fill(text);
    await page.getByRole("button", { name: "Post", exact: true }).dblclick();
    await expect(page.getByRole("tab", { name: /^Comments 1$/ })).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.getByRole("tabpanel").getByText(text)).toHaveCount(1);
    await expect(page.locator("#new-comment")).toHaveValue("");
  });
});

test.describe("Keyboard and phone", () => {
  test("a skip link is the first stop and moves focus to the page's main content", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    // It slides in from above the screen; once it has arrived it is on screen.
    await expect.poll(async () => (await skip.boundingBox())!.y).toBeGreaterThan(0);
    await noSeriousViolations(page, "skip link focused");
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("the phone menu keeps focus inside, closes on Escape, and returns focus to its button", async ({ page }) => {
    await stubAi(page, "off");
    await page.setViewportSize({ width: 390, height: 844 });
    await freshWorkspace(page);
    const opener = page.getByRole("button", { name: "Open menu" });
    await opener.click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await noSeriousViolations(page, "phone menu");

    const inside = () => page.evaluate(() => !!document.activeElement?.closest("dialog[open]"));
    for (let i = 0; i < 22; i++) {
      await page.keyboard.press("Tab");
      expect(await inside()).toBe(true);
    }
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inside()).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(opener).toBeFocused();

    await opener.click();
    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: "Close menu" }).click();
    await expect(menu).toBeHidden();
    await expect(opener).toBeFocused();

    // A link closes it too.
    await opener.click();
    await menu.getByRole("link", { name: "Hallmarks", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/hallmarks$/);
    await expect(menu).toBeHidden();
  });

  test("below 1280 px the draft and its findings take turns; from 1280 px they sit side by side", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedSample(page, "instagram-launch", INSTAGRAM);
    const card = page.getByRole("article", { name: "Finding 1", exact: true });
    const draftHeading = page.getByRole("heading", { name: /^v1 · Instagram/ });
    const draftButton = page.getByRole("button", { name: "Draft", exact: true });
    const findingsButton = page.getByRole("button", { name: /^Findings · \d+ to do$/ });

    // Side by side at the desktop width, with no switch.
    await expect(card).toBeVisible();
    await expect(draftHeading).toBeVisible();
    await expect(draftButton).toBeHidden();

    await page.setViewportSize({ width: 800, height: 1000 });
    await expect(draftButton).toBeVisible();
    await expect(draftButton).toHaveAttribute("aria-pressed", "true");
    await expect(draftHeading).toBeVisible();
    await expect(card).toBeHidden();
    await noSeriousViolations(page, "800 px, draft pane");

    await findingsButton.click();
    await expect(findingsButton).toHaveAttribute("aria-pressed", "true");
    await expect(card).toBeVisible();
    await expect(draftHeading).toBeHidden();
    await noSeriousViolations(page, "800 px, findings pane");

    // Back to the draft; a highlight in it opens its card on the findings pane.
    await draftButton.click();
    await page.locator("[id^='hl-']").first().click();
    await expect(findingsButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("article[data-selected]")).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(draftHeading).toBeVisible();
    await expect(card).toBeVisible();
    await expect(draftButton).toBeHidden();
  });

  test("the judge path can be dismissed, stays dismissed after a reload, and can be brought back", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await expect(page.getByText("Judge path", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss the judge path" }).click();
    await expect(page.getByText("Judge path", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show the judge path" })).toBeVisible();
    await expect(page.getByText("Judge path", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Show the judge path" }).click();
    await expect(page.getByText("Judge path", { exact: true })).toBeVisible();
  });
});

test.describe("Saying what happens next", () => {
  test("each draft says who moves next, from its real state and the role looking at it", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedSample(page, "linkedin-clean", "R&D update: LinkedIn post");
    const next = page.getByTestId("next-step");
    await expect(next).toContainText("You submit v1 for review.");
    await expect(next).toContainText("Your move");

    await role(page, "Reviewer");
    await expect(next).toContainText("The creator submits v1 for review.");
    await expect(next).not.toContainText("Your move");

    await role(page, "Creator");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(next).toContainText(/The reviewer approves, which writes the Hallmark, or requests changes\./);
    await role(page, "Reviewer");
    await expect(next).toContainText(/You approve, which writes the Hallmark, or request changes\./);
    await expect(next).toContainText("Your move");
  });
});

test.describe("Words a first-time reader meets", () => {
  test("the glossary opens on Claim Ledger, Intent Card and Hallmark", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.goto("/app/new");
    await page.getByRole("button", { name: "Claim Ledger" }).click();
    await expect(page.getByRole("note", { name: "Claim Ledger" })).toContainText("list of product facts it is allowed to state");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("note", { name: "Claim Ledger" })).toBeHidden();
    await page.getByRole("button", { name: "Intent Card" }).click();
    await expect(page.getByRole("note", { name: "Intent Card" })).toContainText("goal, the key message and the call to action");
    await page.keyboard.press("Escape");

    await checkedSample(page, "instagram-launch", INSTAGRAM);
    await page.getByRole("button", { name: "Claim Ledger" }).first().click();
    await expect(page.getByRole("note", { name: "Claim Ledger" })).toBeVisible();
    await noSeriousViolations(page, "a glossary term open");
  });
});

test.describe("Pages that say true things", () => {
  test("the live checker on the home page does not claim an empty caption follows the rulebook", async ({ page }) => {
    await page.goto("/");
    await page.locator("#caption").fill("");
    await expect(page.getByText("No caption yet")).toBeVisible();
    await expect(page.getByText(/Type or paste a caption/)).toBeVisible();
    await expect(page.getByText(/follows the rulebook/)).toHaveCount(0);
    await page.getByRole("button", { name: "A clean caption" }).click();
    await expect(page.getByText("No findings from the rule checks.")).toBeVisible();
    await expect(page.getByText(/follows the rulebook/)).toHaveCount(0);
  });

  test("About names the people it hides and lists every library that ships", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByText(/So are the names of\s+people this workspace knows/)).toBeVisible();
    const libs = page.getByRole("table").last();
    for (const name of ["nodemailer", "pg (node-postgres)", "GSAP and @gsap/react", "Dexie 4", "zod 4"]) await expect(libs).toContainText(name);
  });
});
