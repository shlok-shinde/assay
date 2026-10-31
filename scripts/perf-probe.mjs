// pnpm perf: walks the judge path in Chromium with the CPU throttled 4x and records every long task and long animation
// frame. It fails on any block over 300 ms, on a check over 30 s (the Round 1 target), or under 55 fps on the landing.
// It needs a running build: pnpm build && pnpm start --port 3300, then PERF_URL=http://localhost:3300 pnpm perf
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.PERF_URL ?? "http://localhost:3300";
const THROTTLE = Number(process.env.PERF_THROTTLE ?? 4);
const MAX_BLOCK = 300;
const MAX_CHECK = 30_000;
const MIN_FPS = 55;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
await page.route("**/api/ai", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "unconfigured", message: "probe" }) }));
await page.addInitScript(() => {
  window.__blocks = [];
  const watch = (type) => {
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__blocks.push({ type, at: Math.round(e.startTime), ms: Math.round(e.duration), where: location.pathname });
      }).observe({ type, buffered: true });
    } catch {
      // This browser doesn't report that entry type.
    }
  };
  watch("longtask");
  watch("long-animation-frame");
});

const fps = (ms) =>
  page.evaluate(
    (span) =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (now) => {
          frames++;
          if (now - start < span) requestAnimationFrame(tick);
          else resolve(Math.round((frames * 1000) / (now - start)));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

const steps = {};
const timed = async (name, fn) => {
  const t0 = Date.now();
  await fn();
  steps[name] = Date.now() - t0;
};

await timed("landing", () => page.goto(BASE, { waitUntil: "networkidle" }));
const landingFps = await fps(2000);
await page.mouse.wheel(0, 2400);
const scrollFps = await fps(2000);
await timed("drafts", () => page.goto(`${BASE}/app`, { waitUntil: "networkidle" }));
await timed("new draft", () => page.goto(`${BASE}/app/new`, { waitUntil: "networkidle" }));
await timed("load sample", async () => {
  await page.getByRole("button", { name: /Monsoon launch: Instagram post/ }).first().click();
  await page.getByRole("button", { name: /^Run check|^Check/ }).first().waitFor({ timeout: 60_000 });
});
await timed("check", async () => {
  await page.getByRole("button", { name: /^Run check|^Check/ }).first().click();
  await page.getByText(/^Findings \d+/).first().waitFor({ timeout: 120_000 });
});
const drawerFound = await page.getByRole("button", { name: /p\.\d+/ }).first().isVisible().catch(() => false);
if (drawerFound) await timed("open citation", () => page.getByRole("button", { name: /p\.\d+/ }).first().click());

const blocks = await page.evaluate(() => window.__blocks);
await browser.close();

const worst = blocks.reduce((n, b) => Math.max(n, b.ms), 0);
const over = blocks.filter((b) => b.ms > MAX_BLOCK);
const result = { ranAt: new Date().toISOString(), throttle: THROTTLE, base: BASE, steps, landingFps, scrollFps, worstBlockMs: worst, blocksOver300ms: over, blocksTotal: blocks.length };
writeFileSync("docs/perf-results.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ ...result, blocksOver300ms: over.length }, null, 2));
const failures = [
  ...over.map((b) => `${b.type} of ${b.ms} ms on ${b.where}`),
  ...(steps.check > MAX_CHECK ? [`check took ${steps.check} ms`] : []),
  ...(landingFps < MIN_FPS ? [`landing ran at ${landingFps} fps`] : []),
];
if (failures.length) {
  console.error("Over budget:\n" + failures.join("\n"));
  process.exit(1);
}
