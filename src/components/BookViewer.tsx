"use client";

// One page of the brand book, drawn by pdf.js (canvas plus text layer), with the cited paragraph found in
// the page's own text and boxed in gold. This file is loaded only when a citation is opened, and pdf.js
// itself is imported inside it, so neither is part of the app's first load. Each draw is cancelled when
// the page, the width or the paragraph changes, and when the viewer closes.
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import type { RenderTask, TextLayer } from "pdfjs-dist";
import { RotateCw } from "lucide-react";
import { bookParagraph, compareText } from "@/lib/book";
import { openBook, sourceKey, type BookSource } from "./book-pdf";
import { motionAllowed } from "./motion";

// A5, as the book is set: the page's frame is this tall before the first page has loaded, so nothing jumps.
const A5_RATIO = 594.96 / 420;

type Phase = { state: "loading" } | { state: "ready" } | { state: "error"; message: string };
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const isCancel = (e: unknown) => e instanceof Error && /cancel|abort/i.test(`${e.name} ${e.message}`);

/**
 * Where the paragraph sits on the page: its text, compared with whitespace and case stripped (the PDF breaks
 * lines and joins ligatures), is found in the concatenated text items; each match maps back to its text div,
 * and the boxes of the matched words are joined into one rectangle, in pixels from the page's top left.
 */
function locate(layer: TextLayer, paragraphText: string, page: HTMLElement): Box | null {
  const items = layer.textContentItemsStr;
  const divs = layer.textDivs;
  let hay = "";
  const item: number[] = [];
  const from: number[] = [];
  const to: number[] = [];
  items.forEach((s, i) => {
    let at = 0;
    for (const ch of s) {
      const n = compareText(ch);
      for (let k = 0; k < n.length; k++) {
        item.push(i);
        from.push(at);
        to.push(at + ch.length);
      }
      hay += n;
      at += ch.length;
    }
  });
  const needle = compareText(paragraphText);
  const hit = needle ? hay.indexOf(needle) : -1;
  if (hit < 0) return null;
  const last = hit + needle.length - 1;
  const frame = page.getBoundingClientRect();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = item[hit]; i <= item[last]; i++) {
    const div = divs[i];
    const node = div?.firstChild;
    if (!div?.isConnected || !(node instanceof Text)) continue;
    const whole = (i > item[hit] || from[hit] === 0) && (i < item[last] || to[last] >= items[i].length);
    let r: DOMRect;
    if (whole) r = div.getBoundingClientRect();
    else {
      const range = document.createRange();
      range.setStart(node, i === item[hit] ? from[hit] : 0);
      range.setEnd(node, i === item[last] ? to[last] : node.length);
      r = range.getBoundingClientRect();
    }
    if (!r.width || !r.height) continue;
    x0 = Math.min(x0, r.left - frame.left);
    y0 = Math.min(y0, r.top - frame.top);
    x1 = Math.max(x1, r.right - frame.left);
    y1 = Math.max(y1, r.bottom - frame.top);
  }
  if (!Number.isFinite(x0)) return null;
  const padX = 8;
  const padY = 6;
  const left = Math.max(2, x0 - padX);
  const top = Math.max(2, y0 - padY);
  return { left, top, width: Math.min(frame.width - 2, x1 + padX) - left, height: Math.min(frame.height - 2, y1 + padY) - top };
}

/** The words an imported rule quotes, and the page it says they are on. */
export interface QuotedWords {
  text: string;
  page: number;
}

/**
 * One page of a book: the seeded Velvra book (boxing a paragraph by its ID), or an imported one (boxing the words
 * its rule quotes). Either way the box is found in the page's own text, and a miss says so instead of guessing.
 */
