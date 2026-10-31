"use client";

import { useEffect, useState } from "react";
import { db } from "@/store/db";

// A creative's pixels live once in the blobs table. A register shows many thumbnails, so each key is read
// once and kept for the session.
const seen = new Map<string, string>();

/**
 * A draft's creative, cropped to a round-cornered square, or the channel's initials when the draft is
 * text only. The picture is decoration beside the title, so it is hidden from assistive tech.
 */
export function Thumb({ image, fallback, size = 64, className = "" }: { image?: { blob?: string; dataUrl?: string }; fallback: string; size?: number; className?: string }) {
  const key = image?.blob;
  const [loaded, setLoaded] = useState<{ key: string; src: string } | null>(key && seen.has(key) ? { key, src: seen.get(key)! } : null);
  useEffect(() => {
    if (!key || seen.has(key)) return;
    let live = true;
    void db.blobs.get(key).then((row) => {
      if (!row) return;
      seen.set(key, row.dataUrl);
      if (live) setLoaded({ key, src: row.dataUrl });
    });
    return () => {
      live = false;
    };
  }, [key]);
  const src = image?.dataUrl || (key && loaded?.key === key ? loaded.src : undefined) || (key ? seen.get(key) : undefined);
  const box = { width: size, height: size };
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a stored data URL, not a file the optimiser could serve
    <img src={src} alt="" aria-hidden="true" style={box} className={`flex-none rounded-[18px] bg-active object-cover ${className}`} />
  ) : (
    <span aria-hidden="true" style={box} className={`flex flex-none items-center justify-center rounded-full bg-active text-[13px] font-semibold text-muted ${className}`}>
      {fallback}
    </span>
  );
}
