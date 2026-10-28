// Runs the pure part of the visual check (palette k-means, per-line contrast) off the main thread,
// so a creative's analysis never freezes the page. The pixel buffer is transferred, not copied.
import { visualFindings, type OcrLine } from "./visual-core";
import type { ImageAsset, KitContent } from "@/lib/types";

export interface VisualJob {
  id: number;
  data: Uint8ClampedArray;
  width: number;
  height: number;
  asset: Omit<ImageAsset, "dataUrl">;
  kit: KitContent;
  lines: OcrLine[] | null;
}

self.onmessage = (e: MessageEvent<VisualJob>) => {
  const { id, data, width, height, asset, kit, lines } = e.data;
  try {
    const report = visualFindings({ data, width, height }, { ...asset, dataUrl: "" }, kit, lines);
    self.postMessage({ id, report });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};
