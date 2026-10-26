"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { VELVRA_KIT } from "@/seed/velvra";
import { ruleChecks } from "@/engine/rules";
import { analyzeClaims } from "@/engine/claims";
import { mergeFindings } from "@/engine/merge";
import type { Finding } from "@/lib/types";
import { ruleHealth } from "@/engine/health";
import { seededHistory } from "@/seed/history";
import { sha256Hex } from "@/engine/hash";
import { AnnotatedText } from "./AnnotatedText";
import { CATEGORY_LABEL, Mark, SeverityPill } from "./ui";

const EXAMPLE = "OMG 😍 our new sunblock is clinically proven to erase dark spots in just 7 days! The best serum in India. Shop now 👉 link in bio";

const STEPS: [string, string][] = [
  ["Open the Instagram sample", "One click loads the Round 1 worked example: a caption and its creative."],
  ["Read a cited finding", "Each one quotes the draft, names the rule or fact it breaks, and says where that lives in the brand book."],
  ["Accept fixes and apply them", "Fixes change only their own words. The intent check says whether the key message and call to action survived."],
  ["Submit for review", "It unlocks once nothing high-severity is left open. Claims route to Compliance."],
  ["Approve as Compliance, then as Reviewer", "Use the role switcher at the top. Approval writes a hash-chained Hallmark you can verify."],
  ["Open Guideline Health", "See which rules people keep dismissing, which mistakes repeat, and which facts expire soon."],
];

const CHECKS: [string, string, string][] = [
  ["Tone", "VOICE-02", "“OMG” and “!!!” break Velvra's never-hype voice. Judgment rules use AI; the obvious cases are caught in code."],
  ["Terminology", "TERM-05", "“Whitening” is banned and becomes “even tone”, with the brand book page cited."],
  ["Messaging", "MSG-02", "“Erase dark spots in 7 days” promises instant results the product can't make."],
  ["Claims", "CLAIM-01", "“25% off” is checked against fact F-107 (20%, valid to 20 Nov). Numbers, periods and dates are compared in code."],
  ["Visual", "VIS-01", "A #F86598 background is ΔE 18 from Rose Clay, the nearest brand colour."],
  ["Accessibility", "A11Y-01", "A headline at 1.7:1 contrast fails WCAG AA. Assay reads the creative with OCR in your browser."],
];

function LiveChecker() {
  const [text, setText] = useState(EXAMPLE);
  const findings = useMemo<Finding[]>(() => {
    const raw = mergeFindings([...ruleChecks(text, VELVRA_KIT, "instagram"), ...analyzeClaims(text, VELVRA_KIT, new Date().toISOString().slice(0, 10)).findings]);
    return raw.map((f, i) => ({ ...f, id: `live-${i}`, checkId: "live", submissionId: "live", versionId: "live", status: "open" }));
  }, [text]);
  const numbers = useMemo(() => new Map(findings.map((f, i) => [f.id, i + 1])), [findings]);
  return (
    <div data-ui className="rounded-[24px] border border-line bg-sheet p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[14px] font-semibold">Instagram caption · Velvra rulebook v3.2</p>
        <p className="num text-[13px] text-muted">
          {findings.length} finding{findings.length === 1 ? "" : "s"}
        </p>
      </div>
      <label htmlFor="try" className="mt-3 block text-[13px] text-muted">
        Edit the caption; the rule checks run as you type, in your browser.
      </label>
      <textarea id="try" className="field mt-2 min-h-[84px] text-[15px]" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-4 rounded-[14px] bg-raised p-4">
        <AnnotatedText text={text} findings={findings} numbers={numbers} />
      </div>
      <ol className="mt-4 space-y-2.5">
        {findings.slice(0, 4).map((f) => (
          <li key={f.id} className="flex gap-3 text-[14px] leading-[21px]">
            <span className="marker !ml-0 mt-0.5 flex-none">{numbers.get(f.id)}</span>
            <span className="min-w-0">
              <span className="font-medium">{f.title}</span> <SeverityPill severity={f.severity} />
              <span className="block text-muted">
                {CATEGORY_LABEL[f.category]} · {f.ruleId}
                {f.factId ? ` · ${f.factId}` : ""}
                {f.fix && f.fix.kind === "replace" ? ` · fix: “${f.fix.replacement || "remove"}”` : ""}
              </span>
            </span>
          </li>
        ))}
        {findings.length === 0 && <li className="text-[14px] text-positive">No findings: this caption follows the rulebook.</li>}
      </ol>
    </div>
  );
}

