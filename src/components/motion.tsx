"use client";

// The app's motion, in one place. Every move is transform and opacity (plus one colour flash), runs
// only when the visitor allows motion, and leaves nothing hidden if it never runs.
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export const MOTION = "(prefers-reduced-motion: no-preference)";
export const motionAllowed = () => typeof window !== "undefined" && window.matchMedia(MOTION).matches;

/**
 * Children matching `selector` inside `scope` enter one after another whenever `deps` change. A CSS
 * animation, not a tween: it only writes a class and a delay, so a long list never forces the browser
 * to recalculate layout element by element (GSAP's from() reads each element's style first).
 */
export function useDealIn(scope: RefObject<HTMLElement | null>, selector: string, deps: unknown[], kind: "rise" | "grow" = "rise", stagger = 55) {
  useLayoutEffect(() => {
    if (!motionAllowed() || !scope.current) return;
    const els = [...scope.current.querySelectorAll<HTMLElement>(selector)];
    els.forEach((el, i) => {
      el.classList.remove("enter-rise", "enter-grow");
      el.style.animationDelay = `${i * stagger}ms`;
      el.classList.add(`enter-${kind}`);
      el.addEventListener("animationend", () => el.classList.remove(`enter-${kind}`), { once: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller says when the content changed
  }, deps);
}

/**
 * Where each property a `from` names comes to rest. Tweens here always state both ends: a bare from() takes
 * the element's current look as its end, so one that interrupts another settles half-faded or half-moved.
 */
export function restOf(from: gsap.TweenVars): gsap.TweenVars {
  const rest: gsap.TweenVars = { opacity: 1 };
  for (const k of Object.keys(from)) {
    if (k === "opacity" || k === "autoAlpha") rest[k] = 1;
    else if (k === "scale" || k === "scaleX" || k === "scaleY") rest[k] = 1;
    else if (k === "x" || k === "y" || k === "xPercent" || k === "yPercent" || k === "rotation") rest[k] = 0;
  }
  return rest;
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
  tl.fromTo(mark, { scale: 2.6, rotation: -28, y: -40, opacity: 0 }, { scale: 1, rotation: 0, y: 0, opacity: 1, duration: 0.42, ease: "power4.in", overwrite: true, clearProps: "transform,opacity" });
  if (panel) tl.fromTo(panel, { y: 0 }, { y: 4, duration: 0.06, ease: "power1.out", yoyo: true, repeat: 1, clearProps: "transform" });
  return tl;
}

/**
 * A marker that glides to whichever child of `container` matches `active` (the selected tab, role or
 * nav item). It is placed at once on first paint and on resize, and travels when the choice changes.
 */
export function useGlide(container: RefObject<HTMLElement | null>, marker: RefObject<HTMLElement | null>, active: string, deps: unknown[], axis: "x" | "y" | "both" = "x") {
  const placed = useRef(false);
  const place = useRef<(animate: boolean) => void>(() => {});
  useLayoutEffect(() => {
    const box = container.current;
    const m = marker.current;
    if (!box || !m) return;
    place.current = (animate: boolean) => {
      const el = box.querySelector<HTMLElement>(active);
      if (!el) {
        gsap.set(m, { opacity: 0, overwrite: true });
        return;
      }
      // Offsets ignore transforms, so a link that is still sliding in (the phone menu) or lifted by its hover
      // is measured where it belongs. A choice nested deeper than the box falls back to the drawn rectangles.
      const direct = el.offsetParent === box;
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const to: gsap.TweenVars = direct ? { opacity: 1, x: el.offsetLeft, width: el.offsetWidth } : { opacity: 1, x: r.left - b.left + box.scrollLeft, width: r.width };
      if (axis !== "x") Object.assign(to, direct ? { y: el.offsetTop, height: el.offsetHeight } : { y: r.top - b.top + box.scrollTop, height: r.height });
      if (animate && motionAllowed()) gsap.to(m, { ...to, duration: 0.5, ease: "expo.out", overwrite: true });
      else gsap.set(m, { ...to, overwrite: true });
    };
    place.current(placed.current);
    placed.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller says when the choice changed
  }, deps);
  // One observer for the life of the box. A new one on every change reported at once and snapped the marker
  // to the end of its glide; and a choice that changes the box's size (a bolder label) re-aims the glide
  // rather than cutting it short.
  useLayoutEffect(() => {
    const box = container.current;
    const m = marker.current;
    if (!box || !m) return;
    const ro = new ResizeObserver(() => place.current(gsap.isTweening(m)));
    ro.observe(box);
    return () => ro.disconnect();
  }, [container, marker]);
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
      // Both ends stated, and the last switch wins: tabs clicked quickly never leave the panel half-faded.
      if (motionAllowed()) gsap.fromTo(ref.current, { opacity: 0, ...from }, { ...restOf(from), duration: 0.4, ease: "power3.out", overwrite: true, clearProps: "transform,opacity" });
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
    if (motionAllowed()) gsap.fromTo(ref.current, { opacity: 0, ...from }, { ...restOf(from), duration: 0.35, ease: "power3.out", overwrite: true, clearProps: "transform,opacity" });
  });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
