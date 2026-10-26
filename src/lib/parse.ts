// File intake, all in the browser: DOCX (mammoth), text-based PDF with page
// numbers (pdfjs-dist), and PNG/JPG creatives.
import type { ImageAsset, PageSpan } from "./types";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPT = ".txt,.docx,.pdf,.png,.jpg,.jpeg";

export interface ParsedFile {
  kind: "paste" | "docx" | "pdf" | "image";
  text: string;
  pages?: PageSpan[];
  image?: ImageAsset;
  fileName: string;
}

export class IntakeError extends Error {}

export function fileKind(file: File): ParsedFile["kind"] | "text" | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (/\.(png|jpe?g)$/.test(name) || /^image\/(png|jpeg)$/.test(file.type)) return "image";
  if (name.endsWith(".txt") || file.type === "text/plain") return "text";
  return null;
}

export async function parseFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_FILE_BYTES) throw new IntakeError(`${file.name} is over 10 MB.`);
  const kind = fileKind(file);
  if (!kind) throw new IntakeError(`${file.name} is not a supported file. Use .docx, .pdf, .png, .jpg or .txt.`);
  if (kind === "text") return { kind: "paste", text: await file.text(), fileName: file.name };
  if (kind === "docx") return { kind, text: await docxText(await file.arrayBuffer()), fileName: file.name };
  if (kind === "pdf") return { kind, ...(await pdfText(await file.arrayBuffer())), fileName: file.name };
  return { kind, text: "", image: await imageAsset(file), fileName: file.name };
}

export async function docxText(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = value.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new IntakeError("This Word file has no text.");
  return text;
}

export async function pdfText(buffer: ArrayBuffer): Promise<{ text: string; pages: PageSpan[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  let text = "";
  const pages: PageSpan[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let pageText = "";
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 1 && !pageText.endsWith("\n")) {
        // A bigger vertical jump than one line height starts a new paragraph.
        pageText += Math.abs(y - lastY) > item.height * 1.8 ? "\n\n" : "\n";
      }
      pageText += item.str;
      if (item.hasEOL && !pageText.endsWith("\n")) pageText += "\n";
      lastY = y;
    }
    pageText = pageText.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text) text += "\n\n";
    const start = text.length;
    text += pageText;
    pages.push({ page: p, start, end: text.length });
  }
  if (!text.trim()) throw new IntakeError("This PDF has no text layer. Scanned PDFs need OCR, which is planned for Round 3.");
  return { text, pages };
}

export async function imageAsset(file: File): Promise<ImageAsset> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new IntakeError("Could not read the image."));
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = dataUrl;
  await img.decode().catch(() => {
    throw new IntakeError("This image could not be decoded.");
  });
  return { dataUrl, width: img.naturalWidth, height: img.naturalHeight, alt: "", fileName: file.name };
}

export async function fetchAsFile(path: string, name: string): Promise<File> {
  const r = await fetch(path);
  if (!r.ok) throw new IntakeError(`Could not load ${name}.`);
  const blob = await r.blob();
  return new File([blob], name, { type: blob.type });
}
