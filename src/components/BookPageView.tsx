"use client";

// /app/book?page=18&p=p18-6.1-1: the brand book page a finding cites, as a page of its own. The address is
// the citation, so it can be sent to someone and opens the same page with the same paragraph boxed.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Link2 } from "lucide-react";
import { BOOK, bookParagraph } from "@/lib/book";
import { VELVRA_FACTS, VELVRA_RULES } from "@/seed/velvra";
import { TitleRow } from "./AppShell";
import { bookHref, type BookTarget } from "./BookDrawer";
import { BookReader } from "./BookBody";
import { useToast } from "./primitives";

const BOOK_PAGES = BOOK.pages.length;
const TITLES = new Map<string, string>([...VELVRA_RULES.map((r) => [r.id, r.title] as const), ...VELVRA_FACTS.map((f) => [f.id, f.statement] as const)]);

export function BookPageView() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const pid = params.get("p") ?? undefined;
  const paragraph = pid ? bookParagraph(pid) : undefined;
  const asked = Number(params.get("page"));
  const page = Number.isInteger(asked) && asked >= 1 && asked <= BOOK_PAGES ? asked : (paragraph?.page ?? 1);
  const go = (n: number) => router.replace(bookHref(n, pid), { scroll: false });

  const citedBy = useMemo(() => Object.entries(BOOK.citations).filter(([, id]) => id === pid).map(([ref]) => ref), [pid]);
  // The book's citations in reading order, for finding a paragraph without a finding to start from.
  const index = useMemo(
    () =>
      Object.entries(BOOK.citations)
        .flatMap(([ref, id]) => {
          const p = bookParagraph(id);
          return p ? [{ ref, p }] : [];
        })
        .sort((a, b) => a.p.page - b.p.page || a.p.id.localeCompare(b.p.id, undefined, { numeric: true })),
    [],
  );

  const target: BookTarget = {
    refId: citedBy[0] ?? (paragraph ? `§${paragraph.section}` : BOOK.title),
    refKind: "rule",
    refTitle: citedBy[0] ? (TITLES.get(citedBy[0]) ?? "") : "",
    bookTitle: BOOK.title,
    pages: BOOK_PAGES,
    paragraph,
    record: { text: paragraph?.text ?? "", meta: [] },
  };

  const copy = () =>
    navigator.clipboard.writeText(window.location.href).then(
      () => toast("Link copied. It opens this page with this paragraph boxed.", { tone: "success" }),
      () => toast("Couldn't copy the link. Copy it from the address bar.", { tone: "error" }),
    );

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        crumb="Brand book"
        title={BOOK.title}
        sub={
          paragraph ? (
            <p>
              Page {paragraph.page}, §{paragraph.section}
              {citedBy.length ? ` · cited by ${citedBy.join(", ")}` : ""}
            </p>
          ) : pid ? (
            <p>That paragraph isn&apos;t in this book, so the page is shown without a box.</p>
          ) : (
            <p>
              A page of the book, {BOOK_PAGES} in all. Pick a citation to see the paragraph a rule rests on.
            </p>
          )
        }
        actions={
          <button type="button" className="btn btn-secondary" onClick={copy}>
            <Link2 size={15} aria-hidden="true" /> Copy link
          </button>
        }
      />

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="min-w-0 space-y-4">
          <BookReader target={target} page={page} onPage={go} />
        </div>

        <aside aria-labelledby="cites-h" className="min-w-0 rounded-[24px] bg-raised p-5 xl:sticky xl:top-3">
          <h2 id="cites-h" className="text-[16px] font-semibold">
            Where the rules cite the book
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">{index.length} rules and facts, each pointing at one paragraph.</p>
          <ol className="mt-3 max-h-[480px] space-y-0.5 overflow-y-auto overscroll-contain pr-1">
            {index.map(({ ref, p }) => (
              <li key={ref}>
                <Link
                  href={bookHref(p.page, p.id)}
                  aria-current={p.id === pid ? "true" : undefined}
                  className={`flex items-baseline gap-3 rounded-[12px] px-3 py-2 text-[13.5px] leading-5 transition-colors hover:bg-active ${p.id === pid ? "bg-active font-medium" : "text-muted"}`}
                >
                  <span className="num w-[58px] flex-none text-ink">
                    p.{p.page} §{p.section}
                  </span>
                  <span className="min-w-0">
                    <span className="num text-ink">{ref}</span> <span className="line-clamp-1">{TITLES.get(ref)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
