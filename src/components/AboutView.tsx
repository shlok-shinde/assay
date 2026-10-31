"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Download, Upload } from "lucide-react";
import { db } from "@/store/db";
import { exportWorkspace, importWorkspace, KIT_ID } from "@/store/actions";
import { readWorkspaceFile } from "@/store/workspace-file";
import { useAiStatus, useKit, useRole } from "@/store/hooks";
import { TitleRow } from "./AppShell";
import { ConfidentialRow } from "./KitView";
import { useBrand } from "./BrandSwitcher";
import { saveFile } from "./download";
import { Table, Term, useAction, useConfirm } from "./primitives";
import { Code, Empty, fmtTime, Notice } from "./ui";

const LIBRARIES: [string, string, string][] = [
  ["Next.js 16", "MIT", "App framework (App Router) and the API routes"],
  ["React 19", "MIT", "User interface"],
  ["Tailwind CSS 4", "MIT", "Styling"],
  ["TypeScript", "Apache-2.0", "Language"],
  ["Dexie 4 and dexie-react-hooks", "Apache-2.0", "The workspace in IndexedDB, in this browser"],
  ["zod 4", "MIT", "Validating every AI input and output"],
  ["pdfjs-dist", "Apache-2.0", "Text and page numbers from PDFs, in the browser"],
  ["mammoth", "BSD-2-Clause", "Text from Word files, in the browser"],
  ["tesseract.js and its English data", "Apache-2.0", "OCR on creatives, in the browser (self-hosted, no CDN)"],
  ["culori", "MIT", "CIEDE2000 colour distance"],
  ["diff-match-patch", "Apache-2.0", "Version diffs"],
  ["lucide-react", "ISC", "Icons"],
  ["GSAP and @gsap/react", "GSAP Standard (no charge)", "Motion: tab and panel moves, the Hallmark strike"],
  ["nodemailer", "MIT-0", "On the server only: sends the demo's fact-expiry email when a mail server is set up"],
  ["pg (node-postgres)", "MIT", "On the server only: stores answers from the label page when a database is set up"],
  ["tsx and ESLint", "MIT", "Run the evaluation scripts and lint the code (not shipped)"],
  ["Inter, Fraunces, JetBrains Mono (Google Fonts via next/font)", "OFL-1.1", "Type"],
  ["Vitest, Playwright, axe-core", "MIT / Apache-2.0 / MPL-2.0", "Tests (not shipped to the browser)"],
];

