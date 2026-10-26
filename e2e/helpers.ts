import { expect, type Page } from "@playwright/test";

export const LIVE = !!process.env.E2E_LIVE;

/** Stubs the AI so the suite is deterministic: one agreeing finding and one invented one the verifier must drop. */
export async function stubAi(page: Page, mode: "ok" | "rate_limited" | "off" = "ok") {
  if (LIVE) return;
  await page.route("**/api/status", (route) =>
    route.fulfill({
      json: { aiConfigured: mode !== "off", keyCount: mode === "off" ? 0 : 2, keysAvailable: mode === "off" ? 0 : 2, models: { judge: ["stub-model"], lite: ["stub-lite"] } },
    }),
  );
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON() as { task: string; input: { segments?: { id: string; text: string }[] } };
    if (mode === "rate_limited") return route.fulfill({ json: { ok: false, reason: "rate_limited", message: "busy" } });
    if (body.task === "judge") {
      const findings = [];
      for (const s of body.input.segments ?? []) {
        const at = s.text.indexOf("OMG");
        if (at >= 0) findings.push({ segment: s.id, rule_id: "VOICE-02", quote: "OMG", start: at, end: at + 3, reason: "Hype word.", fix: "Meet", confidence: 0.86 });
        findings.push({ segment: s.id, rule_id: "VOICE-01", quote: "a sentence that is not in the draft", start: 0, end: 10, reason: "Invented.", fix: "", confidence: 0.9 });
      }
      return route.fulfill({ json: { ok: true, data: { findings, factChoices: [] }, model: "stub-model", ms: 5, redactions: 0 } });
    }
    if (body.task === "intentCheck") return route.fulfill({ json: { ok: true, data: { kept: true, explanation: "Still about daily protection." }, model: "stub-lite", ms: 5, redactions: 0 } });
    return route.fulfill({ json: { ok: false, reason: "error", message: "not stubbed" } });
  });
}

export async function freshWorkspace(page: Page) {
  await page.goto("/app");
  await page.evaluate(() => new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase("assay");
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  }));
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible();
}

export async function role(page: Page, name: "Creator" | "Reviewer" | "Compliance" | "Brand Admin") {
  await page.getByRole("radio", { name }).first().click();
  await expect(page.getByRole("radio", { name }).first()).toHaveAttribute("aria-checked", "true");
}

export function card(page: Page, n: number) {
  return page.getByRole("article", { name: `Finding ${n}`, exact: true });
}
