import { describe, expect, it } from "vitest";
import { VELVRA_KIT } from "@/seed/velvra";
import { analyzeImage, decodeImage, findLogo, ocrLines } from "./visual";
import { findWordmark } from "./visual-core";

async function dataUrl(path: string) {
  const blob = await (await fetch(path)).blob();
  return new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

describe("visual checks on the sample creative", () => {
  // First in the file, so `before` is read in the engine's own mode, not one an earlier logo search restored.
  it("looking for the logo leaves the text reading exactly as it was", { timeout: 60_000 }, async () => {
    const px = await decodeImage(await dataUrl("/samples/velvra-monsoon-creative-fixed.png"));
    const before = await ocrLines(px);
    expect(await findLogo(px, VELVRA_KIT)).toBeTruthy();
    expect(await ocrLines(px)).toEqual(before);
  });

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

  it("finds the wordmark when nobody marked the logo, and measures it", { timeout: 60_000 }, async () => {
    const asset = { dataUrl: await dataUrl("/samples/velvra-monsoon-creative.png"), width: 1080, height: 1080, alt: "", fileName: "creative.png" };
    const report = await analyzeImage(asset, VELVRA_KIT);
    expect(report.logo?.source).toBe("wordmark");
    const logo = report.findings.find((f) => f.ruleId === "VIS-03")!;
    expect(logo.title).toBe("Logo is too small");
    expect(logo.reason).toContain("wordmark");

    const fixed = { ...asset, dataUrl: await dataUrl("/samples/velvra-monsoon-creative-fixed.png"), alt: "A photo", fileName: "fixed.png" };
    const clean = await analyzeImage(fixed, VELVRA_KIT);
    expect(clean.logo?.source).toBe("wordmark");
    expect(clean.findings.map((f) => f.ruleId)).not.toContain("VIS-03");
  });

  it("finishes on a new brand with no palette, and still reports contrast", { timeout: 60_000 }, async () => {
    const asset = { dataUrl: await dataUrl("/samples/velvra-monsoon-creative.png"), width: 1080, height: 1080, alt: "", fileName: "creative.png" };
    const report = await analyzeImage(asset, { ...VELVRA_KIT, palette: [] });
    const ids = report.findings.map((f) => f.ruleId);
    expect(ids).toContain("A11Y-01");
    expect(ids).not.toContain("VIS-01");
    expect(report.findings.find((f) => f.ruleId === "A11Y-01")!.fix?.replacement).toMatch(/at least/);
  });

  it("a name inside a sentence is copy, not a logo", () => {
    const box = { x: 0, y: 0, w: 50, h: 10 };
    const line = (text: string) => ({ text, confidence: 90, box });
    expect(findWordmark([line("Velvra Daily Shield protects you")], VELVRA_KIT)).toBeUndefined();
    expect(findWordmark([line("velvra.")], VELVRA_KIT)).toEqual(box);
    expect(findWordmark(null, VELVRA_KIT)).toBeUndefined();
  });

  it("passes the corrected creative: on palette, readable, logo at size, alt text present", { timeout: 60_000 }, async () => {
    const report = await analyzeImage(
      {
        dataUrl: await dataUrl("/samples/velvra-monsoon-creative-fixed.png"),
        width: 1080,
        height: 1080,
        alt: "A photo of a cream Daily Shield SPF 50 tube beaded with raindrops on a rose-clay backdrop, under the headline Glow like never before.",
        fileName: "creative-fixed.png",
        logoBox: { x: 64, y: 926, w: 134, h: 44 },
      },
      VELVRA_KIT,
    );
    expect(report.findings.map((f) => f.ruleId)).toEqual([]);
    expect(report.lines.some((l) => /glow/i.test(l.text))).toBe(true);
  });
});
