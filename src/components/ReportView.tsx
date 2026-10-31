"use client";

// A draft's record as a document: the same Markdown the report download holds, laid out as a page. On screen it is a
// sheet of paper inside the app; printed, the app falls away (globals.css, "The printed report") and only the sheet
// is left, black on white, with no motion.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { draftReport } from "@/store/actions";
import { inlineParts, parseMarkdown, type Block } from "@/lib/markdown";
import { saveFile } from "./download";
import { useAction } from "./primitives";
import { PageLoading, StatusPanel } from "./ui";

/** Text with its `code` spans. Every piece goes in as text, so nothing in a draft can act as markup. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, i) =>
        part.code ? (
          <code key={i} className="report-code">
            {part.text}
          </code>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Piece({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading":
      return block.level === 1 ? (
        <h1>
          <Inline text={block.text} />
        </h1>
      ) : (
        <h2>
          <Inline text={block.text} />
        </h2>
      );
    case "paragraph":
      return (
        <p>
          <Inline text={block.text} />
        </p>
      );
    case "list":
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="report-table">
          <table>
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th key={i} scope="col">
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i}>
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return <pre>{block.text}</pre>;
  }
}

export function ReportView({ id }: { id: string }) {
  const [report, setReport] = useState<{ fileName: string; markdown: string } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    draftReport(id).then(
      (r) => live && setReport(r),
      (e: Error) => live && setReport({ error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [id]);
  const download = useAction(async () => {
    if (report && "markdown" in report) saveFile(report.fileName, report.markdown, "text/markdown");
  }, { errorPrefix: "Could not save the report" });

  if (!report) return <PageLoading label="Opening the report…" />;
  if ("error" in report) {
    return (
      <StatusPanel
        title="This draft has no report to show."
        actions={
          <Link href="/app" className="btn btn-inverse btn-lg">
            Back to drafts
          </Link>
        }
      >
        <p>{report.error}</p>
      </StatusPanel>
    );
  }
  const blocks = parseMarkdown(report.markdown);
  return (
    <div className="px-4 py-5 md:px-6 md:py-6 print:p-0">
      <div className="no-print mx-auto flex max-w-[860px] flex-wrap items-center justify-between gap-3 pb-4">
        <Link href={`/app/s/${id}`} className="btn btn-ghost btn-sm -ml-2">
          <ArrowLeft size={14} aria-hidden="true" /> Back to the draft
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={download.busy} onClick={() => download.run()}>
            <Download size={14} aria-hidden="true" /> Download .md
          </button>
          <button type="button" className="btn btn-inverse btn-sm" onClick={() => window.print()}>
            <Printer size={14} aria-hidden="true" /> Print
          </button>
        </div>
      </div>
      <article className="report-sheet" aria-label="Draft report">
        {blocks.map((b, i) => (
          <Piece key={i} block={b} />
        ))}
      </article>
    </div>
  );
}
