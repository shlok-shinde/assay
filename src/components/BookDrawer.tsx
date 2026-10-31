"use client";

// The brand book drawer. A citation anywhere in the app opens it; its frame (header, close button) is on
// screen at once and the rest loads inside it: first the body (BookBody), then the PDF viewer with pdf.js.
// This file is part of the app shell, so it holds no book data: what it shows comes in with the target.
import Link from "next/link";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { BookOpen, ExternalLink, X } from "lucide-react";
import type { BookParagraph } from "@/lib/book";
import { Drawer } from "./primitives";

/** What a citation opens: the book's paragraph when there is one, and always the record that cites it. */
export interface BookTarget {
  refId: string;
  refKind: "rule" | "fact";
  refTitle: string;
  bookTitle: string;
  pages: number;
  paragraph?: BookParagraph;
  /** A rule imported from a book someone uploaded: the PDF is kept in this workspace, and the rule quotes its page. */
  imported?: { bookId: string; page: number; quote?: string };
  /** Said plainly when there is no page to open. */
  noBook?: string;
  /** The rule was reworded after the book was printed: the book page shows the old words. */
  reworded?: boolean;
  record: { text: string; dos?: string[]; donts?: string[]; meta: [label: string, value: string][] };
}

export const bookHref = (page: number, paragraphId?: string) => `/app/book?page=${page}${paragraphId ? `&p=${encodeURIComponent(paragraphId)}` : ""}`;

/** The body's place while its code loads: the page's frame at its real size, so nothing moves when it arrives. */
function BodyFrame() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6" aria-busy="true">
      <p role="status" className="mb-3 min-h-5 text-[13px] leading-5 text-muted">
        Opening the brand book…
      </p>
      <div className="mx-auto w-full max-w-[760px] rounded-[14px] bg-track" style={{ aspectRatio: "420 / 594.96" }} aria-hidden="true" />
    </div>
  );
}

const BookBody = dynamic(() => import("./BookBody"), { ssr: false, loading: () => <BodyFrame /> });

interface BookApi {
  open: (target: BookTarget, opener?: HTMLElement | null) => void;
}
const BookContext = createContext<BookApi | null>(null);

export function useBook(): BookApi {
  const api = useContext(BookContext);
  if (!api) throw new Error("useBook needs a BookProvider above it.");
  return api;
}

/** One drawer for the whole app: a citation anywhere opens it, and focus goes back to the citation that did. */
export function BookProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ target: BookTarget; opener: HTMLElement | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const api = useMemo<BookApi>(
    () => ({
      open: (target, opener = null) => {
        setShown({ target, opener });
        setPage(target.paragraph?.page ?? target.imported?.page ?? 1);
        setOpen(true);
      },
    }),
    [],
  );
  const close = useCallback(() => setOpen(false), []);
  const target = shown?.target;

  return (
    <BookContext.Provider value={api}>
      {children}
      <Drawer open={open} onClose={close} label={target?.paragraph || target?.imported ? `Brand book, page ${page}` : `${target?.refId ?? "Rule"} record`} returnTo={shown?.opener}>
        {target && (
          <>
            <header className="flex flex-none items-start gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[13px] text-muted">
                  <BookOpen size={14} aria-hidden="true" />
                  {target.paragraph || target.imported ? target.bookTitle : "No brand book page"}
                </p>
                <h2 data-paragraph={target.paragraph?.id} className="mt-1 font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">
                  <span className="num">{target.refId}</span>
                  {target.paragraph ? ` · page ${target.paragraph.page}, §${target.paragraph.section}` : target.imported ? ` · page ${target.imported.page}` : ""}
                </h2>
                <p className="mt-0.5 line-clamp-2 text-[14px] leading-5 text-muted">{target.refTitle}</p>
              </div>
              {target.paragraph && (
                <Link href={bookHref(target.paragraph.page, target.paragraph.id)} className="btn btn-ghost btn-sm mt-0.5 flex-none max-sm:!h-11" onClick={close}>
                  <ExternalLink size={14} aria-hidden="true" /> Full page
                </Link>
              )}
              <button type="button" data-autofocus className="btn btn-secondary btn-sm h-9 w-9 flex-none !px-0 max-sm:!h-11 max-sm:!w-11" aria-label="Close the brand book" onClick={close}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <BookBody target={target} page={page} onPage={setPage} />
          </>
        )}
      </Drawer>
    </BookContext.Provider>
  );
}
