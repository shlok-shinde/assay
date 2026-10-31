import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { freshWorkspace, role, stubAi } from "./helpers";

// The clock is fixed, so the seeded facts have the same days left on every run: F-107 (Marketing) expires on
// 2026-11-20, 20 days after this, and F-115 (Marketing Insights) expired on 2025-06-30, 488 days before.
const NOW = new Date("2026-10-31T10:00:00Z");

async function openInbox(page: Page, mail: { enabled: boolean } = { enabled: false }) {
  await page.clock.setFixedTime(NOW);
  await stubAi(page, "off");
  await page.route("**/api/demo/fact-alert", (route) => (route.request().method() === "GET" ? route.fulfill({ json: mail }) : route.fallback()));
  await freshWorkspace(page);
  await page.goto("/app/inbox");
  await expect(page.getByRole("heading", { name: "What expires, and who owns it?", level: 1 })).toBeVisible();
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test.describe("The expiry inbox", () => {
  test("groups alerts by owner, with each fact's strip and its days left worked out from today", async ({ page }) => {
    await openInbox(page);
    // The sentence under the title is the finding: the soonest facts, with their owners.
    await expect(page.getByText(/2 facts need attention: F-115 expired 488 days ago \(Marketing Insights\); F-107 expires in 20 days \(Marketing\)\./)).toBeVisible();

    const insights = page.getByRole("region", { name: "Marketing Insights" });
    const marketing = page.getByRole("region", { name: "Marketing", exact: true });
    await expect(insights.locator("[data-fact]")).toHaveCount(1);
    await expect(insights.locator("[data-fact='F-115']")).toContainText("Expired 488 days ago");
    await expect(marketing.locator("[data-fact]")).toHaveCount(1);
    await expect(marketing.locator("[data-fact='F-107']")).toContainText("20 days left");

    // The validity strip, with today on it, in words for assistive tech.
    await expect(marketing.getByRole("img", { name: "Valid from 15 Sept 2026, valid to 20 Nov 2026. Today is 31 Oct 2026: it expires in 20 days." })).toBeVisible();
    await expect(insights.getByRole("img", { name: /^Valid from 1 Jul 2024, valid to 30 Jun 2025\. Today is 31 Oct 2026: it expired 488 days ago\.$/ })).toBeVisible();
    // The bar's marker sits between its ends: F-107 is 66 days long and 46 of them are behind it (about 70%).
    const strip = marketing.getByRole("img", { name: /^Valid from/ });
    const marker = strip.locator("span").last();
    const [s, m] = [await strip.boundingBox(), await marker.boundingBox()];
    const at = (m!.x + m!.width / 2 - s!.x) / s!.width;
    expect(at).toBeGreaterThan(0.66);
    expect(at).toBeLessThan(0.74);
  });

  test("labels a demo address plainly, and the sidebar counts unread alerts only while there are some", async ({ page }) => {
    await openInbox(page);
    const insights = page.getByRole("region", { name: "Marketing Insights" });
    await expect(insights.getByText("Demo address")).toBeVisible();
    await expect(insights.getByText("marketing-insights@velvra.example")).toBeVisible();
    await expect(insights.getByText("is a made-up demo address. It receives no mail.")).toBeVisible();
    // No mailto link and no address field for a demo owner.
    await expect(page.locator("a[href^='mailto:']")).toHaveCount(0);
    await expect(page.getByLabel(/^Email address for/)).toHaveCount(0);

    await expect(nav(page).getByRole("link", { name: "Expiry inbox 2" })).toBeVisible();
    await page.getByRole("region", { name: "Marketing", exact: true }).getByRole("button", { name: "Mark read" }).click();
    await expect(nav(page).getByRole("link", { name: "Expiry inbox 1" })).toBeVisible();
    await page.getByRole("button", { name: "Mark all read" }).click();
    // Nothing unread: the number goes, and the link is just its name.
    await expect(nav(page).getByRole("link", { name: "Expiry inbox", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
    await expect(page.getByText("1 fact · all read").first()).toBeVisible();
  });

  test("Guideline Health links into it with a one-line summary", async ({ page }) => {
    await openInbox(page);
    await page.goto("/app/health");
    await expect(page.getByText(/2 facts need attention: F-115, F-107 \(1 expired, 1 within 30 days\)\./)).toBeVisible();
    await page.getByRole("link", { name: "Open the expiry inbox" }).click();
    await expect(page).toHaveURL(/\/app\/inbox$/);
  });

  test("hides the send form and says why when email is not set up on this deployment", async ({ page }) => {
    await openInbox(page, { enabled: false });
    await expect(page.getByText("Email isn't set up on this deployment, so this demo can't send an alert to your inbox.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send this alert to yourself" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send email" })).toHaveCount(0);
  });

  test("sends one fixed alert to yourself, and shows the server's own message when it refuses", async ({ page }) => {
    const sent: { factId: string; email: string }[] = [];
    await openInbox(page, { enabled: true });
    await page.route("**/api/demo/fact-alert", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
      sent.push(route.request().postDataJSON());
      if (sent.length === 1) return route.fulfill({ status: 429, json: { ok: false, reason: "limit", message: "That inbox has already had its demo email today." } });
      return route.fulfill({ json: { ok: true, subject: "Claim Ledger: F-107 expires in 20 days" } });
    });
    await page.reload();
    await expect(page.getByRole("button", { name: "Send this alert to yourself" })).toHaveCount(2);
    await expect(page.getByText("Email isn't set up on this deployment")).toHaveCount(0);

    const row = page.locator("[data-fact='F-107']");
    await row.getByRole("button", { name: "Send this alert to yourself" }).click();
    await expect(row.getByText("Only this fixed message is sent, once, to that address.")).toBeVisible();
    // A bad address is stopped here, with its own message.
    await row.getByLabel("Your email address, for F-107").fill("not-an-address");
    await row.getByRole("button", { name: "Send email" }).click();
    await expect(row.getByText("Enter a valid email address.")).toBeVisible();
    expect(sent).toEqual([]);

    await row.getByLabel("Your email address, for F-107").fill("judge@example.org");
    await row.getByRole("button", { name: "Send email" }).click();
    await expect(row.getByRole("alert").filter({ hasText: "That inbox has already had its demo email today." })).toBeVisible();
    expect(sent).toEqual([{ factId: "F-107", email: "judge@example.org" }]);

    await row.getByRole("button", { name: "Send email" }).click();
    await expect(row.getByRole("status").filter({ hasText: "Sent: “Claim Ledger: F-107 expires in 20 days”" })).toBeVisible();
    expect(sent).toHaveLength(2);
  });

  test("a brand with no address asks for one, then gets a mail link with the alert written", async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await stubAi(page, "off");
    await page.addInitScript(() => {
      localStorage.setItem("assay:brands", JSON.stringify([{ id: "northwind", name: "Northwind", dbName: "assay-northwind", kitId: "northwind", demo: false }]));
      localStorage.setItem("assay:active-brand", "northwind");
    });
    // A fact with an owner and an expiry date, published, so the inbox has something to raise.
    await page.goto("/app/kit?tab=facts");
    await page.getByRole("button", { name: "Add fact" }).click();
    await page.getByLabel("Statement").fill("Free delivery on orders over 500 rupees.");
    await page.getByLabel("Approved wording").fill("Free delivery on orders over ₹500");
    await page.getByLabel("Owner", { exact: true }).fill("Logistics");
    await page.getByLabel("Valid to").fill("2026-11-10");
    await page.getByRole("form", { name: "New fact" }).getByRole("button", { name: "Add fact" }).click();
    await expect(page.getByRole("status", { name: "Notifications" })).toContainText("Saved F-101 to the draft.");
    await page.getByRole("button", { name: "Publish v1.1" }).click();
    await expect(page.getByText(/^Published rulebook v1\.1\./)).toBeVisible();

    await page.goto("/app/inbox");
    const owner = page.getByRole("region", { name: "Logistics" });
    await expect(owner.locator("[data-fact='F-101']")).toContainText("10 days left");
    // No demo label here: the address is missing, so it is asked for.
    await expect(owner.getByText("Demo address")).toHaveCount(0);
    const email = owner.getByLabel("Email address for Logistics");
    await email.fill("nope");
    await owner.getByRole("button", { name: "Save address" }).click();
    await expect(owner.getByText("Enter a full email address, with an @ and a domain.")).toBeVisible();
    await email.fill("logistics@northwind.test");
    await owner.getByRole("button", { name: "Save address" }).click();
    await expect(owner.getByText("logistics@northwind.test")).toBeVisible();

    // The way to send it is the owner's own mail app, with the subject and body already written.
    const link = owner.getByRole("link", { name: /Send to Logistics from your mail app/ });
    const href = decodeURIComponent((await link.getAttribute("href"))!);
    expect(href).toMatch(/^mailto:logistics@northwind\.test\?subject=Northwind Claim Ledger: F-101 expires in 10 days&body=Hello Logistics,/);
    expect(href).toContain("F-101: Free delivery on orders over 500 rupees.");
    // And the demo's one-email form is only for the demo.
    await expect(page.getByRole("button", { name: "Send this alert to yourself" })).toHaveCount(0);
  });

  test("has no serious or critical accessibility violations", async ({ page }) => {
    await openInbox(page, { enabled: true });
    await page.locator("[data-fact='F-107']").getByRole("button", { name: "Send this alert to yourself" }).click();
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
  });
});

test("a Brand Admin is needed to add an owner's address", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await stubAi(page, "off");
  await page.addInitScript(() => {
    localStorage.setItem("assay:brands", JSON.stringify([{ id: "northwind", name: "Northwind", dbName: "assay-northwind", kitId: "northwind", demo: false }]));
    localStorage.setItem("assay:active-brand", "northwind");
  });
  await page.goto("/app/kit?tab=facts");
  await page.getByRole("button", { name: "Add fact" }).click();
  await page.getByLabel("Statement").fill("A fact.");
  await page.getByLabel("Approved wording").fill("A fact.");
  await page.getByLabel("Owner", { exact: true }).fill("Legal");
  await page.getByLabel("Valid to").fill("2026-11-02");
  await page.getByRole("form", { name: "New fact" }).getByRole("button", { name: "Add fact" }).click();
  await page.getByRole("button", { name: "Publish v1.1" }).click();
  await expect(page.getByText(/^Published rulebook v1\.1\./)).toBeVisible();
  await role(page, "Creator");
  await page.goto("/app/inbox");
  await expect(page.getByLabel("Email address for Legal")).toBeDisabled();
  await expect(page.getByText("Only a Brand Admin can add an address.")).toBeVisible();
});
