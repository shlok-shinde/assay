"use client";

// The app's motion, in one place. Every move is transform and opacity (plus one colour flash), runs
// only when the visitor allows motion, and leaves nothing hidden if it never runs.
import { type RefObject } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export const MOTION = "(prefers-reduced-motion: no-preference)";
export const motionAllowed = () => typeof window !== "undefined" && window.matchMedia(MOTION).matches;

/** Children matching `selector` inside `scope` rise in, one after another, whenever `deps` change. */
export function useDealIn(scope: RefObject<HTMLElement | null>, selector: string, deps: unknown[], vars: gsap.TweenVars = {}) {
  useGSAP(
    () => {
      if (!motionAllowed() || !scope.current?.querySelector(selector)) return;
      gsap.from(selector, { y: 16, opacity: 0, duration: 0.45, ease: "power3.out", stagger: 0.055, clearProps: "transform,opacity", ...vars });
    },
    { scope, dependencies: deps },
  );
}

/** A short gold wash over an element: what the eye should go to now. */
export function flash(el: Element | null, from = "rgb(217 165 32 / 0.5)") {
  if (!el || !motionAllowed()) return;
  gsap.fromTo(el, { backgroundColor: from }, { backgroundColor: "rgb(217 165 32 / 0)", duration: 1.1, ease: "power2.out", clearProps: "backgroundColor" });
}

/** The punch strikes: the mark drops from above, larger and turned, lands, and the panel takes the blow. */
export function strike(mark: Element | null, panel: Element | null) {
  if (!mark || !motionAllowed()) return;
  const tl = gsap.timeline();
  tl.from(mark, { scale: 2.6, rotation: -28, y: -40, opacity: 0, duration: 0.42, ease: "power4.in" });
  if (panel) tl.fromTo(panel, { y: 0 }, { y: 4, duration: 0.06, ease: "power1.out", yoyo: true, repeat: 1, clearProps: "transform" });
  return tl;
}