export function AboutView() {
  const ai = useAiStatus();
  const kit = useKit();
  const role = useRole();
  const log = useLiveQuery(() => db.aiLog.orderBy("at").reverse().limit(30).toArray(), []);

  return (
    <div className="px-4 py-5 md:px-8 md:py-8">
      <TitleRow
        title="About and trust"
        sub="What Assay is, which outside services it uses and when, what leaves this browser, and who built it."
      />
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="what-h" className="card p-6 md:p-8">
            <h2 id="what-h" className="text-[18px] font-semibold">
              What Assay does
            </h2>
            <p className="mt-2 max-w-[720px] text-[15px] leading-[26px]">
              Assay checks brand content before it ships. A draft is checked against the brand&apos;s published rulebook, its <Term id="claim-ledger">Claim Ledger</Term> of approved facts, its terms and its assets.
              Every finding quotes its evidence and cites the rule or fact behind it, suggests the smallest fix that keeps the creator&apos;s intent, and goes to a person for
              the decision. Approved versions get a hash-chained <Term id="hallmark">Hallmark</Term>. Guideline Health shows which rules people keep pushing back on.
            </p>
            <p className="mt-2 max-w-[720px] text-[14px] leading-[22px] text-muted">
              Velvra, its brand book, rules, facts, people and drafts are fictional demo data made for this project.
            </p>
          </section>

          <section aria-labelledby="ai-h" id="ai" className="card p-6 md:p-8">
            <h2 id="ai-h" className="text-[18px] font-semibold">
              How AI is used
            </h2>
            <ul className="mt-2 max-w-[760px] list-disc space-y-1.5 pl-5 text-[14px] leading-[22px]">
              <li>
                Most checks are code: terms, banned phrases, claims against the ledger (numbers, units, periods, wording and validity dates are compared in code), disclaimers,
                readability, link text, hashtags, contrast, palette and alt text. They work with no AI at all.
              </li>
              <li>
                Google Gemini is used only for judgment rules (tone and messaging), to choose which fact an ambiguous claim refers to, and optionally to draft an <Term id="intent-card">Intent Card</Term>, an
                intent check, brand-book rules and rule clarifications. The server accepts only these typed tasks, caps input at 8,000 characters and validates every answer.
              </li>
              <li>
                Every AI finding must quote text that exists in the draft and cite a judgment rule in the active rulebook. The evidence verifier drops anything that fails and
                shows how many it dropped.
              </li>
              <li>
                Emails, phone numbers, ID numbers, card numbers and secrets are redacted in the browser before anything is sent, and again on the server. So are the names of
                people this workspace knows: the demo&apos;s four people and any fact owner a Brand Admin has entered by hand. Only the browser knows those names, so only the
                browser hides them.
              </li>
              <li>AI results are cached per paragraph and rulebook version, so an unchanged paragraph is never sent twice.</li>
            </ul>
            <div className="mt-4 max-w-[760px]">
              <Notice tone="warn">
                This deployment uses Gemini&apos;s free tier. Google&apos;s terms for unpaid services say Google may use inputs and outputs to improve its products and that human
                reviewers may read them, and advise against sending confidential information. Use Confidential mode for anything confidential: it sends nothing to any AI service.
              </Notice>
            </div>
            <div className="mt-4 max-w-[760px] text-[14px]">
              <p>
                Status on this deployment:{" "}
                <span className="font-medium">
                  {ai === undefined
                    ? "checking…"
                    : ai?.aiConfigured
                      ? `AI configured, ${ai.keysAvailable} of ${ai.keyCount} keys available; models ${ai.models.judge.join(" → ")} and ${ai.models.lite.join(" → ")}`
                      : "no AI key configured, so every check is rule checks only"}
                </span>
                . <a href="/api/status" className="underline">Raw status</a> (never includes a key).
              </p>
            </div>
            {kit && (
              <div className="mt-5">
                <ConfidentialRow kit={kit} admin={role === "admin"} />
                {role !== "admin" && <p className="mt-2 text-[13px] text-muted">Switch to Brand Admin to change Confidential mode.</p>}
              </div>
            )}
          </section>

          <section aria-labelledby="log-h" className="card p-6 md:p-8">
            <h2 id="log-h" className="text-[18px] font-semibold">
              AI call log
            </h2>
            <p className="mt-1 text-[13px] text-muted">The last 30 calls from this browser. Content is never logged, here or on the server.</p>
            <div className="mt-3">
              {log?.length === 0 ? (
                <Empty title="No AI calls from this browser yet." />
              ) : (
                <Table label="AI call log" minWidth={560}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Task</th>
                      <th>Model</th>
                      <th>Outcome</th>
                      <th className="num">Time</th>
                      <th className="num">Redactions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log?.map((l) => (
                      <tr key={l.id}>
                        <td className="text-muted">{fmtTime(l.at)}</td>
                        <td>
                          <Code>{l.task}</Code>
                        </td>
                        <td>{l.model ?? "—"}</td>
                        <td>
                          {l.ok ? "OK" : l.outcome.replace(/_/g, " ")}
                          {l.attempts && <span className="block text-[12px] text-muted">{l.attempts}</span>}
                        </td>
                        <td className="num">{(l.ms / 1000).toFixed(1)} s</td>
                        <td className="num">{l.redactions}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </section>

          <section aria-labelledby="data-h" className="card p-6 md:p-8">
            <h2 id="data-h" className="text-[18px] font-semibold">
              Where your data is kept
            </h2>
            <p className="mt-2 max-w-[720px] text-[14px] leading-[22px]">
              The demo, and any brand you add here, stays in this browser. There is no account and no database server: drafts, findings, decisions, comments and Hallmarks are
              stored in this browser&apos;s IndexedDB. Uploaded files are read in the browser: PDF and Word text, OCR and colour analysis all run here. Only redacted paragraphs
              go to the AI route, and only when Confidential mode is off.
            </p>
            <p className="mt-2 max-w-[720px] text-[14px] leading-[22px]">
              A team workspace is different. Its drafts, findings, decisions and Hallmarks are stored on the server, in Postgres, so people in different places see the same
              work. Everyone who is a member of that workspace can see them, and no one else. Each member signs in with an emailed link and has one role, set by the
              workspace&apos;s Brand Admin and checked on the server. This browser keeps a copy too. The AI redaction above works the same way in both.
            </p>
            <WorkspaceFile />
          </section>

          <section aria-labelledby="libs-h" className="card p-6 md:p-8">
            <h2 id="libs-h" className="text-[18px] font-semibold">
              Built with
            </h2>
            <Table label="Libraries and services" minWidth={560} className="mt-3">
              <thead>
                <tr>
                  <th>Library or service</th>
                  <th>Licence</th>
                  <th>Used for</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...LIBRARIES,
                  ["Google Gemini API (free tier)", "Google API terms", "Judgment rules and drafting tasks, when a key is configured"],
                  ["Vercel", "Hosting terms", "Hosting the app and the AI route"],
                ].map(([n, l, u]) => (
                  <tr key={n}>
                    <td className="pr-3">{n}</td>
                    <td className="pr-3 text-muted">{l}</td>
                    <td>{u}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-[13px] text-muted">Scaffolded with create-next-app. No UI kit or template beyond that.</p>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-[28px] bg-raised p-6">
            <h2 className="text-[15px] font-semibold">Team 24K MAGIC</h2>
            <p className="mt-2 text-[14px] leading-[22px]">
              Shlok Sudhakar Shinde, solo participant. Sardar Patel Institute of Technology (SPIT), Mumbai, 3rd year Computer Science and Engineering.
            </p>
            <p className="mt-2 text-[14px]">
              <a className="underline" href="https://github.com/shlok-shinde/assay">github.com/shlok-shinde/assay</a>
            </p>
            <p className="mt-2 text-[13px] text-muted">CodeStar 30, Round 3. Problem statement by Inkloom AI.</p>
          </section>
          <section className="rounded-[28px] bg-raised p-6">
            <h2 className="text-[15px] font-semibold">AI assistance</h2>
            <p className="mt-2 text-[14px] leading-[22px]">Built with AI coding assistance. Google Gemini runs inside the app.</p>
          </section>
          <section className="rounded-[28px] bg-raised p-6">
            <h2 className="text-[15px] font-semibold">Limits, stated plainly</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-5 text-muted">
              <li>English only. Text, DOCX, text-based PDF and PNG or JPG creatives.</li>
              <li>Logo size is checked from a box the creator marks. Assay does not find logos by itself yet.</li>
              <li>In the demo and in brands kept in this browser, the role switcher stands in for accounts. A team workspace has real sign-in by emailed link, and its roles are set by its Brand Admin.</li>
              <li>Evaluation numbers measure the engine against labels its builder wrote, not real-world accuracy.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const countOf = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Export, and import in four steps that each leave the workspace alone until the last: read the file and
 * check it (a bad file stops here, with the reason shown beside the button), say what will be replaced and
 * ask, download a backup of what is there now, then replace it and say how it went.
 */
function WorkspaceFile() {
  const confirm = useConfirm();
  const inTeam = !!useBrand()?.team;
  const fileRef = useRef<HTMLInputElement>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const exporting = useAction(async () => saveFile(`assay-workspace-${new Date().toISOString().slice(0, 10)}.json`, await exportWorkspace()), {
    errorPrefix: "Could not export the workspace",
    success: "Workspace exported.",
  });

  const importing = useAction(
    async (file: File) => {
      setOutcome(null);
      const text = await file.text();
      // Throws a plain sentence for anything that is not a whole Assay export for this brand; nothing has changed yet.
      const incoming = readWorkspaceFile(text, KIT_ID);
      const rows = (name: "submissions" | "hallmarks" | "rulebooks") => (incoming[name] ?? []) as { seeded?: boolean }[];
      const [drafts, hallmarks, versions] = await Promise.all([db.submissions.filter((x) => !x.seeded).count(), db.hallmarks.count(), db.rulebooks.count()]);
      const yes = await confirm({
        title: "Replace this workspace with the file?",
        body: (
          <>
            <p>
              This browser&apos;s workspace holds {countOf(drafts, "draft")}, {countOf(hallmarks, "Hallmark")} and {countOf(versions, "rulebook version")}, with every decision, comment and the Brand Kit. All of it is replaced by what
              is in {file.name}: {countOf(rows("submissions").filter((x) => !x.seeded).length, "draft")}, {countOf(rows("hallmarks").length, "Hallmark")} and {countOf(rows("rulebooks").length, "rulebook version")}.
            </p>
            <p className="mt-2">Assay downloads a backup of what is here now first, so you can put it back with this same button.</p>
          </>
        ),
        confirmLabel: "Back up and replace",
        danger: true,
      });
      if (!yes) return null;
      try {
        saveFile(`assay-backup-before-import-${stamp()}.json`, await exportWorkspace());
      } catch (e) {
        throw new Error(`The backup of the current workspace failed, so nothing was changed. ${(e as Error).message}`);
      }
      await importWorkspace(text);
      return `Imported ${file.name}: ${countOf(rows("submissions").filter((x) => !x.seeded).length, "draft")} and ${countOf(rows("hallmarks").length, "Hallmark")}. The workspace you replaced was saved to a backup file in your downloads.`;
    },
    { toastError: false, success: (said) => (said ? "Workspace imported." : undefined) },
  );

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-secondary btn-sm" disabled={exporting.busy} onClick={() => exporting.run()}>
          <Download size={14} aria-hidden="true" /> Export workspace (JSON)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="Workspace file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const said = await importing.run(f);
            if (said) setOutcome(said);
          }}
        />
        <button className="btn btn-secondary btn-sm" disabled={importing.busy || inTeam} aria-describedby={inTeam ? "import-team" : undefined} onClick={() => fileRef.current?.click()}>
          <Upload size={14} aria-hidden="true" /> {importing.busy ? "Importing…" : "Import workspace"}
        </button>
      </div>
      {inTeam && (
        <p id="import-team" className="mt-2 max-w-[640px] text-[13px] leading-5 text-muted">
          Import isn&apos;t available in a team workspace, because it would replace your team&apos;s work. A Brand Admin can export the workspace from the Team page.
        </p>
      )}
      {importing.error && (
        <div className="mt-3 max-w-[720px]">
          <Notice tone="error" role="alert">
            {importing.error}
          </Notice>
        </div>
      )}
      {outcome && (
        <div className="mt-3 max-w-[720px]">
          <Notice tone="info" role="status">
            {outcome}
          </Notice>
        </div>
      )}
    </div>
  );
}
