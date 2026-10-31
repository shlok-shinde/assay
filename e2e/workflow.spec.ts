import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { freshWorkspace, role, ruleCard, stubAi } from "./helpers";

/** Starts a draft from scratch with its Intent Card filled in, runs the check, and waits for the draft's screen. */
async function checkedDraft(page: Page, d: { title: string; channel: string; text: string; keyMessage?: string; cta?: string }) {
  await page.goto("/app/new");
  await page.locator("#title").fill(d.title);
  await page.locator("#channel").selectOption(d.channel);
  await page.locator("#copy").fill(d.text);
  await page.locator("#intent-goal").fill("Launch awareness");
  await page.locator("#intent-keyMessage").fill(d.keyMessage ?? "");
  await page.locator("#intent-cta").fill(d.cta ?? "");
  await page.getByLabel("I confirm this is what the draft is for").check();
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(d.title, { timeout: 60_000 });
}

/** Overrides one AI task's answer for this page; every other task falls through to stubAi. */
async function answerAi(page: Page, task: string, reply: (body: { input: Record<string, unknown> }) => unknown) {
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON() as { task: string; input: Record<string, unknown> };
    if (body.task !== task) return route.fallback();
    return route.fulfill({ json: { ok: true, data: reply(body), model: "stub-lite", ms: 5, redactions: 0 } });
  });
}

/** A finding card by rule, on any version (ruleCard skips the ones labelled with an earlier version). */
const anyCard = (page: Page, ruleId: string) => page.getByRole("article").filter({ hasText: new RegExp(`${ruleId} ·`) }).first();

/** Opens the Instagram sample and waits for its check: eight findings, two of them high-severity claims. */
async function checkedSample(page: Page) {
  await stubAi(page);
  await freshWorkspace(page);
  await page.goto("/app/new?sample=instagram-launch");
  await expect(page.locator("#copy")).toHaveValue(/OMG/);
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Monsoon launch: Instagram post", { timeout: 60_000 });
  await expect(page.getByText("2 high-severity still open")).toBeVisible();
}

