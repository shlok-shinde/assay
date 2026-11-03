"use client";

// A hash that scrambles through hexadecimal and settles on its real value, each time `run` goes up. It is
// one short tween on one small element, only when motion is allowed, and the real text is in the page
// the whole time, so nothing depends on the move.
import { useRef } from "react";
import { gsap } from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { useGSAP } from "@gsap/react";
import { motionAllowed } from "./motion";

gsap.registerPlugin(useGSAP, ScrambleTextPlugin);

export function ScrambleHash({ text, run, title, className = "" }: { text: string; run: number; title?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      if (!run || !ref.current || !motionAllowed()) return;
      gsap.to(ref.current, { duration: 0.7, ease: "none", overwrite: true, scrambleText: { text, chars: "0123456789abcdef", speed: 0.9, revealDelay: 0.05 } });
    },
    { dependencies: [run], scope: ref },
  );
  return (
    <span ref={ref} title={title} className={`font-mono text-[12.5px] text-ink ${className}`}>
      {text}
    </span>
  );
}
