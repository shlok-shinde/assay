import { describe, expect, it } from "vitest";
import { VELVRA_KIT } from "@/seed/velvra";
import { analyzeImage } from "./visual";

async function dataUrl(path: string) {
  const blob = await (await fetch(path)).blob();
  return new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

describe("visual checks on the sample creative", () => {
  it("finds the off-palette pink, the low-contrast headline, missing alt text and the small logo", { timeout: 60_000 }, async () => {
    const report = await analyzeImage(
      { dataUrl: await dataUrl("/samples/velvra-monsoon-creative.png"), width: 1080, height: 1080, alt: "", fileName: "creative.png", logoBox: { x: 64, y: 940, w: 96, h: 34 } },
      VELVRA_KIT,
    );

    const ids = report.findings.map((f) => f.ruleId).sort();
    expect(ids).toEqual(["A11Y-01", "A11Y-04", "VIS-01", "VIS-03"]);
    const contrast = report.findings.find((f) => f.ruleId === "A11Y-01")!;
    expect(contrast.quote.toLowerCase()).toContain("glow");
  });

  it("passes the corrected creative: on palette, readable, logo at size, alt text present", { timeout: 60_000 }, async () => {
    const report = await analyzeImage(
      {
        dataUrl: await dataUrl("/samples/velvra-monsoon-creative-fixed.png"),
        width: 1080,
        height: 1080,
        alt: "A cream Daily Shield SPF 50 tube on a rose-clay background under the headline Glow like never before.",
        fileName: "creative-fixed.png",
        logoBox: { x: 64, y: 926, w: 134, h: 44 },
      },
      VELVRA_KIT,
    );
    expect(report.findings.map((f) => f.ruleId)).toEqual([]);
    expect(report.lines.some((l) => /glow/i.test(l.text))).toBe(true);
  });
});
