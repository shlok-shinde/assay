"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Download, Upload } from "lucide-react";
import { db } from "@/store/db";
import { exportWorkspace, importWorkspace } from "@/store/actions";
import { useAiStatus, useKit, useRole } from "@/store/hooks";
import { TitleRow } from "./AppShell";
import { ConfidentialRow } from "./KitView";
import { Code, Empty, fmtTime, Notice } from "./ui";

const LIBRARIES: [string, string, string][] = [
  ["Next.js 16", "MIT", "App framework (App Router) and the two API routes"],
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
  ["Inter, Fraunces, JetBrains Mono (Google Fonts via next/font)", "OFL-1.1", "Type"],
  ["Vitest, Playwright, axe-core", "MIT / Apache-2.0 / MPL-2.0", "Tests (not shipped to the browser)"],
];

export function AboutView() {
  const ai = useAiStatus();
  const kit = useKit();
  const role = useRole();
  const log = useLiveQuery(() => db.aiLog.orderBy("at").reverse().limit(30).toArray(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        title="About and trust"
        sub="What Assay is, which outside services it uses and when, what leaves this browser, and who built it."
      />
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="what-h">
            <h2 id="what-h" className="text-[18px] font-semibold">
              What Assay does
            </h2>
            <p className="mt-2 max-w-[720px] text-[15px] leading-[26px]">
              Assay checks brand content before it ships. A draft is checked against the brand&apos;s published rulebook, its Claim Ledger of approved facts, its terms and its assets.
              Every finding quotes its evidence and cites the rule or fact behind it, suggests the smallest fix that keeps the creator&apos;s intent, and goes to a person for
              the decision. Approved versions get a hash-chained Hallmark. Guideline Health shows which rules people keep pushing back on.
            </p>
            <p className="mt-2 max-w-[720px] text-[14px] leading-[22px] text-muted">
              Velvra, its brand book, rules, facts, people and drafts are fictional demo data made for this project.
            </p>
          </section>

          <section aria-labelledby="ai" id="ai">
            <h2 id="ai-h" className="text-[18px] font-semibold">
              How AI is used
            </h2>
            <ul className="mt-2 max-w-[760px] list-disc space-y-1.5 pl-5 text-[14px] leading-[22px]">
              <li>
                Most checks are code: terms, banned phrases, claims against the ledger (numbers, units, periods, wording and validity dates are compared in code), disclaimers,
                readability, link text, hashtags, contrast, palette and alt text. They work with no AI at all.
              </li>
              <li>
                Google Gemini is used only for judgment rules (tone and messaging), to choose which fact an ambiguous claim refers to, and optionally to draft an Intent Card, an
                intent check, brand-book rules and rule clarifications. The server accepts only these typed tasks, caps input at 8,000 characters and validates every answer.
              </li>
              <li>
                Every AI finding must quote text that exists in the draft and cite a judgment rule in the active rulebook. The evidence verifier drops anything that fails and
                shows how many it dropped.
              </li>
              <li>Emails, phone numbers, ID numbers, card numbers and secrets are redacted in the browser before anything is sent, and again on the server.</li>
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

          <section aria-labelledby="log-h">
            <h2 id="log-h" className="text-[18px] font-semibold">
              AI call log
            </h2>
            <p className="mt-1 text-[13px] text-muted">The last 30 calls from this browser. Content is never logged, here or on the server.</p>
            <div className="mt-3 overflow-x-auto">
              {log?.length === 0 ? (
                <Empty title="No AI calls from this browser yet." />
              ) : (
                <table className="w-full min-w-[560px] text-[14px]">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="pb-2 font-normal">When</th>
                      <th className="pb-2 font-normal">Task</th>
                      <th className="pb-2 font-normal">Model</th>
                      <th className="pb-2 font-normal">Outcome</th>
                      <th className="pb-2 text-right font-normal">Time</th>
                      <th className="pb-2 text-right font-normal">Redactions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log?.map((l) => (
                      <tr key={l.id} className="border-t border-rule">
                        <td className="py-2 text-muted">{fmtTime(l.at)}</td>
                        <td className="py-2">
                          <Code>{l.task}</Code>
                        </td>
                        <td className="py-2">{l.model ?? "—"}</td>
                        <td className="py-2">
                          {l.ok ? "OK" : l.outcome.replace(/_/g, " ")}
                          {l.attempts && <span className="block text-[12px] text-muted">{l.attempts}</span>}
                        </td>
                        <td className="num py-2 text-right">{(l.ms / 1000).toFixed(1)} s</td>
                        <td className="num py-2 text-right">{l.redactions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section aria-labelledby="data-h">
            <h2 id="data-h" className="text-[18px] font-semibold">
              Your data stays in this browser
            </h2>
            <p className="mt-2 max-w-[720px] text-[14px] leading-[22px]">
              There is no account and no database server. Drafts, findings, decisions, comments and Hallmarks are stored in this browser&apos;s IndexedDB. Uploaded files are read
              in the browser: PDF and Word text, OCR and colour analysis all run here. Only redacted paragraphs go to the AI route, and only when Confidential mode is off.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const url = URL.createObjectURL(new Blob([await exportWorkspace()], { type: "application/json" }));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `assay-workspace-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={14} /> Export workspace (JSON)
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
                  if (!confirm("Importing replaces everything in this browser's workspace. Continue?")) return;
                  try {
                    await importWorkspace(await f.text());
                    setMsg("Workspace imported.");
                  } catch (err) {
                    setMsg((err as Error).message);
                  }
                }}
              />
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> Import workspace
              </button>
            </div>
            {msg && <p className="mt-2 text-[13px] text-muted">{msg}</p>}
          </section>

          <section aria-labelledby="libs-h">
            <h2 id="libs-h" className="text-[18px] font-semibold">
              Built with
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="pb-2 font-normal">Library or service</th>
                    <th className="pb-2 font-normal">Licence</th>
                    <th className="pb-2 font-normal">Used for</th>
                  </tr>
                </thead>
                <tbody>
                  {LIBRARIES.map(([n, l, u]) => (
                    <tr key={n} className="border-t border-rule">
                      <td className="py-2 pr-3">{n}</td>
                      <td className="py-2 pr-3 text-muted">{l}</td>
                      <td className="py-2">{u}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-rule">
                    <td className="py-2 pr-3">Google Gemini API (free tier)</td>
                    <td className="py-2 pr-3 text-muted">Google API terms</td>
                    <td className="py-2">Judgment rules and drafting tasks, when a key is configured</td>
                  </tr>
                  <tr className="border-t border-rule">
                    <td className="py-2 pr-3">Vercel</td>
                    <td className="py-2 pr-3 text-muted">Hosting terms</td>
                    <td className="py-2">Hosting the app and the AI route</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[13px] text-muted">Scaffolded with create-next-app. No UI kit or template beyond that.</p>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-[16px] bg-raised p-5">
            <h2 className="text-[15px] font-semibold">Team 24K MAGIC</h2>
            <p className="mt-2 text-[14px] leading-[22px]">
              Shlok Sudhakar Shinde, solo participant. Sardar Patel Institute of Technology (SPIT), Mumbai, 3rd year Computer Science and Engineering.
            </p>
            <p className="mt-2 text-[14px]">
              <a className="underline" href="https://github.com/shlok-shinde/assay">github.com/shlok-shinde/assay</a>
            </p>
            <p className="mt-2 text-[13px] text-muted">CodeStar 30, Round 2. Problem statement by Inkloom AI.</p>
          </section>
          <section className="rounded-[16px] border border-line p-5">
            <h2 className="text-[15px] font-semibold">AI assistance</h2>
            <p className="mt-2 text-[14px] leading-[22px]">Built with AI coding assistance. Google Gemini runs inside the app.</p>
          </section>
          <section className="rounded-[16px] border border-line p-5">
            <h2 className="text-[15px] font-semibold">Limits, stated plainly</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-5 text-muted">
              <li>English only. Text, DOCX, text-based PDF and PNG or JPG creatives.</li>
              <li>Logo size is checked from a box the creator marks; logo detection is planned for Round 3.</li>
              <li>The role switcher stands in for accounts; real multi-user sign-in is Round 3.</li>
              <li>Evaluation numbers measure the engine against labels its builder wrote, not real-world accuracy.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
