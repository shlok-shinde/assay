"use client";

// What the brand book drawer holds once it has opened: the cited words, the page controls and the page itself,
// or the record when there is no page. Loaded after the drawer's frame is already on screen (BookDrawer), and
// the PDF viewer inside it (with pdf.js) loads after that. The full page at /app/book uses the same pieces.
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { bookFile } from "@/store/actions";
import type { BookTarget } from "./BookDrawer";
import { openBook, type BookSource } from "./book-pdf";

export function PageFrame() {
  // The page's frame at its real size while the viewer's code loads, so nothing moves when it arrives.
  return (
    <div>
      <p role="status" className="mb-3 min-h-5 text-[13px] leading-5 text-muted">
        Opening the brand book…
      </p>
      <div className="mx-auto w-full max-w-[760px] rounded-[14px] bg-track" style={{ aspectRatio: "420 / 594.96" }} aria-hidden="true" />
    </div>
  );
}

const BookViewer = dynamic(() => import("./BookViewer"), { ssr: false, loading: () => <PageFrame /> });

/** Previous and next page, the page number, and a way back to the cited one. */
export function PageControls({ page, pages, onPage, cited }: { page: number; pages: number; onPage: (page: number) => void; cited?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-secondary btn-sm !px-2.5 max-sm:!h-11 max-sm:!w-11" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <p className="num min-w-[104px] text-center text-[14px] font-medium" aria-live="polite" data-page-number>
        Page {page} of {pages}
      </p>
      <button type="button" className="btn btn-secondary btn-sm !px-2.5 max-sm:!h-11 max-sm:!w-11" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {cited !== undefined && page !== cited && (
        <button type="button" className="btn btn-ghost btn-sm max-sm:!h-11" onClick={() => onPage(cited)}>
          Back to page {cited}
        </button>
      )}
    </div>
  );
}

/** The cited paragraph's own words, and what the rule or fact says today, for when the page is not the whole answer. */
export function CitedWords({ target }: { target: BookTarget }) {
  const { paragraph, imported } = target;
  if (!paragraph && imported?.quote) {
    return (
      <figure className="rounded-[18px] bg-sheet px-4 py-3.5">
        <figcaption className="text-[12.5px] text-muted">
          The book, page {imported.page}
        </figcaption>
        <blockquote className="mt-1 font-display text-[16.5px] leading-[25px]">{imported.quote}</blockquote>
      </figure>
    );
  }
  if (!paragraph) return null;
  return (
    <div className="space-y-3">
      <figure className="rounded-[18px] bg-sheet px-4 py-3.5">
        <figcaption className="text-[12.5px] text-muted">
          The book, page {paragraph.page}, §{paragraph.section}
        </figcaption>
        <blockquote className="mt-1 font-display text-[16.5px] leading-[25px]">{paragraph.text}</blockquote>
      </figure>
      {target.reworded && (
        <p className="rounded-[14px] bg-warn-bg px-3.5 py-2.5 text-[13px] leading-5 text-warn-ink">
          This rule has been reworded since the book was printed. The page shows the book&apos;s words; the rulebook now says: “{target.record.text}”
        </p>
      )}
    </div>
  );
}

