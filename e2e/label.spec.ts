import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// /label is for people who are not in the app, on a phone, and it must keep them blind to how Assay judged a
// draft: no link into the app, no rule codes, nothing that gives an answer away.
test.use({ viewport: { width: 390, height: 844 } });

interface Manifest {
  rules: { id: string; title: string; text: string; channels: string[] }[];
  items: { id: string; channel: string; text: string }[];
  practice: { text: string; answer: string[]; why: string }[];
}
const manifest = JSON.parse(readFileSync("public/label/manifest.json", "utf8")) as Manifest;
const title = (id: string) => manifest.rules.find((r) => r.id === id)!.title;

type Posted = { coder: string; itemId: string; ruleIds: string[]; ms: number };

/** Stubs /api/label: progress for GET, and every answer for POST (which `ok` can refuse). */
async function stubLabel(page: Page, opts: { enabled?: boolean; counts?: Record<string, number>; mine?: string[]; post?: (route: Route) => Promise<void> | void } = {}) {
  const posted: Posted[] = [];
  await page.route("**/api/label**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: opts.enabled ?? true, counts: opts.counts ?? {}, mine: opts.mine ?? [] } });
    if (opts.post) return opts.post(route);
    posted.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  return posted;
}

async function practice(page: Page) {
  await page.goto("/label");
  await page.getByRole("button", { name: "Try two practice drafts" }).click();
  await page.getByLabel("Breaks none of these").check();
  await page.getByRole("button", { name: "Check my answer" }).click();
  await page.getByRole("button", { name: "Next practice draft" }).click();
  await page.getByLabel("Breaks none of these").check();
  await page.getByRole("button", { name: "Check my answer" }).click();
  await page.getByRole("button", { name: /^Start the 20 drafts/ }).click();
  await expect(page.getByRole("heading", { name: "Draft 1 of 20", level: 1 })).toBeVisible();
}

const draftText = (page: Page) => page.locator("section[aria-labelledby='draft-h'] p").first();

/** Answers every draft in the set as "breaks none" and moves on. */
async function finishSet(page: Page, n = 20) {
  for (let i = 0; i < n; i++) {
    await page.getByLabel("Breaks none of these").check();
    await page.getByRole("button", { name: i === n - 1 ? "Finish" : "Next" }).click();
  }
  await expect(page.getByRole("heading", { name: "Thank you", level: 1 })).toBeVisible();
}

test.describe("the labelling page", () => {
  test("says what it is, that the brand is fictional, how long it takes and that answers are anonymous, and links nowhere", async ({ page }) => {
    await stubLabel(page);
    await page.goto("/label");
    await expect(page.getByRole("heading", { name: "Help check some marketing drafts", level: 1 })).toBeVisible();
    await expect(page.getByText("The brand is fictional.")).toBeVisible();
    await expect(page.getByText("About 30 seconds")).toBeVisible();
    await expect(page.getByText("20 at a time")).toBeVisible();
    await expect(page.getByText("Your answers are anonymous.")).toBeVisible();
    // No name is asked for, and no door into the app: a labeller who saw it would stop being blind.
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.locator("a")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/assay/i);
    // Only a random code, kept in the browser.
    const code = await page.evaluate(() => JSON.parse(localStorage.getItem("assay-label:v1") ?? "{}").coder as string);
    expect(code).toMatch(/^[a-z0-9]{10}$/);
    await expect(page.getByText(code)).toBeVisible();
  });

  test("two practice drafts show the answer and the reason after trying, and save nothing", async ({ page }) => {
    const posted = await stubLabel(page);
    await page.goto("/label");
    await page.getByRole("button", { name: "Try two practice drafts" }).click();
    await expect(page.getByRole("heading", { name: "Practice 1 of 2", level: 1 })).toBeVisible();
    await expect(draftText(page)).toHaveText(manifest.practice[0].text);
    // Next-style button is off until there is an answer.
    await expect(page.getByRole("button", { name: "Check my answer" })).toBeDisabled();
    await page.getByLabel(new RegExp(`^${title("VOICE-02")}`)).check();
    await page.getByRole("button", { name: "Check my answer" }).click();
    const feedback = page.locator("[data-practice-feedback]");
    await expect(feedback).toContainText("That is different from the answer.");
    await expect(feedback).toContainText(`The answer: ${manifest.practice[0].answer.map(title).join("; ")}.`);
    await expect(feedback).toContainText(manifest.practice[0].why);
    await expect(feedback).toContainText("Practice answers are not saved.");
    await page.getByRole("button", { name: "Next practice draft" }).click();
    await expect(page.getByRole("heading", { name: "Practice 2 of 2", level: 1 })).toBeVisible();
    await page.getByLabel("Breaks none of these").check();
    await page.getByRole("button", { name: "Check my answer" }).click();
    await expect(page.locator("[data-practice-feedback]")).toContainText("That matches the answer.");
    expect(posted).toEqual([]);
  });

  test("a batch shows one draft at a time with the rules for its channel, and Next saves straight away", async ({ page }) => {
    const email = manifest.items.find((i) => i.channel === "email")!;
    // The email draft has no labels yet and everything else has one, so it comes first.
    const counts = Object.fromEntries(manifest.items.map((i) => [i.id, i.id === email.id ? 0 : 1]));
    const posted = await stubLabel(page, { counts });
    await practice(page);
    await expect(draftText(page)).toHaveText(email.text);
    await expect(page.getByText("Email", { exact: true })).toBeVisible();
    // The email rules: every one that is not limited to another channel, plus the one only email and website have.
    const forEmail = manifest.rules.filter((r) => r.channels.length === 0 || r.channels.includes("email"));
    await expect(page.getByRole("checkbox")).toHaveCount(forEmail.length + 1);
    await expect(page.getByLabel(new RegExp(`^${title("LEGAL-01")}`))).toBeVisible();
    await expect(page.getByLabel("Breaks none of these")).toBeVisible();

    // Not answered yet: Next is off, and the page says what it wants.
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await expect(page.getByText("Tick a rule, or choose “Breaks none of these”.")).toBeVisible();
    await page.getByLabel(new RegExp(`^${title("VOICE-02")}`)).check();
    await page.getByLabel(new RegExp(`^${title("TERM-04")}`)).check();
    await page.getByRole("button", { name: "Next" }).click();

    // It was posted at once, with the anonymous code, the draft's opaque id, the ticked rules and the time taken.
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ itemId: email.id, ruleIds: ["VOICE-02", "TERM-04"] });
    expect(posted[0].coder).toMatch(/^[a-z0-9]{10}$/);
    expect(posted[0].ms).toBeGreaterThanOrEqual(0);
    await expect(page.getByRole("heading", { name: "Draft 2 of 20", level: 1 })).toBeVisible();
    await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible();
  });

  test("the fact list and the channel's limits are one tap away", async ({ page }) => {
    await stubLabel(page);
    await practice(page);
    const channel = manifest.items[0].channel;
    expect(channel).toBe("linkedin");
    await page.getByText("The brand's approved facts").click();
    await expect(page.getByText("In our 4-week study, 82% saw a visibly more even skin tone")).toBeVisible();
    await expect(page.getByText(/Expired 30 Jun 2025/)).toBeVisible();
    await page.getByText("Limits for LinkedIn post").click();
    await expect(page.getByText("Up to 2 emoji")).toBeVisible();
    await expect(page.getByText("Reading ease of at least 40 (higher is easier)")).toBeVisible();
  });

  test("batches go to drafts this person hasn't done, fewest labels first, then in the manifest's order", async ({ page }) => {
    const [a, b, c] = manifest.items;
    // The first draft has plenty of labels, the second is already done by this person.
    await stubLabel(page, { counts: { [a.id]: 5 }, mine: [b.id] });
    await practice(page);
    await expect(draftText(page)).toHaveText(c.text);
  });

  test("shows progress as 7 of 20, goes back to an earlier answer, and keeps ticks through a reload", async ({ page }) => {
    const posted = await stubLabel(page);
    await practice(page);
    for (let i = 0; i < 6; i++) {
      await page.getByLabel("Breaks none of these").check();
      await page.getByRole("button", { name: "Next" }).click();
    }
    await expect(page.getByRole("heading", { name: "Draft 7 of 20", level: 1 })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Progress through this set" })).toHaveAttribute("aria-valuenow", "35");
    // Autosave: ticks are kept on the device the moment they are made.
    await page.getByLabel(new RegExp(`^${title("CLAIM-02")}`)).check();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Draft 7 of 20", level: 1 })).toBeVisible();
    await expect(page.getByLabel(new RegExp(`^${title("CLAIM-02")}`))).toBeChecked();
    // Back works, and shows the answer given there ("breaks none").
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Draft 6 of 20", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Breaks none of these")).toBeChecked();
    // Changing it posts the newer answer for that draft.
    await page.getByLabel(new RegExp(`^${title("MSG-02")}`)).check();
    await expect(page.getByLabel("Breaks none of these")).not.toBeChecked();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Draft 7 of 20", level: 1 })).toBeVisible();
    await expect.poll(() => posted.filter((p) => p.ruleIds.includes("MSG-02")).length).toBe(1);
    // Ticking a rule and choosing "none" are exclusive.
    await page.getByLabel("Breaks none of these").check();
    await expect(page.getByLabel(new RegExp(`^${title("CLAIM-02")}`))).not.toBeChecked();
  });

  test("a finished set thanks the person and offers another, which skips what was done", async ({ page }) => {
    const posted = await stubLabel(page);
    await practice(page);
    const first = await draftText(page).innerText();
    await finishSet(page);
    expect(posted).toHaveLength(20);
    await expect(page.getByText("That is 20 drafts read and answered.")).toBeVisible();
    await expect(page.getByText(`You have now done 20 of ${manifest.items.length}.`)).toBeVisible();
    await page.getByRole("button", { name: "Do another 20" }).click();
    await expect(page.getByRole("heading", { name: "Draft 1 of 20", level: 1 })).toBeVisible();
    expect(await draftText(page).innerText()).not.toBe(first);
    // Nothing already answered comes round again: the next set starts at the 21st draft.
    await expect(draftText(page)).toHaveText(manifest.items[20].text);
    expect(new Set(posted.map((p) => p.itemId)).size).toBe(20);
  });

  test("when saving is off, answers stay on the phone and can be downloaded with the code", async ({ page }) => {
    const posted = await stubLabel(page, { enabled: false });
    await page.goto("/label");
    await expect(page.getByText("Saving to our server is not available right now.")).toBeVisible();
    await practice(page);
    await finishSet(page);
    expect(posted).toEqual([]);
    await expect(page.getByText("Answers are kept on this phone.")).toBeVisible();
    const code = await page.evaluate(() => JSON.parse(localStorage.getItem("assay-label:v1") ?? "{}").coder as string);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my answers" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`my-answers-${code}.json`);
    const body = JSON.parse(readFileSync((await file.path())!, "utf8")) as { coder: string; answers: { itemId: string; ruleIds: string[] }[] };
    expect(body.coder).toBe(code);
    expect(body.answers).toHaveLength(20);
    expect(body.answers.every((a) => Array.isArray(a.ruleIds) && a.ruleIds.length === 0)).toBe(true);
    expect(new Set(body.answers.map((a) => a.itemId)).size).toBe(20);
  });

  test("a failed save shows a retry, keeps the answer, and retrying saves it", async ({ page }) => {
    let fail = true;
    const posted: Posted[] = [];
    await stubLabel(page, {
      post: (route) => {
        if (fail) return route.abort("failed");
        posted.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      },
    });
    await practice(page);
    for (let i = 0; i < 2; i++) {
      await page.getByLabel("Breaks none of these").check();
      await page.getByRole("button", { name: "Next" }).click();
    }
    await expect(page.getByRole("status").getByText(/2 answers are not saved yet/)).toBeVisible();
    // The answers are still on the device.
    const kept = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("assay-label:v1") ?? "{}").answers ?? {}).length);
    expect(kept).toBe(2);
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible();
    expect(posted).toHaveLength(2);
  });

  test("shows nothing that suggests an expected answer", async ({ page }) => {
    await stubLabel(page);
    const manifestSeen = page.waitForResponse("**/label/manifest.json");
    await practice(page);
    const served = (await (await manifestSeen).json()) as Manifest;
    // The manifest a labeller gets carries only opaque ids, the channel and the words.
    for (const item of served.items) expect(Object.keys(item).sort()).toEqual(["channel", "id", "text"]);
    // The page shows rule titles and words, never a rule's code, nor how a draft was judged.
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\b[A-Z]{3,6}-\d{2}\b/);
    expect(text).not.toMatch(/expected|the answer|correct answer|label[s ]|engine|finding|assay/i);
  });

  test("works at 390 px: no sideways scroll, 44 px targets, nothing from the app shell", async ({ page }) => {
    await stubLabel(page);
    await practice(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("button, summary, label:has(input), a")]
        .map((el) => ({ name: (el.textContent ?? "").trim().slice(0, 40), h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
        .filter((t) => t.w > 0 && t.h < 44),
    );
    expect(small).toEqual([]);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "Viewing as" })).toHaveCount(0);
  });

  test("has no serious or critical accessibility violations, on the intro, a draft and the end", async ({ page }) => {
    await stubLabel(page);
    const axe = async () => {
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
    };
    await page.goto("/label");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axe()).toEqual([]);
    await practice(page);
    await page.getByText("The brand's approved facts").click();
    await page.getByLabel(new RegExp(`^${title("VOICE-02")}`)).check();
    expect(await axe()).toEqual([]);
    await page.getByLabel("Breaks none of these").check();
    await page.getByRole("button", { name: "Next" }).click();
    for (let i = 1; i < 20; i++) {
      await page.getByLabel("Breaks none of these").check();
      await page.getByRole("button", { name: i === 19 ? "Finish" : "Next" }).click();
    }
    await expect(page.getByRole("heading", { name: "Thank you", level: 1 })).toBeVisible();
    expect(await axe()).toEqual([]);
  });
});