/** Entrance motion: content is visible without script; with script, parts rise in as they enter. */
function useReveal() {
  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.add("js-reveal");
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function CitedFragment() {
  return (
    <div data-ui className="min-h-[214px] rounded-[16px] bg-sheet p-4 text-ink">
      <div className="flex items-center gap-2">
        <span className="marker !ml-0">1</span>
        <span className="text-[13px] font-medium">Claim</span>
        <SeverityPill severity="high" />
        <span className="ml-auto text-[12px] text-muted">Rule check + Claim Ledger</span>
      </div>
      <p className="mt-2 text-[14px] font-semibold">Claim contradicts an approved fact</p>
      <p className="mt-1.5 rounded-[10px] bg-raised px-3 py-1.5 text-[14px]">clinically proven to erase dark spots in just 7 days</p>
      <p className="mt-2 text-[13px] leading-5">“7 days” doesn&apos;t match F-112, which says 4 weeks. “Clinically proven” is not approved wording for an in-house study.</p>
      <p className="mt-2 text-[13px] leading-5">
        <span className="font-medium">CLAIM-01</span> · Velvra Brand Book v3 p.18 §6.1 · <span className="font-medium">F-112</span> · owner R&amp;D · valid to 31 Mar 2027
      </p>
    </div>
  );
}

function FixFragment() {
  return (
    <div data-ui className="min-h-[214px] rounded-[16px] bg-sheet p-4 text-ink">
      <p className="text-[12px] font-medium text-muted">Suggested minimal edit</p>
      <p className="mt-1 text-[14px] leading-[22px]">
        our new <del className="diff-del">sunblock</del> <ins className="diff-ins">Daily Shield SPF 50</ins> is <del className="diff-del">clinically proven to erase dark spots in just 7 days</del>{" "}
        <ins className="diff-ins">shown in our 4-week study to help skin look more even</ins>
      </p>
      <p className="mt-2 text-[13px] text-muted">Adds footnote: *In-house study, 40 participants, 2025.</p>
      <p className="mt-2 text-[13px] text-positive">✓ Intent kept: key message intact and strengthened</p>
      <p className="mt-1 text-[13px] text-muted">Key message: daily sun protection that evens skin tone</p>
    </div>
  );
}

function HealthFragment() {
  const rows = useMemo(() => {
    const h = seededHistory();
    return ruleHealth(VELVRA_KIT, h.findings, h.submissions).filter((r) => r.fires > 0).slice(0, 5);
  }, []);
  const max = Math.max(1, ...rows.map((r) => r.score));
  return (
    <div data-ui className="min-h-[214px] rounded-[16px] bg-sheet p-4 text-ink">
      <p className="text-[12px] font-medium text-muted">Unclear score, seeded demo history</p>
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.rule.id} className="grid grid-cols-[88px_1fr_28px] items-center gap-2 text-[13px]">
            <span className="font-medium">{r.rule.id}</span>
            <span className="h-2 rounded-full bg-rule">
              <span className={`block h-2 rounded-full ${r.unclear ? "bg-gold-mark" : "bg-[#cfc8b6]"}`} style={{ width: `${(r.score / max) * 100}%` }} />
            </span>
            <span className="num text-right">{r.score}</span>
          </li>
        ))}
      </ul>
      {rows[0] && (
        <p className="mt-2 text-[13px] leading-5">
          {rows[0].rule.id}: {rows[0].dismissed} dismissed and {rows[0].contested} contested in {rows[0].fires} findings.
        </p>
      )}
    </div>
  );
}

function HallmarkFragment() {
  const [hash, setHash] = useState<string>("");
  useEffect(() => {
    void sha256Hex(EXAMPLE).then(setHash);
  }, []);
  return (
    <div data-ui className="flex min-h-[214px] items-start gap-3 rounded-[16px] bg-sheet p-4 text-ink">
      <Mark size={34} />
      <div className="min-w-0">
        <p className="text-[14px] font-semibold">Hallmark · verified</p>
        <p className="text-[13px] text-muted">Rulebook v3.2 · Compliance and Reviewer approvals</p>
        <p className="num mt-1 truncate text-[13px]">sha256 {hash ? `${hash.slice(0, 24)}…` : "…"}</p>
        <ul className="mt-3 space-y-1 text-[13px] leading-5">
          <li>CLAIM-01 · fixed, then approved by Compliance</li>
          <li>CLAIM-03 · fixed, then approved by Compliance</li>
          <li>VOICE-02 · dismissed: “launch-day post, tone agreed”</li>
          <li>AI: none, rule checks only · 0 redactions</li>
        </ul>
      </div>
    </div>
  );
}