export default function BookViewer({ page, paragraphId, quote, source = { kind: "seeded" }, align = "center" }: { page: number; paragraphId?: string; quote?: QuotedWords; source?: BookSource; align?: ScrollLogicalPosition }) {
  const frame = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(A5_RATIO);
  const [attempt, setAttempt] = useState(0);
  const paragraph = paragraphId ? bookParagraph(paragraphId) : undefined;
  // Only a paragraph that is printed on this page can be boxed on it.
  const wanted = paragraph && paragraph.page === page ? paragraph.text : quote && quote.page === page ? quote.text : undefined;
  // What was drawn, and for which book, page, width and words: anything else is still loading.
  const docKey = sourceKey(source);
  const key = `${docKey}|${page}|${width}|${wanted ?? ""}|${attempt}`;
  const [drawn, setDrawn] = useState<{ key: string; phase: Phase; box: Box | null } | null>(null);
  const phase: Phase = drawn?.key === key ? drawn.phase : { state: "loading" };
  const box = drawn?.key === key ? drawn.box : null;

  // The page is drawn at the width it is given. A resize waits a moment, so dragging a window edge is one draw, not many.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => setWidth(Math.round(el.clientWidth));
    read();
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(read, 150);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = frame.current;
    const canvases = canvasHost.current;
    const text = textHost.current;
    if (!el || !canvases || !text || !width) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    let layer: TextLayer | undefined;
    (async () => {
      const { pdfjs, doc } = await openBook(source);
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width / natural.width });
      const density = Math.min(window.devicePixelRatio || 1, 2);
      // A fresh canvas for each draw: pdf.js refuses a second render on one that is still being drawn.
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * density);
      canvas.height = Math.floor(viewport.height * density);
      canvas.style.cssText = `display:block;width:${viewport.width}px;height:${viewport.height}px`;
      el.style.setProperty("--total-scale-factor", String(viewport.scale));
      el.style.setProperty("--scale-round-x", "1px");
      el.style.setProperty("--scale-round-y", "1px");
      setRatio(natural.height / natural.width);
      canvases.replaceChildren();
      text.replaceChildren();
      task = pdfPage.render({ canvas, viewport, transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0] });
      layer = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport });
      await Promise.all([task.promise, layer.render()]);
      if (cancelled) return;
      canvases.replaceChildren(canvas);
      setDrawn({ key, phase: { state: "ready" }, box: wanted ? locate(layer, wanted, el) : null });
    })().catch((e: unknown) => {
      if (cancelled || isCancel(e)) return;
      setDrawn({ key, phase: { state: "error", message: "The brand book page didn't open. Check the connection and try again." }, box: null });
    });
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
    };
    // `source` is read through its key: a book's bytes never change under the same ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page, width, wanted]);

  // The box lands as a mark struck on the page, then the page scrolls to it.
  useGSAP(
    () => {
      if (!box || !mark.current) return;
      const smooth = motionAllowed();
      if (smooth) gsap.fromTo(mark.current, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.45, ease: "power3.out", clearProps: "transform,opacity" });
      mark.current.scrollIntoView({ block: align, behavior: smooth ? "smooth" : "auto" });
    },
    { dependencies: [box], scope: frame },
  );

  const status =
    phase.state === "loading"
      ? `Opening page ${page}…`
      : phase.state === "error"
        ? phase.message
        : wanted
          ? box
            ? paragraph
              ? "The paragraph this finding cites is boxed in gold on the page."
              : "The words this rule quotes are boxed in gold on the page."
            : paragraph
              ? "This paragraph couldn't be found in the page's text, so nothing is boxed. The page is shown as it is."
              : "The words this rule quotes couldn't be found in the page's text, so nothing is boxed. The page is shown as it is."
          : paragraph
            ? `This is page ${page}. The cited paragraph is on page ${paragraph.page}.`
            : quote
              ? `This is page ${page}. The quoted words are on page ${quote.page}.`
              : "";

  return (
    <div className="w-full">
      <p role="status" className="mb-3 min-h-5 text-[13px] leading-5 text-muted">
        {status}
      </p>
      <div
        ref={frame}
        data-book-page={page}
        data-state={phase.state}
        style={{ aspectRatio: `1 / ${ratio}`, colorScheme: "light" }}
        className="book-page relative mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] bg-white"
      >
        <div ref={canvasHost} className="absolute inset-0" aria-hidden="true" />
        <div
          ref={mark}
          data-highlight={box ? "" : undefined}
          aria-hidden="true"
          hidden={!box}
          className="book-mark"
          style={box ? { left: box.left, top: box.top, width: box.width, height: box.height } : undefined}
        />
        <div ref={textHost} className="pdf-text" aria-hidden="true" />
        {phase.state === "loading" && (
          <div className="absolute inset-0 flex flex-col gap-3 bg-[#ece7db] p-[8%]" aria-hidden="true">
            <span className="h-4 w-1/3 rounded-full bg-[#d9d2c2]" />
            <span className="mt-4 h-3 w-full rounded-full bg-[#d9d2c2]" />
            <span className="h-3 w-[92%] rounded-full bg-[#d9d2c2]" />
            <span className="h-3 w-[96%] rounded-full bg-[#d9d2c2]" />
            <span className="h-3 w-[60%] rounded-full bg-[#d9d2c2]" />
          </div>
        )}
        {phase.state === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#ece7db] p-8 text-center text-[#17140f]">
            <p className="max-w-[280px] text-[14.5px] leading-6">{phase.message}</p>
            <button type="button" className="btn btn-inverse btn-lg" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCw size={14} aria-hidden="true" /> Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