/** A rule or fact with no page to open: what its record says, and why there is no page. */
export function RecordCard({ target }: { target: BookTarget }) {
  const { record } = target;
  return (
    <div className="space-y-4">
      {target.noBook && (
        <p role="note" className="rounded-[14px] bg-raised px-4 py-3 text-[14px] leading-6 text-muted">
          {target.noBook}
        </p>
      )}
      <section className="rounded-[18px] bg-sheet px-4 py-4">
        <p className="text-[12.5px] text-muted">{target.refKind === "rule" ? "Rule" : "Claim Ledger fact"}</p>
        <p className="mt-1 font-display text-[18px] leading-[26px]">{record.text}</p>
        {(record.dos?.length || record.donts?.length) ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {record.dos?.length ? (
              <div>
                <p className="text-[12.5px] font-medium text-muted">Do</p>
                <ul className="mt-1 space-y-1.5 text-[14px] leading-5">
                  {record.dos.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {record.donts?.length ? (
              <div>
                <p className="text-[12.5px] font-medium text-muted">Don&apos;t</p>
                <ul className="mt-1 space-y-1.5 text-[14px] leading-5">
                  {record.donts.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <dl className="mt-4 divide-y divide-rule text-[14px]">
          {record.meta.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/** The viewer for one citation: the cited words, page controls, and the page with its paragraph boxed (if there is one). */
export function BookReader({ target, page, onPage }: { target: BookTarget; page: number; onPage: (page: number) => void }) {
  return (
    <div className="space-y-4">
      <CitedWords target={target} />
      <PageControls page={page} pages={target.pages} onPage={onPage} cited={target.paragraph?.page} />
      {/* On a page of its own the window scrolls, so the box is only brought in if it is out of sight. */}
      <BookViewer page={page} paragraphId={target.paragraph?.id} align="nearest" />
    </div>
  );
}

type Loaded = { state: "loading" } | { state: "missing" } | { state: "ready"; source: BookSource; pages: number };

/** The PDF an imported rule came from, found in this workspace, and how many pages it has. */
function useImportedBook(bookId: string): Loaded {
  const [loaded, setLoaded] = useState<{ bookId: string; result: Exclude<Loaded, { state: "loading" }> } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const file = await bookFile(bookId);
      if (!file) return { state: "missing" as const };
      const source: BookSource = { kind: "imported", bookId, dataUrl: file.dataUrl };
      const { doc } = await openBook(source);
      return { state: "ready" as const, source, pages: doc.numPages };
    })()
      .catch(() => ({ state: "missing" as const }))
      .then((result) => live && setLoaded({ bookId, result }));
    return () => {
      live = false;
    };
  }, [bookId]);
  return loaded?.bookId === bookId ? loaded.result : { state: "loading" };
}

/** A rule imported from a book: its own PDF at its page, with the words it quotes boxed. Without the file, the record and the plain statement. */
function ImportedBody({ target, page, onPage }: { target: BookTarget; page: number; onPage: (page: number) => void }) {
  const imported = target.imported!;
  const book = useImportedBook(imported.bookId);
  if (book.state === "missing") {
    return (
      <div role="region" aria-label="Rule record" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-6">
        <RecordCard target={target} />
      </div>
    );
  }
  return (
    <>
      <div className="flex-none px-5 pb-3 sm:px-6">
        {book.state === "ready" ? <PageControls page={page} pages={book.pages} onPage={onPage} cited={imported.page} /> : <p className="min-h-9 text-[13px] text-muted">Opening the book…</p>}
      </div>
      <div role="region" aria-label={`Page ${page} of the brand book`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-6">
        <div className="space-y-4">
          <CitedWords target={target} />
          {book.state === "ready" ? <BookViewer source={book.source} page={page} quote={imported.quote ? { text: imported.quote, page: imported.page } : undefined} /> : <PageFrame />}
        </div>
      </div>
    </>
  );
}

/** The drawer's body: the page controls stay put under the header, and the cited words and the page scroll beneath them. */
export default function BookBody({ target, page, onPage }: { target: BookTarget; page: number; onPage: (page: number) => void }) {
  if (target.imported && !target.paragraph) return <ImportedBody target={target} page={page} onPage={onPage} />;
  return (
    <>
      {target.paragraph && (
        <div className="flex-none px-5 pb-3 sm:px-6">
          <PageControls page={page} pages={target.pages} onPage={onPage} cited={target.paragraph.page} />
        </div>
      )}
      {/* A scrolling area is reachable by keyboard, so its page can be scrolled without a pointer. */}
      <div role="region" aria-label={target.paragraph ? `Page ${page} of the brand book` : "Rule record"} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-6">
        {target.paragraph ? (
          <div className="space-y-4">
            <CitedWords target={target} />
            <BookViewer page={page} paragraphId={target.paragraph.id} />
          </div>
        ) : (
          <RecordCard target={target} />
        )}
      </div>
    </>
  );
}