test.describe("Compliance sends a claim back", () => {
  test("the creator sees it, answers with a new version, and it returns to Compliance", async ({ page }) => {
    await checkedSample(page);
    await expect(page.getByRole("img", { name: "Checked; not yet fixed, cleared or hallmarked" })).toBeVisible();

    // Fix the claims and the term, dismiss the tone finding with a reason, apply, submit.
    for (const id of ["CLAIM-01", "CLAIM-03", "TERM-04"]) await ruleCard(page, id).getByRole("button", { name: "Accept" }).click();
    const tone = ruleCard(page, "VOICE-02");
    await tone.getByRole("button", { name: "Dismiss with reason" }).click();
    await tone.getByRole("textbox").fill("Launch-day post, playful tone agreed with the brand lead");
    await tone.getByRole("button", { name: "Confirm" }).click();
    await page.getByRole("button", { name: "Apply 3 fixes" }).click();
    await expect(page.getByRole("tab", { name: /Versions 2/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("img", { name: "Checked, fixed; not yet cleared or hallmarked" })).toBeVisible();
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("2 claims wait for Compliance")).toBeVisible();

    // Compliance sends CLAIM-01 back with a reason.
    await role(page, "Compliance");
    const claim = anyCard(page, "CLAIM-01");
    await claim.getByRole("button", { name: "Send back" }).click();
    await claim.getByRole("textbox").fill("Needs the panel citation");
    await claim.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("button", { name: "Approve claim" })).toHaveCount(1);

    // The creator finds it in Needs action, with the reason and the way forward, and cannot submit yet.
    await role(page, "Creator");
    await expect(page.getByRole("radio", { name: /^Needs action/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Compliance sent back CLAIM-01: Needs the panel citation. Edit the draft to make a new version, then submit again; the claim goes back to Compliance.")).toBeVisible();
    await expect(anyCard(page, "CLAIM-01")).toContainText("Reopened by");
    await expect(anyCard(page, "CLAIM-01")).toContainText("Needs the panel citation");
    await expect(anyCard(page, "CLAIM-01")).toContainText("v1");
    await expect(page.getByRole("button", { name: "Submit for review" })).toBeDisabled();

    // Editing the draft makes v3; submitting then sends the claim back to Compliance.
    await page.getByRole("button", { name: "Edit text" }).click();
    const text = page.getByLabel("Edit the draft");
    await text.fill(`${await text.inputValue()}\n\nBrowse the Daily Shield range.`);
    await page.getByRole("button", { name: "Save as v3 and re-check" }).click();
    await expect(page.getByRole("tab", { name: /Versions 3/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Submit for review" })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("2 claims wait for Compliance")).toBeVisible();
    await expect(page.getByRole("img", { name: "Checked, fixed; not yet cleared or hallmarked" })).toBeVisible();

    await role(page, "Compliance");
    await expect(anyCard(page, "CLAIM-01").getByRole("button", { name: "Approve claim" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve claim" })).toHaveCount(2);

    // Compliance clears both; the reviewer approves over what is still open, and the strip is complete.
    await page.getByRole("button", { name: "Approve claim" }).first().click();
    await page.getByRole("button", { name: "Approve claim" }).first().click();
    await expect(page.getByRole("button", { name: "Approve claim" })).toHaveCount(0);
    await expect(page.getByRole("img", { name: "Checked, fixed, cleared; not yet hallmarked" })).toBeVisible();
    await role(page, "Reviewer");
    await page.getByLabel(/Reason to approve with (them|it) open/).fill("Creative already printed; corrected version ships next week");
    await page.getByRole("button", { name: /^Approve with \d+ open$/ }).click();
    await expect(page.getByRole("heading", { name: "Hallmark #1" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Checked, fixed, cleared and hallmarked" })).toBeVisible();
  });
});

test.describe("Contesting a high-severity claim", () => {
  test("does not clear it: the claim reaches Compliance with the contest on it", async ({ page }) => {
    await checkedSample(page);
    for (const id of ["CLAIM-01", "CLAIM-03"]) {
      const c = ruleCard(page, id);
      await c.getByRole("button", { name: "Contest rule" }).click();
      // The form says plainly what contesting does and does not do.
      await expect(c.getByText("Contesting does not clear a high-severity finding: Compliance decides this claim when you submit.")).toBeVisible();
      await c.getByRole("textbox").fill("The rule is stricter than the brand book");
      await c.getByRole("button", { name: "Confirm" }).click();
      await expect(c.getByText(/Contesting does not clear this claim/)).toBeVisible();
    }
    await expect(page.getByText(/2 contested claims go to Compliance when you submit/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for review" })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("2 claims wait for Compliance")).toBeVisible();

    await role(page, "Compliance");
    const claim = ruleCard(page, "CLAIM-01");
    await expect(claim.getByRole("button", { name: "Approve claim" })).toBeVisible();
    await expect(claim).toContainText("Rule contested by");
    await expect(claim).toContainText("The rule is stricter than the brand book");
  });
});

test.describe("Drafts that cannot be opened", () => {
  test("seeded history and an unknown id show a plain screen, not a crash", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));

    await page.goto("/app/s/seed_sub_01");
    await expect(page.getByText(/is part of the seeded demo history/)).toBeVisible();
    await expect(page.locator("#main").getByRole("link", { name: "See Guideline Health" })).toBeVisible();
    await page.getByRole("link", { name: "Back to drafts" }).click();
    await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible();

    await page.goto("/app/s/not-a-draft");
    await expect(page.getByText("This draft is not in this browser's workspace.")).toBeVisible();
    await expect(page.getByText("This screen stopped working")).toHaveCount(0);
    expect(crashes).toEqual([]);
  });
});

test.describe("Pages and states that are not the happy path", () => {
  test("an unknown route shows the not-found page and a way back", async ({ page }) => {
    const res = await page.goto("/app/does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page isn't here", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Back to drafts" }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test("blocked storage gets a plain explanation and a Try again, not a crash", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await page.addInitScript(() => Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true }));
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Assay can't open its workspace", level: 1 })).toBeVisible();
    await expect(page.getByText(/private or incognito window/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("a tab whose database another tab upgraded shows a banner with Reload", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await page.evaluate(() => window.dispatchEvent(new Event("assay:db-stale")));
    const banner = page.getByRole("alert").filter({ hasText: "Assay was updated in another tab" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Reload" })).toBeVisible();
    await banner.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible();
    await expect(banner).toHaveCount(0);
  });

  test("the reset confirmation closes on Escape and on Cancel, and focus returns to its button", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    const reset = page.getByRole("button", { name: "Reset demo" });
    const dialog = page.getByRole("dialog", { name: "Reset the demo?" });

    await reset.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(reset).toBeFocused();

    await reset.click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(reset).toBeFocused();
    await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible();
  });
});

// Two real rules want the same words here: Never hype (VOICE-02) takes "OMG" and the emoji after it, and
// the emoji limit (A11Y-05, Instagram allows three) takes the fourth emoji, which sits inside those words.
const COLLIDING = "OMG 😍🔥💧🌞 our new Daily Shield is here. Shop now via the link in bio";

test.describe("Fixes that want the same words", () => {
  /** Accepts both colliding fixes, presses Apply, and returns the resolver. */
  async function toResolver(page: Page, answers?: () => Promise<void>) {
    await stubAi(page);
    // Registered after the stub, so it answers first.
    await answers?.();
    await freshWorkspace(page);
    await checkedDraft(page, { title: "Shield launch post", channel: "instagram", text: COLLIDING, keyMessage: "Daily Shield is here", cta: "Shop now via the link in bio" });
    await ruleCard(page, "VOICE-02").getByRole("button", { name: "Accept" }).click();
    await ruleCard(page, "A11Y-05").getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText(/2 accepted fixes ready to apply as v2\. 1 place where fixes want the same words/)).toBeVisible();
    await page.getByRole("button", { name: "Apply 2 fixes" }).click();
    const resolver = page.getByRole("dialog", { name: "Two accepted fixes want the same words" });
    await expect(resolver).toBeVisible();
    return resolver;
  }

  /** Presses a card, as a person does: the radio inside it is hidden, and the whole card is the target. */
  const pick = (resolver: Locator, text: string | RegExp) => resolver.getByText(text).first().click();
  const draftText = (page: Page) => page.locator("section[aria-labelledby='draft-h']");
  const applied = async (page: Page) => expect(page.getByRole("tab", { name: /Versions 2/ })).toBeVisible({ timeout: 60_000 });

  test("shows the sentence and each fix's result, with the more serious rule chosen", async ({ page }) => {
    const resolver = await toResolver(page);
    // The sentence before, with the contested words marked, then each fix's own result and the code's merge.
    await expect(resolver.getByText("OMG 😍🔥💧🌞 our new Daily Shield is here.").first()).toBeVisible();
    const hype = resolver.getByRole("radio", { name: /VOICE-02/ });
    const emoji = resolver.getByRole("radio", { name: /A11Y-05/ });
    await expect(hype).toBeChecked();
    await expect(emoji).not.toBeChecked();
    await expect(resolver.getByText("More serious rule", { exact: true })).toBeVisible();
    await expect(resolver.locator("#" + (await hype.getAttribute("aria-describedby")))).toHaveText(/^Our new Daily Shield is here\./);
    await expect(resolver.locator("#" + (await emoji.getAttribute("aria-describedby")))).toHaveText(/^OMG 😍🔥💧 our new Daily Shield is here\./);
    await expect(resolver.getByRole("radio", { name: /Both fixes together/ })).toBeVisible();
    await expect(resolver.getByRole("radio", { name: /Write my own/ })).toBeVisible();
    // Cancel leaves everything as it was: still two accepted fixes, nothing applied.
    await resolver.getByRole("button", { name: "Cancel" }).click();
    await expect(resolver).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Apply 2 fixes" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Versions 1/ })).toBeVisible();
  });

  test("has no serious or critical accessibility violations", async ({ page }) => {
    const resolver = await toResolver(page);
    await resolver.getByRole("button", { name: "Ask the AI to merge" }).click();
    await pick(resolver, "Write my own");
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    const results = await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
  });

  test("the default applies the more serious rule's fix and keeps the other for the next version", async ({ page }) => {
    const resolver = await toResolver(page);
    await resolver.getByRole("button", { name: "Apply with these choices" }).click();
    await applied(page);
    await expect(draftText(page)).toContainText("Our new Daily Shield is here. Shop now via the link in bio");
    await expect(draftText(page)).not.toContainText("OMG");
    // The emoji fix lost these words; its decision is kept and said so on its card from the earlier version.
    await page.locator("details.history > summary").click();
    await expect(page.getByText("This fix waits for the next version: another fix changed the same words.")).toBeVisible();
  });

  test("choosing the other fix applies that one, and the first waits", async ({ page }) => {
    const resolver = await toResolver(page);
    await pick(resolver, "A11Y-05");
    await expect(resolver.getByRole("radio", { name: /A11Y-05/ })).toBeChecked();
    await resolver.getByRole("button", { name: "Apply with these choices" }).click();
    await applied(page);
    await expect(draftText(page)).toContainText("OMG 😍🔥💧 our new Daily Shield is here.");
    // The fix that waited is still accepted on the new version, ready to apply.
    await expect(page.getByRole("button", { name: "Apply 1 fix" })).toBeVisible({ timeout: 30_000 });
  });

  test("both fixes together uses the code's merge", async ({ page }) => {
    const resolver = await toResolver(page);
    await pick(resolver, "Both fixes together");
    await expect(resolver.getByRole("radio", { name: /Both fixes together/ })).toBeChecked();
    await resolver.getByRole("button", { name: "Apply with these choices" }).click();
    await applied(page);
    await expect(draftText(page)).toContainText("Our new Daily Shield is here. Shop now via the link in bio");
    await expect(draftText(page)).not.toContainText("OMG");
    await expect(page.getByRole("button", { name: "Apply 1 fix" })).toHaveCount(0);
  });

  test("write my own passes the words through, and needs some", async ({ page }) => {
    const resolver = await toResolver(page);
    await pick(resolver, "Write my own");
    await expect(resolver.getByRole("radio", { name: /Write my own/ })).toBeChecked();
    const apply = resolver.getByRole("button", { name: "Apply with these choices" });
    await expect(apply).toBeDisabled();
    await resolver.getByLabel("Words to put where both fixes were looking").fill("Meet ");
    await expect(apply).toBeEnabled();
    await apply.click();
    await applied(page);
    await expect(draftText(page)).toContainText("Meet our new Daily Shield is here. Shop now via the link in bio");
  });

  test("the AI's merge is offered when asked, and used when it passes", async ({ page }) => {
    const resolver = await toResolver(page, () => answerAi(page, "mergeFixes", () => ({ text: "Launch day: ", explanation: "Keeps the launch feel and drops the hype and the emoji." })));
    await expect(resolver.getByRole("radio", { name: /The AI's merge/ })).toHaveCount(0);
    await resolver.getByRole("button", { name: "Ask the AI to merge" }).click();
    const merge = resolver.getByRole("radio", { name: /The AI's merge/ });
    await expect(merge).toBeChecked();
    await expect(resolver.getByText("Keeps the launch feel and drops the hype and the emoji.")).toBeVisible();
    await resolver.getByRole("button", { name: "Apply with these choices" }).click();
    await applied(page);
    await expect(draftText(page)).toContainText("Launch day: our new Daily Shield is here.");
  });

  test("a merge the validation refuses is shown as refused, and nothing changes", async ({ page }) => {
    const resolver = await toResolver(page, () => answerAi(page, "mergeFixes", () => ({ text: "Save 50% today: ", explanation: "A stronger hook." })));
    await resolver.getByRole("button", { name: "Ask the AI to merge" }).click();
    await expect(resolver.getByRole("alert").filter({ hasText: "The AI's merge was rejected." })).toBeVisible();
    await expect(resolver.getByRole("radio", { name: /The AI's merge/ })).toHaveCount(0);
    await expect(resolver.getByRole("radio", { name: /VOICE-02/ })).toBeChecked();
  });

  test("fixes that sit side by side apply straight away, as before, and are said to have been read together", async ({ page }) => {
    await stubAi(page);
    await freshWorkspace(page);
    await checkedDraft(page, { title: "Offer post", channel: "email", text: "Our new sunblock is here and the best serum in India. Shop now via the link in bio.", keyMessage: "Our new product is here", cta: "Shop now" });
    for (const id of ["TERM-04", "CLAIM-03"]) await ruleCard(page, id).getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText(/1 sentence changed by more than one fix without overlapping: they apply together and are read together as one result\./)).toBeVisible();
    await page.getByRole("button", { name: "Apply 2 fixes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Versions 2/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/One sentence had several fixes that did not overlap, so the intent check read each as one result\./)).toBeVisible();
  });
});

test.describe("The intent check on every fix", () => {
  test("a fix that loses the message needs a reason, and the reason stays on the card", async ({ page }) => {
    await stubAi(page);
    // The AI agrees with the term check that the product's name is gone.
    await answerAi(page, "intentCheckBatch", ({ input }) => ({ results: (input.fixes as { id: string }[]).map((f) => ({ id: f.id, kept: false, explanation: "The product is no longer named." })) }));
    await freshWorkspace(page);
    await checkedDraft(page, { title: "Sunblock post", channel: "instagram", text: "Our new sunblock is here. Shop now via the link in bio", keyMessage: "The new sunblock is here", cta: "Shop now via the link in bio" });
    const card = ruleCard(page, "TERM-04");
    await expect(card.locator("[data-intent='lost']")).toContainText("Intent may be lost: The product is no longer named", { timeout: 30_000 });

    // Accept does not accept yet: it asks why, and Confirm waits for the reason.
    await card.getByRole("button", { name: "Accept" }).click();
    await expect(card.getByText("This fix may lose the message. Why accept it anyway?")).toBeVisible();
    await expect(card.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await card.getByRole("textbox").fill("The campaign is about the range, not the product name");
    await card.getByRole("button", { name: "Confirm" }).click();
    await expect(card.getByText("Fix accepted")).toBeVisible();
    await expect(card.getByText(/Accepted over the intent check by Riya \(agency intern\): “The campaign is about the range, not the product name”/)).toBeVisible();
  });

  test("a card never calls an unchecked fix kept, and a hand edit's version says it was not checked", async ({ page }) => {
    await stubAi(page, "off");
    await freshWorkspace(page);
    await checkedDraft(page, { title: "Bare post", channel: "instagram", text: "OMG our new sunblock is here. Shop now" });
    const card = ruleCard(page, "VOICE-02");
    await expect(card.locator("[data-intent='unchecked']")).toContainText("Intent not checked");
    await expect(card.locator("[data-intent='kept']")).toHaveCount(0);
    await expect(card).not.toContainText("Intent kept");

    await page.getByRole("button", { name: "Edit text" }).click();
    await page.getByLabel("Edit the draft").fill("Our new sunblock is here. Shop now");
    await page.getByRole("button", { name: "Save as v2 and re-check" }).click();
    await expect(page.getByRole("tab", { name: /Versions 2/ })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: /Versions 2/ }).click();
    const list = page.getByRole("list").filter({ has: page.getByRole("button", { name: /^v2 / }) });
    await expect(list.locator("[data-intent='unchecked']")).toContainText("Intent not checked");
    await expect(list.locator("[data-intent='kept']")).toHaveCount(0);
  });
});
