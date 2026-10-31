"use client";

// A citation in a finding card as a button, and what it opens: the book's paragraph when the rule or fact has
// one, otherwise the record itself with a plain statement that there is no page. The comparisons against the
// book live here, so the app's first load (which holds only the drawer's frame) never reads the book's data.
import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import type { Fact, Rule } from "@/lib/types";
import { BOOK, citationFor, compareText } from "@/lib/book";
import { useBook, type BookTarget } from "./BookDrawer";

export function ruleTarget(rule: Rule): BookTarget {
  // A rule imported from a book someone uploaded: its PDF is kept in this workspace, and the rule quotes its page.
  const importedFrom = rule.source.bookId;
  const cited = rule.source.page > 0 && rule.source.doc === BOOK.title ? citationFor(rule.id) : undefined;
  const paragraph = cited && cited.page === rule.source.page ? cited : undefined;
  const where = `${rule.source.doc}${rule.source.page > 0 ? `, page ${rule.source.page}` : ""}${rule.source.section ? `, ${rule.source.section}` : ""}`;
  return {
    refId: rule.id,
    refKind: "rule",
    refTitle: rule.title,
    bookTitle: importedFrom ? rule.source.doc : BOOK.title,
    pages: importedFrom ? 0 : BOOK.pages.length,
    paragraph,
    imported: importedFrom && rule.source.page > 0 ? { bookId: importedFrom, page: rule.source.page, quote: rule.source.quote } : undefined,
    reworded: !!paragraph && compareText(paragraph.text) !== compareText(rule.text),
    noBook: paragraph
      ? undefined
      : rule.source.page > 0
        ? `This rule says it comes from “${rule.source.doc}”, page ${rule.source.page}. That file isn't kept in this workspace, so there is no page to open. Here is the rule as the rulebook holds it.`
        : "This rule isn't from a brand book. It is a starter rule, or one written in Assay, so there is no page to open. Here is the rule as the rulebook holds it.",
    record: { text: rule.text, dos: rule.dos, donts: rule.donts, meta: [["Source", where], ["Applies to", rule.channels.length ? rule.channels.join(", ") : "Every channel"]] },
  };
}

export function factTarget(fact: Fact): BookTarget | null {
  const cited = citationFor(fact.id);
  const paragraph = cited && compareText(cited.text) === compareText(fact.statement) ? cited : undefined;
  if (!paragraph) return null;
  return {
    refId: fact.id,
    refKind: "fact",
    refTitle: fact.statement,
    bookTitle: BOOK.title,
    pages: BOOK.pages.length,
    paragraph,
    record: {
      text: fact.approvedWording,
      meta: [
        ["Owner", fact.owner],
        ["Source", fact.source || "—"],
        ["Valid", fact.validFrom || fact.validTo ? `${fact.validFrom ?? "…"} to ${fact.validTo ?? "…"}` : "No dates set"],
      ],
    },
  };
}

/** A citation as a button: its text stays as it was (`p.18 §6.1`), and pressing it opens the brand book at that paragraph. */
export function CitationButton({ target, children }: { target: BookTarget; children: ReactNode }) {
  const book = useBook();
  return (
    <button
      type="button"
      className="cite"
      aria-haspopup="dialog"
      title={target.paragraph ?? target.imported ? `Open page ${(target.paragraph?.page ?? target.imported!.page)} of the brand book` : "Open this rule's record"}
      onClick={(e) => {
        e.stopPropagation();
        book.open(target, e.currentTarget);
      }}
    >
      <BookOpen size={13} aria-hidden="true" />
      {children}
    </button>
  );
}
