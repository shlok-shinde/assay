// The Velvra Brand Book: which page and paragraph a rule or fact cites. A separate map from the rules
// themselves, so workspaces seeded before the book existed need no migration to open it.
import bookJson from "@/seed/velvra-book.json";

export interface BookBlock {
  kind: string;
  text: string;
  section?: string;
  /** Paragraph ID, such as p18-6.1-1. Headings and pictures have none. */
  id?: string;
}

export interface Book {
  id: string;
  title: string;
  file: string;
  fictional: boolean;
  pages: { page: number; blocks: BookBlock[] }[];
  /** Rule, fact or limit ID to paragraph ID. */
  citations: Record<string, string>;
}

export interface BookParagraph {
  id: string;
  page: number;
  section: string;
  text: string;
}

export const BOOK = bookJson as Book;

const PARAGRAPHS = new Map<string, BookParagraph>(
  BOOK.pages.flatMap((p) => p.blocks.flatMap((b) => (b.id ? [[b.id, { id: b.id, page: p.page, section: b.section ?? "", text: b.text }] as const] : []))),
);

export const bookParagraph = (id: string) => PARAGRAPHS.get(id);

export function citationFor(ruleOrFactId: string): BookParagraph | undefined {
  const id = BOOK.citations[ruleOrFactId];
  return id ? PARAGRAPHS.get(id) : undefined;
}

/** Text in the form used to compare a paragraph with a PDF's text layer, which breaks lines and joins ligatures. */
export const compareText = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[­​]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
