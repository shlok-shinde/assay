import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { stubAi } from "./helpers";

// Team workspaces, end to end: real browsers for real people, a real Postgres behind the routes, and the emailed
// links read from the response (TEAM_TEST_LINKS=1 makes the server include them, and only outside Vercel).
// Run it with:
//   TEAM_E2E=1 TEAM_TEST_LINKS=1 DATABASE_URL=postgres://postgres:test@localhost:5544/assay_test E2E_PORT=3210 pnpm exec playwright test e2e/team.spec.ts
// after `pnpm build`. One workspace is made for the whole file, and the tests build on each other in order, as a
// team's week does. A start is limited to five an hour from one address, so re-running it within the hour can be
// refused by the server's own limit.

test.describe("team workspaces", () => {
  test.skip(!process.env.TEAM_E2E, "Needs TEAM_E2E=1 and a database: see the comment at the top of this file.");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  const run = Date.now().toString(36);
  const workspaceName = `Northwind ${run}`;
  const email = (who: string) => `${who}-${run}@example.com`;
  const CAPTION = "Daily Shield SPF 50 is lightweight daily protection for humid days. Reapply every 2 hours. Shop via the link in bio.";

  type Person = { ctx: BrowserContext; page: Page };
  const people: Record<string, Person> = {};
  const links: Record<string, string> = {};
  const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3200}`;
  let workspaceId = "";

  async function person(browser: Browser): Promise<Person> {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await stubAi(page, "off");
    return { ctx, page };
  }

  const chip = (page: Page) => page.getByTestId("sync-chip");
  // The role control is drawn twice (the top bar, and a strip under it on a phone); one of them is hidden.
  const roleChip = (page: Page) => page.getByTestId("role-chip").filter({ visible: true });
  /** The rows this browser has made and not yet sent. */
  const waiting = (page: Page) =>
    page.evaluate(async () => {
      const name = (await indexedDB.databases()).map((d) => d.name ?? "").find((n) => n.startsWith("assay-team-"));
      if (!name) return -1;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const count = await new Promise<number>((resolve, reject) => {
        const r = db.transaction("syncRows").objectStore("syncRows").count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      db.close();
      return count;
    });
  /** Everything this browser did has reached the server. */
  async function sent(page: Page) {
    await expect.poll(() => waiting(page), { timeout: 40_000 }).toBe(0);
    await expect(chip(page)).toHaveText("Synced", { timeout: 40_000 });
  }

  /** Opens an emailed link the way a person does: the page, then the button. Resolves once the app is open. */
  async function openLink(page: Page, link: string) {
    await page.goto(link);
    await page.getByRole("button", { name: "Continue to Assay" }).click();
    await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible({ timeout: 60_000 });
  }

  async function invite(admin: Page, name: string, to: string, role: "Creator" | "Reviewer" | "Compliance") {
    await admin.goto("/app/team");
    await admin.getByLabel("Their name").fill(name);
    await admin.getByLabel("Their email").fill(to);
    await admin.getByLabel("Their role").selectOption({ label: role });
    await admin.getByRole("button", { name: "Send invitation" }).click();
    const note = admin.getByRole("status").filter({ hasText: `Invitation sent to ${to}.` });
    await expect(note).toBeVisible({ timeout: 30_000 });
    return (await note.getByRole("link").getAttribute("href"))!;
  }

  /** Pastes a caption, confirms its Intent Card, runs the check, and waits for the draft's own screen. */
  async function pasteDraft(page: Page, title: string) {
    await page.goto("/app/new");
    await page.locator("#title").fill(title);
    await page.locator("#copy").fill(CAPTION);
    await page.locator("#intent-goal").fill("Daily protection");
    await page.locator("#intent-keyMessage").fill("Daily Shield is daily protection");
    await page.locator("#intent-cta").fill("Shop via the link in bio");
    await page.getByLabel("I confirm this is what the draft is for").check();
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title, { timeout: 90_000 });
    await expect(page.getByRole("tab", { name: /^Findings \d+/ })).toBeVisible();
  }

  async function submit(page: Page) {
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText(/^In review\./)).toBeVisible({ timeout: 30_000 });
  }

  test.afterAll(async () => {
    await Promise.all(Object.values(people).map((p) => p.ctx.close()));
  });

  // The server limits how many links one address can ask for in an hour. A throwaway local database is cleared of
  // those counts first, so the file can be run again straight away. Anything else is left alone.
  test.beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return;
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query("DELETE FROM team_limits").catch(() => undefined);
    await client.end();
  });

  test("an admin creates a workspace through the emailed link and invites a creator and two reviewers", async ({ browser }) => {
    people.admin = await person(browser);
    const { page } = people.admin;
    await page.goto("/team");
    const create = page.getByRole("region", { name: "Create a team workspace" });
    await create.getByLabel("Workspace name").fill(workspaceName);
    await create.getByLabel("Your name").fill("Ada Admin");
    await create.getByLabel("Your email").fill(email("ada"));
    await create.getByRole("button", { name: "Email me a link" }).click();
    await expect(create).toContainText("The link works once and expires in 30 minutes.");
    const link = (await create.getByRole("link", { name: /\/team\/verify#/ }).getAttribute("href"))!;

    // The link does nothing until the button is pressed.
    await page.goto(link);
    await expect(page.getByRole("button", { name: "Continue to Assay" })).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
    await page.getByRole("button", { name: "Continue to Assay" }).click();
    await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible({ timeout: 60_000 });
    workspaceId = await page.evaluate(() => (JSON.parse(localStorage.getItem("assay:brands") ?? "[]") as { team: { workspaceId: string } }[])[0].team.workspaceId);
    await sent(page);

    // The shell of a team workspace: a sync chip, no demo controls, the Team page in the nav, the admin's switcher.
    await expect(page.getByText("Judge path", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset demo" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Team", exact: true })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Viewing as" })).toBeVisible();

    links.cara = await invite(page, "Cara Creator", email("cara"), "Creator");
    links.rao = await invite(page, "Rao Reviewer", email("rao"), "Reviewer");
    links.rita = await invite(page, "Rita Reviewer", email("rita"), "Reviewer");
    await expect(page.getByRole("region", { name: "Members of this workspace" }).getByRole("row")).toHaveCount(2);
  });

  test("the people open their links and each sees the same workspace", async ({ browser }) => {
    for (const [who, link] of [["cara", links.cara], ["rao", links.rao], ["rita", links.rita]] as const) {
      people[who] = await person(browser);
      await openLink(people[who].page, link);
      await expect(chip(people[who].page)).toHaveText("Synced", { timeout: 40_000 });
    }
    // Everyone but the admin sees who they are, read-only; the admin keeps the switcher.
    const cara = people.cara.page;
    await expect(roleChip(cara)).toContainText("Cara Creator");
    await expect(roleChip(cara)).toContainText("Creator");
    await expect(cara.getByRole("radiogroup", { name: "Viewing as" })).toHaveCount(0);
    await expect(cara.getByRole("button", { name: "Reset demo" })).toHaveCount(0);
    await expect(cara.getByText("Judge path", { exact: true })).toHaveCount(0);
    await expect(roleChip(people.rao.page)).toContainText("Reviewer");

    // The Team page: everyone sees the members; only the admin invites.
    await cara.goto("/app/team");
    await expect(cara.getByRole("region", { name: "Members of this workspace" }).getByRole("row")).toHaveCount(5);
    await expect(cara.getByRole("heading", { name: "Invite someone" })).toHaveCount(0);
    await expect(cara.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
    // And the About page says where the work is kept, and that import is off here.
    await cara.goto("/about");
    await expect(cara.getByText(/stored on the server, in Postgres/)).toBeVisible();
    await expect(cara.getByText(/Everyone who is a member of that workspace can see them/)).toBeVisible();
    await expect(cara.getByRole("button", { name: "Import workspace" })).toBeDisabled();
    await expect(cara.getByText(/Import isn't available in a team workspace/)).toBeVisible();
    await expect(people.admin.page.getByRole("link", { name: "Team", exact: true })).toBeVisible();
  });

  test("the admin adds a palette colour and publishes, and everyone's workspace gets the new rulebook", async () => {
    const admin = people.admin.page;
    await admin.goto("/app/kit?tab=assets");
    const form = admin.getByRole("form", { name: "Add a colour" });
    await form.getByLabel("Colour name").fill("Rose Clay");
    await form.getByLabel("Hex code").fill("#C97B63");
    await form.getByRole("button", { name: "Add colour" }).click();
    await expect(admin.getByRole("status", { name: "Notifications" })).toContainText("Added Rose Clay to the palette.");
    await admin.getByRole("button", { name: "Publish v1.1" }).click();
    await expect(admin.getByText(/^Published rulebook v1\.1\./)).toBeVisible();
    await sent(admin);
    for (const who of ["cara", "rao", "rita"]) {
      await people[who].page.goto("/app/kit");
      await expect(people[who].page.getByText(/Checks use the published rulebook v1\.1/)).toBeVisible({ timeout: 40_000 });
    }
  });

  test("a creator makes drafts from pasted text and from a sample with a creative, and submits", async () => {
    const { page } = people.cara;
    // The reviewer's browser is already open on the drafts list, and stays there: nothing below reloads it.
    await people.rao.page.goto("/app");
    await expect(people.rao.page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible();

    for (const title of ["Caption A", "Caption B", "Caption C"]) {
      await pasteDraft(page, title);
      await expect(page.getByRole("tab", { name: /^Findings 0$/ })).toBeVisible();
      await submit(page);
      await sent(page);
    }
    // A sample with a creative: checked, not submitted (it has findings the creator would still fix).
    await page.goto("/app/new?sample=instagram-launch");
    await expect(page.locator("#title")).toHaveValue("Monsoon launch: Instagram post");
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Monsoon launch: Instagram post", { timeout: 120_000 });
    await expect(page.getByRole("img", { name: /^Creative velvra-monsoon-creative\.png/ })).toBeVisible();
    await sent(page);
  });

  test("the reviewer's browser receives them without reloading, including the creative's image", async () => {
    const { page } = people.rao;
    for (const title of ["Caption A", "Caption B", "Caption C", "Monsoon launch: Instagram post"]) {
      await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 40_000 });
    }
    await page.getByRole("link", { name: "Monsoon launch: Instagram post" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Monsoon launch: Instagram post");
    const image = page.getByRole("img", { name: /^Creative velvra-monsoon-creative\.png/ });
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    // The review queue holds the three that were submitted.
    await page.goto("/app/review");
    for (const title of ["Caption A", "Caption B", "Caption C"]) await expect(page.getByText(title).first()).toBeVisible();
  });

  test("someone without the reviewer role has no approve control, and a forged request to approve is refused", async () => {
    const { page, ctx } = people.cara;
    await page.goto("/app");
    await page.getByRole("link", { name: "Caption A" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Caption A");
    await expect(page.getByText(/^In review\./)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);

    const mine = await page.evaluate(async () => {
      const name = (await indexedDB.databases()).map((d) => d.name ?? "").find((n) => n.startsWith("assay-team-"))!;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const get = <T>(store: string, key?: string) =>
        new Promise<T[]>((resolve, reject) => {
          const r = key ? db.transaction(store).objectStore(store).get(key) : db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => resolve((key ? [r.result] : r.result) as T[]);
          r.onerror = () => reject(r.error);
        });
      const sub = (await get<{ id: string; title: string }>("submissions")).find((s) => s.title === "Caption A")!;
      const version = (await get<{ value: number }>("syncState", `submissions|${sub.id}`))[0];
      db.close();
      return { sub, base: version.value };
    });
    const headers = { origin: baseURL, "content-type": "application/json", "x-assay-role": "creator" };
    const forged = await ctx.request.post("/api/team/sync", { headers, data: { workspaceId, changes: [{ tbl: "submissions", rowId: mine.sub.id, base: mine.base, data: { ...mine.sub, status: "approved" } }] } });
    expect(forged.status()).toBe(200);
    const result = (await forged.json()) as { results: { ok: boolean; problem?: string }[] };
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].problem).toBe("A draft is approved by the Hallmark route, not by editing it.");
    // Nor can the Hallmark route be asked for one.
    const hallmark = await ctx.request.post("/api/team/hallmark", { headers, data: { workspaceId, id: "hm_forged", body: { submissionId: mine.sub.id, prevHash: "0".repeat(64), issuedAt: new Date().toISOString() } } });
    expect(hallmark.status()).toBe(403);
    expect(((await hallmark.json()) as { problem: string }).problem).toBe("Only a reviewer can approve.");
    // The draft is still in review, on the server.
    const pulled = await ctx.request.get(`/api/team/sync?workspace=${workspaceId}&cursor=0`);
    const rows = ((await pulled.json()) as { rows: { tbl: string; rowId: string; data: { status?: string } | null }[] }).rows;
    expect(rows.find((r) => r.tbl === "submissions" && r.rowId === mine.sub.id)?.data?.status).toBe("in_review");
  });

  test("a reviewer approves, and Hallmark #1 appears for everyone and verifies", async () => {
    const reviewer = people.rao.page;
    await reviewer.goto("/app");
    await reviewer.getByRole("link", { name: "Caption A" }).click();
    await expect(reviewer.getByRole("heading", { level: 1 })).toContainText("Caption A");
    await reviewer.getByRole("button", { name: /^Approve/ }).click();
    await expect(reviewer.getByText(/^Approved and hallmarked\./)).toBeVisible({ timeout: 60_000 });
    await expect(reviewer.getByRole("heading", { name: /Hallmark #1/ })).toBeVisible();
    await sent(reviewer);

    // The creator's browser, on the Hallmarks screen, gets it without a reload.
    const creator = people.cara.page;
    await creator.goto("/app/hallmarks");
    await expect(creator.getByText("#1 ·")).toBeVisible({ timeout: 40_000 });
    await creator.getByRole("button", { name: "Verify the chain" }).click();
    await expect(creator.getByText("The Hallmark verifies", { exact: false })).toBeVisible();
    await creator.getByRole("button", { name: "Verify the chain" }).waitFor();
    await reviewer.goto("/app/hallmarks");
    await reviewer.getByRole("button", { name: "Verify the chain" }).click();
    await expect(reviewer.getByText("The Hallmark verifies", { exact: false })).toBeVisible();
  });

  test("two reviewers approving two drafts at once get #2 and #3, with an unbroken chain", async () => {
    const rao = people.rao.page;
    const rita = people.rita.page;
    await Promise.all([rao.goto("/app"), rita.goto("/app")]);
    await rao.getByRole("link", { name: "Caption B" }).click();
    await rita.getByRole("link", { name: "Caption C" }).click();
    await expect(rao.getByRole("heading", { level: 1 })).toContainText("Caption B");
    await expect(rita.getByRole("heading", { level: 1 })).toContainText("Caption C");
    const [a, b] = [rao.getByRole("button", { name: /^Approve/ }), rita.getByRole("button", { name: /^Approve/ })];
    await expect(a).toBeEnabled();
    await expect(b).toBeEnabled();
    await Promise.all([a.click(), b.click()]);
    await expect(rao.getByText(/^Approved and hallmarked\./)).toBeVisible({ timeout: 90_000 });
    await expect(rita.getByText(/^Approved and hallmarked\./)).toBeVisible({ timeout: 90_000 });
    await Promise.all([sent(rao), sent(rita)]);

    // Everyone sees three Hallmarks, #1 to #3, and the chain verifies end to end.
    const admin = people.admin.page;
    await admin.goto("/app/hallmarks");
    for (const n of [1, 2, 3]) await expect(admin.getByText(`#${n} ·`)).toBeVisible({ timeout: 40_000 });
    await admin.getByRole("button", { name: "Verify the chain" }).click();
    await expect(admin.getByText("All 3 Hallmarks verify")).toBeVisible();
    // Two different drafts, two different numbers.
    const seqs = await admin.locator("ol > li").evaluateAll((items) => items.map((li) => /#(\d+) ·/.exec(li.textContent ?? "")?.[1]));
    expect(new Set(seqs.filter(Boolean))).toEqual(new Set(["1", "2", "3"]));
    await expect(rao.getByRole("heading", { name: /Hallmark #[23]/ })).toBeVisible();
    await expect(rita.getByRole("heading", { name: /Hallmark #[23]/ })).toBeVisible();
  });

  test("a link cannot be used twice", async ({ browser }) => {
    const again = await person(browser);
    await again.page.goto(links.cara);
    await again.page.getByRole("button", { name: "Continue to Assay" }).click();
    await expect(again.page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText("That link has expired or was already used. Ask for a new one.");
    await expect(again.page.getByRole("link", { name: "Back to team sign-in" })).toBeVisible();
    await again.ctx.close();
  });

  test("going offline queues a comment, shows it waiting and Offline, and it arrives after coming back", async () => {
    const { page, ctx } = people.cara;
    await page.goto("/app");
    await page.getByRole("link", { name: "Caption A" }).click();
    await page.getByRole("tab", { name: /^Comments/ }).click();
    await expect(chip(page)).toHaveText("Synced", { timeout: 40_000 });
    await ctx.setOffline(true);
    await page.locator("#new-comment").fill("A comment written offline.");
    await page.getByRole("button", { name: "Post", exact: true }).click();
    await expect(page.getByRole("tabpanel").getByText("A comment written offline.")).toBeVisible();
    await expect(chip(page)).toHaveText(/^Offline, \d+ waiting$/, { timeout: 30_000 });

    // The reviewer, on the same draft, has not got it.
    const reviewer = people.rao.page;
    await reviewer.goto("/app");
    await reviewer.getByRole("link", { name: "Caption A" }).click();
    await reviewer.getByRole("tab", { name: /^Comments/ }).click();
    await expect(reviewer.getByText("A comment written offline.")).toHaveCount(0);

    await ctx.setOffline(false);
    await expect(chip(page)).toHaveText("Synced", { timeout: 40_000 });
    await expect(reviewer.getByText("A comment written offline.")).toBeVisible({ timeout: 40_000 });
  });

  test("a stale write shows the server's refusal, and this browser takes the server's copy", async ({ browser }) => {
    const first = people.cara;
    await pasteDraft(first.page, "Caption D");
    await sent(first.page);

    // The same person on a second device, which has the draft too.
    const signIn = await person(browser);
    await signIn.page.goto("/team");
    const form = signIn.page.getByRole("region", { name: "Sign in", exact: true });
    await form.getByLabel("Your email").fill(email("cara"));
    await form.getByRole("button", { name: "Email me a link" }).click();
    await openLink(signIn.page, (await form.getByRole("link", { name: /\/team\/verify#/ }).getAttribute("href"))!);
    await signIn.page.getByRole("link", { name: "Caption D" }).click();
    await expect(signIn.page.getByRole("heading", { level: 1 })).toContainText("Caption D");
    await expect(chip(signIn.page)).toHaveText("Synced", { timeout: 40_000 });

    // The first device goes offline and submits; the second submits first.
    await first.ctx.setOffline(true);
    await first.page.getByRole("button", { name: "Submit for review" }).click();
    await expect(first.page.getByText(/^In review\./)).toBeVisible();
    await submit(signIn.page);
    await sent(signIn.page);
    await first.ctx.setOffline(false);
    await expect(first.page.getByRole("status", { name: "Notifications" })).toContainText("Someone else changed this first.", { timeout: 40_000 });
    await expect(chip(first.page)).toHaveText("Synced", { timeout: 40_000 });
    await signIn.ctx.close();
  });

  test("removing a member cuts off their access", async () => {
    const admin = people.admin.page;
    await admin.goto("/app/team");
    const row = admin.locator(`[data-member="${email("rita")}"]`);
    await expect(row).toContainText("Rita Reviewer");
    await row.getByRole("button", { name: "Remove Rita Reviewer" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(admin.getByRole("status", { name: "Notifications" })).toContainText("Removed Rita Reviewer.");
    await expect(row).toHaveCount(0);

    // Her open browser finds out on its next round, and asks her to sign in; a reload says the same.
    const rita = people.rita.page;
    await expect(chip(rita)).toHaveText("Sign in again", { timeout: 40_000 });
    await expect(rita.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/team");
    await rita.reload();
    await expect(rita.getByRole("heading", { name: "This team workspace can't open yet" })).toBeVisible({ timeout: 40_000 });
    await expect(rita.getByRole("link", { name: "Go to sign-in" })).toBeVisible();
    // The server refuses her directly too.
    const refused = await people.rita.ctx.request.get(`/api/team/sync?workspace=${workspaceId}&cursor=0`);
    expect(refused.status()).toBe(403);
  });

  test("signing out, the app asks to sign in; signing in again brings the work back", async ({ browser }) => {
    const { page } = people.rao;
    await page.goto("/team");
    await expect(page.getByText(`Signed in as ${email("rao")}.`)).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText(`Signed in as ${email("rao")}.`)).toHaveCount(0);
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "This team workspace can't open yet" })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole("alert").filter({ hasText: "Sign in again to open this workspace." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to sign-in" })).toHaveAttribute("href", "/team");
    await expect(page.getByText(/IndexedDB/)).toHaveCount(0);

    // Sign in again from a clean browser: the work is all there.
    const again = await person(browser);
    await again.page.goto("/team");
    const form = again.page.getByRole("region", { name: "Sign in", exact: true });
    await form.getByLabel("Your email").fill(email("rao"));
    await form.getByRole("button", { name: "Email me a link" }).click();
    await openLink(again.page, (await form.getByRole("link", { name: /\/team\/verify#/ }).getAttribute("href"))!);
    await expect(again.page.getByRole("link", { name: "Caption A" })).toBeVisible({ timeout: 40_000 });
    await again.ctx.close();
  });

  test("the pages have no serious accessibility problems", async () => {
    const check = async (page: Page, label: string) => {
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${label} · ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
    };
    const admin = people.admin.page;
    await admin.goto("/app/team");
    await expect(admin.getByRole("region", { name: "Members of this workspace" })).toBeVisible();
    await check(admin, "team page, admin");
    await people.cara.page.goto("/app/team");
    await expect(people.cara.page.getByRole("region", { name: "Members of this workspace" })).toBeVisible();
    await check(people.cara.page, "team page, member");
    await admin.goto("/app");
    await expect(chip(admin)).toBeVisible();
    await check(admin, "drafts in a team workspace");
  });

  test("an admin exports the workspace, then deletes it by typing its name, and everyone is cut off", async () => {
    const admin = people.admin.page;
    await admin.goto("/app/team");
    const [download] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("button", { name: /Export workspace/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^assay-team-northwind-.*\.json$/);
    const path = test.info().outputPath("team-export.json");
    await download.saveAs(path);
    const exported = JSON.parse(await readFile(path, "utf8")) as { app: string; workspace: string; rows: { tbl: string }[] };
    expect(exported.app).toBe("assay-team");
    expect(exported.workspace).toBe(workspaceName);
    expect(exported.rows.some((r) => r.tbl === "hallmarks")).toBe(true);
    expect(exported.rows.some((r) => r.tbl === "submissions")).toBe(true);

    await admin.getByRole("button", { name: "Delete workspace" }).click();
    const dialog = admin.getByRole("dialog", { name: `Delete ${workspaceName}?` });
    const confirm = dialog.getByRole("button", { name: "Delete for everyone" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(`Type ${workspaceName} to confirm`).fill("something else");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(`Type ${workspaceName} to confirm`).fill(workspaceName);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(admin).toHaveURL(/\/team$/, { timeout: 40_000 });
    await expect(admin.getByRole("heading", { name: "Team workspaces", level: 1 })).toBeVisible();
    // The brand is forgotten here, and the server no longer knows the workspace.
    expect(await admin.evaluate(() => localStorage.getItem("assay:brands"))).not.toContain(workspaceName);
    const gone = await people.cara.ctx.request.get(`/api/team/sync?workspace=${workspaceId}&cursor=0`);
    expect(gone.status()).toBe(403);
  });
});