export function Landing() {
  useReveal();
  return (
    <div className="min-h-screen bg-chrome text-ink">
      <header className="mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark size={28} />
          <span className="text-[18px] font-semibold">Assay</span>
        </Link>
        <nav aria-label="Site" className="ml-auto hidden items-center gap-6 text-[14px] text-muted md:flex">
          <a href="#path" className="hover:text-ink">
            Judge path
          </a>
          <a href="#checks" className="hover:text-ink">
            What it checks
          </a>
          <Link href="/about" className="hover:text-ink">
            Trust
          </Link>
          <a href="https://github.com/shlok-shinde/assay" className="hover:text-ink">
            Code
          </a>
        </nav>
        <Link href="/app/new?sample=instagram-launch" className="btn btn-primary ml-auto md:ml-0">
          Start the demo
        </Link>
      </header>

      <main>
        <section className="mx-auto max-w-[1240px] px-4 pb-24 pt-10 md:px-8 lg:pt-14">
          <h1 data-reveal className="font-display max-w-[1120px] text-balance text-[34px] leading-[1.04] tracking-[-0.02em] md:text-[56px] lg:text-[76px]">
            Brand content, tested before it ships.
          </h1>
          <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
            <div className="max-w-[560px]">
              <p data-reveal style={{ ["--i" as string]: 1 }} className="text-[18px] leading-[29px]">
                Assay checks captions, emails, product pages and creatives against a brand&apos;s approved rules, facts and assets. Every issue quotes its evidence and cites
                its source, comes with a fix that keeps your message, and goes to a person for the final call.
              </p>
              <div data-reveal style={{ ["--i" as string]: 2 }} className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/app/new?sample=instagram-launch" className="btn btn-primary !h-11 !px-6 !text-[16px]">
                  Start the demo, no sign-up
                </Link>
                <Link href="/app/new" className="btn btn-secondary !h-11 !px-6 !text-[16px]">
                  Check your own draft
                </Link>
              </div>
              <p data-reveal style={{ ["--i" as string]: 3 }} className="mt-4 text-[14px] text-muted">
                No account. The demo workspace for Velvra, a fictional skincare brand, lives in your browser.
              </p>
              <figure data-reveal style={{ ["--i" as string]: 4 }} className="mt-10 max-w-[400px] overflow-hidden rounded-[24px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- static sample creative */}
                <img
                  src="/samples/velvra-monsoon-creative.webp"
                  width={1080}
                  height={1080}
                  alt="The sample Instagram creative: a photo of a cream Daily Shield SPF 50 tube beaded with raindrops on a hot-pink backdrop, a faint pink headline, “Glow like never before”, and a small velvra logo."
                  className="drift block"
                />
              </figure>
              <p className="mt-2 max-w-[400px] text-[14px] text-muted">The sample creative, made on an AI-generated product photo. Assay finds its 1.7:1 headline, its off-palette pink, its 96 px logo and its missing alt text.</p>
            </div>
            <div data-reveal style={{ ["--i" as string]: 2 }}>
              <LiveChecker />
            </div>
          </div>
        </section>

        <section id="path" aria-labelledby="path-h" className="bg-sheet">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-20 md:px-8 lg:grid-cols-[400px_minmax(0,1fr)]">
            <div>
              <h2 id="path-h" data-reveal className="font-display text-[34px] leading-[1.1] tracking-[-0.01em] md:text-[44px]">
                The judge path, in six steps
              </h2>
              <p data-reveal className="mt-4 text-[16px] leading-[26px]">
                About five minutes from a draft to a verified Hallmark. The same checklist stays in the app&apos;s sidebar and ticks itself off as you go.
              </p>
              <Link href="/app/new?sample=instagram-launch" className="btn btn-primary mt-6">
                Begin with the Instagram sample
              </Link>
            </div>
            <ol className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {STEPS.map(([t, d], i) => (
                <li key={t} data-reveal style={{ ["--i" as string]: i }} className="rounded-[20px] bg-raised p-5">
                  <p className="text-[18px] font-semibold">{t}</p>
                  <p className="mt-1.5 text-[16px] leading-[25px]">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="checks" aria-labelledby="checks-h" className="mx-auto max-w-[1240px] px-4 py-20 md:px-8">
          <h2 id="checks-h" data-reveal className="font-display max-w-[820px] text-[34px] leading-[1.1] tracking-[-0.01em] md:text-[44px]">
            Six kinds of issue, each with its source
          </h2>
          <dl className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
            {CHECKS.map(([k, id, d], i) => (
              <div key={k} data-reveal style={{ ["--i" as string]: i % 3 }}>
                <dt className="flex items-baseline gap-2 text-[18px] font-semibold">
                  {k} <span className="text-[13px] font-normal text-muted">{id}</span>
                </dt>
                <dd className="mt-1.5 text-[16px] leading-[25px]">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="diff-h" className="bg-ink text-white">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-20 md:px-8 lg:grid-cols-[400px_minmax(0,1fr)]">
            <h2 id="diff-h" data-reveal className="font-display text-[34px] leading-[1.1] tracking-[-0.01em] md:text-[44px]">
              Beyond a style checker
            </h2>
            <div className="grid gap-x-8 gap-y-10 md:grid-cols-2">
              {(
                [
                  ["Cited findings", "An AI finding must quote real text and cite a real rule, or the evidence verifier drops it and says how many it dropped.", <CitedFragment key="c" />],
                  ["Intent-preserving fixes", "Fixes replace only their own words, use the fact's approved wording, and are checked against the creator's Intent Card.", <FixFragment key="f" />],
                  ["Guideline Health", "Dismissals and contests show which rules are unclear, with the real examples and a drafted clarification.", <HealthFragment key="h" />],
                  ["Hallmarks", "Each approval records the content's SHA-256, the rulebook version, every decision and the AI used, chained to the last.", <HallmarkFragment key="m" />],
                ] as const
              ).map(([t, d, fragment], i) => (
                <div key={t} data-reveal style={{ ["--i" as string]: i % 2 }}>
                  <h3 className="text-[18px] font-semibold text-[#f3e6c4]">{t}</h3>
                  <p className="mt-1.5 text-[16px] leading-[25px] text-[#efe9dc]">{d}</p>
                  <div className="mt-4">{fragment}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="trust-h" className="mx-auto grid max-w-[1240px] gap-10 px-4 py-20 md:px-8 lg:grid-cols-[400px_minmax(0,1fr)]">
          <h2 id="trust-h" data-reveal className="font-display text-[34px] leading-[1.1] tracking-[-0.01em] md:text-[44px]">
            Built to be trusted
          </h2>
          <ul data-reveal className="grid gap-6 text-[16px] leading-[26px] md:grid-cols-2">
            <li>
              <span className="font-semibold">It works without AI.</span> Claims, terms, disclaimers, contrast and palette are checked in code. Gemini only judges tone and messaging.
            </li>
            <li>
              <span className="font-semibold">Drafts stay in your browser.</span> Files are read locally; only redacted paragraphs go to the AI route, and Confidential mode sends nothing.
            </li>
            <li>
              <span className="font-semibold">People decide.</span> Nothing is applied automatically, and high-severity findings can&apos;t be dismissed by the creator alone.
            </li>
            <li>
              <span className="font-semibold">Disclosed.</span> The About page lists every service, library and licence, the free-tier data terms, and how the code was written.
            </li>
          </ul>
        </section>
      </main>

      <footer className="bg-sheet">
        <div className="mx-auto max-w-[1240px] px-4 py-14 md:px-8">
          <p className="font-display text-[64px] leading-none tracking-[-0.03em] md:text-[120px]">Assay</p>
          <div className="mt-8 flex flex-wrap justify-between gap-6 text-[14px] text-muted">
            <p>
              Team 24K MAGIC · Shlok Sudhakar Shinde · SPIT, Mumbai · CodeStar 30 Round 2, problem statement by Inkloom AI.
              <br />
              Google Gemini runs inside the app. Velvra is fictional.
            </p>
            <nav aria-label="Footer" className="flex gap-5">
              <Link href="/app" className="hover:text-ink">
                Open the app
              </Link>
              <Link href="/about" className="hover:text-ink">
                About and trust
              </Link>
              <a href="https://github.com/shlok-shinde/assay" className="hover:text-ink">
                Source code
              </a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
