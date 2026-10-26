"use client";

import { useRef, useState } from "react";
import type { ImageAsset } from "@/lib/types";

type Box = NonNullable<ImageAsset["logoBox"]>;

/**
 * Shows a creative and, when `onBox` is given, lets the creator drag a box
 * around the logo. Boxes are stored in the image's own pixels.
 * `regions` draws numbered finding regions on top.
 */
export function ImageMarker({
  image,
  onBox,
  regions = [],
  selected,
  onSelect,
}: {
  image: ImageAsset;
  onBox?: (b: Box) => void;
  regions?: { id: string; n: number; box: Box; severity: "high" | "medium" | "low" }[];
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<Box | null>(null);

  const toImage = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * image.width, y: ((clientY - r.top) / r.height) * image.height };
  };
  const pct = (b: Box) => ({
    left: `${(b.x / image.width) * 100}%`,
    top: `${(b.y / image.height) * 100}%`,
    width: `${(b.w / image.width) * 100}%`,
    height: `${(b.h / image.height) * 100}%`,
  });
  const shown = live ?? image.logoBox;

  return (
    <div
      ref={ref}
      className={`relative w-full overflow-hidden rounded-[12px] border border-line select-none ${onBox ? "cursor-crosshair touch-none" : ""}`}
      style={{ aspectRatio: `${image.width} / ${image.height}` }}
      onPointerDown={(e) => {
        if (!onBox) return;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setDrag(toImage(e.clientX, e.clientY));
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = toImage(e.clientX, e.clientY);
        setLive({ x: Math.min(p.x, drag.x), y: Math.min(p.y, drag.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) });
      }}
      onPointerUp={() => {
        if (live && live.w > 4 && live.h > 4) onBox?.(live);
        setDrag(null);
        setLive(null);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the user's own file */}
      <img src={image.dataUrl} alt={image.alt || `Creative ${image.fileName} (no alt text yet)`} className="absolute inset-0 h-full w-full" draggable={false} />
      {shown && (
        <div className="absolute rounded-[3px] border-2 border-dashed border-gold" style={pct(shown)} aria-hidden="true">
          <span className="absolute -top-6 left-0 whitespace-nowrap rounded-full bg-ink px-2 py-0.5 text-[11px] font-medium text-sheet">
            Logo {Math.round(shown.w)} px
          </span>
        </div>
      )}
      {regions.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onSelect?.(r.id)}
          aria-label={`Finding ${r.n}`}
          className={`absolute rounded-[6px] border-2 ${r.severity === "high" ? "border-negative" : r.severity === "medium" ? "border-warn-mark border-dashed" : "border-faint border-dotted"} ${
            selected === r.id ? "ring-2 ring-gold ring-offset-1" : ""
          }`}
          style={pct(r.box)}
        >
          <span className="marker absolute left-1 top-1 !ml-0">{r.n}</span>
        </button>
      ))}
    </div>
  );
}
