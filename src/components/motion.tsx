"use client";

// The app's motion, in one place. Every move is transform and opacity (plus one colour flash), runs
// only when the visitor allows motion, and leaves nothing hidden if it never runs.
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
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

/**
 * A marker that glides to whichever child of `container` matches `active` (the selected tab, role or
 * nav item). It is placed at once on first paint and on resize, and travels when the choice changes.
 */
export function useGlide(container: RefObject<HTMLElement | null>, marker: RefObject<HTMLElement | null>, active: string, deps: unknown[], axis: "x" | "y" | "both" = "x") {
  const placed = useRef(false);
  useLayoutEffect(() => {
    const box = container.current;
    const m = marker.current;
    if (!box || !m) return;
    const place = (animate: boolean) => {
      const el = box.querySelector<HTMLElement>(active);
      if (!el) return gsap.set(m, { opacity: 0 });
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const to: gsap.TweenVars = { opacity: 1, x: r.left - b.left + box.scrollLeft, width: r.width };
      if (axis !== "x") Object.assign(to, { y: r.top - b.top + box.scrollTop, height: r.height });
      if (animate && motionAllowed()) gsap.to(m, { ...to, duration: 0.5, ease: "expo.out", overwrite: true });
      else gsap.set(m, to);
    };
    place(placed.current);
    placed.current = true;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller says when the choice changed
  }, deps);
}

/** Content that slides in when `k` changes: a tab's panel, a form that just opened. */
export function SlideIn({ k, children, className, from = { x: 14 } }: { k: string; children: ReactNode; className?: string; from?: gsap.TweenVars }) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (motionAllowed()) gsap.from(ref.current, { opacity: 0, duration: 0.4, ease: "power3.out", clearProps: "transform,opacity", ...from });
    },
    { dependencies: [k] },
  );
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Content that rises in when it first appears: a form that just opened, a status just set. */
export function Rise({ children, className, from = { y: -6 } }: { children: ReactNode; className?: string; from?: gsap.TweenVars }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (motionAllowed()) gsap.from(ref.current, { opacity: 0, duration: 0.35, ease: "power3.out", clearProps: "transform,opacity", ...from });
  });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
