// Opens a brand book's PDF for the viewer. The seeded Velvra book is a static file; a book someone imported is
// kept in their workspace as a data URL. Each is opened once per visit, and a failure is forgotten so Retry asks
// again. pdf.js is imported inside, so nothing here is part of the app's first load.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BOOK } from "@/lib/book";

type Pdfjs = typeof import("pdfjs-dist");

export type BookSource = { kind: "seeded" } | { kind: "imported"; bookId: string; dataUrl: string };

export const sourceKey = (source: BookSource) => (source.kind === "seeded" ? "seeded" : source.bookId);

const opened = new Map<string, Promise<{ pdfjs: Pdfjs; doc: PDFDocumentProxy }>>();

export function openBook(source: BookSource) {
  const key = sourceKey(source);
  let opening = opened.get(key);
  if (!opening) {
    opening = (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
      if (source.kind === "seeded") return { pdfjs, doc: await pdfjs.getDocument({ url: BOOK.file }).promise };
      const bytes = new Uint8Array(await (await fetch(source.dataUrl)).arrayBuffer());
      return { pdfjs, doc: await pdfjs.getDocument({ data: bytes }).promise };
    })();
    opened.set(key, opening);
    opening.catch(() => opened.delete(key));
  }
  return opening;
}
