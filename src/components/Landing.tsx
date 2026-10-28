"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { AssayScene } from "./AssayScene";
import "./landing.css";

// Class names for landing.css, which is global with an lp- prefix (next.config routes *.css through the
// Tailwind loader, which turns CSS Modules into plain CSS).
const s: Record<string, string> = new Proxy({}, { get: (_t, key) => `lp-${String(key)}` });

const DEMO = "/app/new?sample=instagram-launch";
const REPO = "https://github.com/shlok-shinde/assay";

// Three captions for the live checker; the engine finds 4, 4 and 0 issues in them.
const EXAMPLES: [string, string][] = [
  ["Instagram launch", "OMG our new sunblock is clinically proven to erase dark spots in just 7 days! The best serum in India. Shop now via the link in bio"],
  ["Monsoon offer", "Monsoon glow, now 25% off with code RAIN25. Our whitening formula gives visible results, guaranteed. Click here"],
  ["A clean caption", "Daily Shield SPF 50 is lightweight daily protection for humid days. Reapply every 2 hours. Shop via the link in bio."],
];

const KINDS: [string, string][] = [
  ["hype in the tone", "VOICE-02"],
  ["banned words like “whitening”", "TERM-05"],
  ["instant-results promises", "MSG-02"],
  ["a discount the Claim Ledger says is wrong", "F-107"],
  ["a pink ΔE 18 off the palette", "VIS-01"],
  ["a headline at 1.7:1 contrast", "A11Y-01"],
];

/** Below-the-fold entrances. Content is visible without script; the hidden state is set only when motion is allowed. */
function useEntrances() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = [...el.querySelectorAll<HTMLElement>("[data-enter]")].filter((t) => t.getBoundingClientRect().top > window.innerHeight);
    for (const t of targets) t.setAttribute("data-pending", "");
    el.setAttribute("data-motion", "");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add(s.in);
            io.unobserve(e.target);
          }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    // Anything already on screen when the page opens is shown at once.
    for (const t of el.querySelectorAll<HTMLElement>("[data-enter]")) {
      if (!t.hasAttribute("data-pending")) t.classList.add(s.in);
      else io.observe(t);
    }
    return () => io.disconnect();
  }, []);
  return root;
}

function Readout({ value }: { value: string }) {
  return (
    <span className={s.readout}>
      <span key={value} className={`num ${s.roll}`}>
        {value}
      </span>
    </span>
  );
}

function Hero() {
  const [fixed, setFixed] = useState(false);
  const touched = useRef(false);
  // Once the load sequence has settled, the fixes apply themselves once; after that the switch is the visitor's.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => {
      if (!touched.current) setFixed(true);
    }, 2200);
    return () => window.clearTimeout(t);
  }, []);
  const toggle = () => {
    touched.current = true;
    setFixed((f) => !f);
  };
  const images = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- static crop of the sample creative */}
      <img src="/landing/strip.webp" alt="" width={780} height={312} fetchPriority="high" />
      {/* eslint-disable-next-line @next/next/no-img-element -- static crop of the corrected creative */}
      <img src="/landing/strip-fixed.webp" alt="" width={780} height={312} className={s.after} />
    </>
  );
  return (
    <section className={`${s.hero} ${fixed ? s.isFixed : ""}`}>
      <div className={`${s.wrap} w-full`}>
        <header className={s.bar}>
          <Link href="/" className={s.wordmark}>
            <Mark size={30} />
            Assay
          </Link>
          <nav aria-label="Site" className={s.nav}>
            <a href="#how">How it works</a>
            <a href="#try">Try a caption</a>
            <Link href="/about">Trust</Link>
            <a href={REPO}>Code</a>
          </nav>
          <Link href={DEMO} className={`${s.button} ${s.buttonAccent} ${s.barAction}`}>
            Start the demo
          </Link>
        </header>
      </div>

      <div className={`${s.wrap} ${s.stage} w-full`}>
        <div className={`${s.chipRow} ${s.chipRowTop}`}>
          <div data-ui className={`${s.chip} ${s.chipA} ${s.load}`} style={{ ["--d" as string]: "560ms" }}>
            <span className={s.chipLabel}>Palette · VIS-01</span>
            <Readout value={fixed ? "ΔE 2" : "ΔE 18"} />
            <span className={s.chipNote}>{fixed ? "On palette: Rose Clay" : "Off palette; the limit is 10"}</span>
          </div>
        </div>

        <h1 className={`${s.display} ${s.title}`}>
          <span className={s.line}>
            <span className={s.lineInner}>
              Brand content,
              <span className={s.frame} aria-hidden="true">
                {images}
              </span>
            </span>
          </span>{" "}
          <span className={s.line}>
            <span className={s.lineInner} style={{ ["--i" as string]: 1 }}>
              tested before it ships.
            </span>
          </span>
        </h1>
        <div className={`${s.strip} ${s.load}`} style={{ ["--d" as string]: "420ms" }} aria-hidden="true">
          {images}
        </div>

        <div className={`${s.chipRow} ${s.chipRowBottom}`}>
          <div data-ui className={`${s.chip} ${s.chipB} ${s.load}`} style={{ ["--d" as string]: "640ms" }}>
            <span className={s.chipLabel}>Headline contrast · A11Y-01</span>
            <Readout value={fixed ? "5.7:1" : "1.7:1"} />
            <span className={s.chipNote}>{fixed ? "Passes WCAG AA" : "Fails WCAG AA; needs 3:1"}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={fixed}
            aria-describedby="hero-switch-desc"
            onClick={toggle}
            data-ui
            className={`${s.chip} ${s.chipC} ${s.load}`}
            style={{ ["--d" as string]: "720ms" }}
          >
            <span className={s.chipLabel}>Apply the fixes</span>
            <span className={s.switch} aria-hidden="true" />
            <span className={s.chipNote}>
              {fixed ? "0" : "4"} visual findings on the sample creative
            </span>
            <span id="hero-switch-desc" className={s.srOnly}>
              Switches the sample Velvra creative, a sunscreen tube photographed on hot pink, to the corrected version on Rose Clay.
            </span>
          </button>
        </div>

        <p className={`${s.lead} ${s.load}`} style={{ ["--d" as string]: "460ms" }}>
          Assay checks captions, emails, product pages and creatives against a brand&apos;s approved rules, facts and palette. Every finding quotes its evidence, cites its
          source and comes with a fix that keeps your message.
        </p>
        <div className={`${s.actions} ${s.load}`} style={{ ["--d" as string]: "540ms" }}>
          <Link href={DEMO} className={`${s.button} ${s.buttonAccent}`}>
            Start the demo, no sign-up
          </Link>
          <Link href="/app/new" className={s.textLink}>
            Check your own draft
          </Link>
        </div>
      </div>
    </section>
  );
}

function LiveChecker() {
  const [text, setText] = useState(EXAMPLES[0][1]);
  const findings = useMemo<Finding[]>(() => {
    const raw = mergeFindings([...ruleChecks(text, VELVRA_KIT, "instagram"), ...analyzeClaims(text, VELVRA_KIT, new Date().toISOString().slice(0, 10)).findings]);
    return raw.map((f, i) => ({ ...f, id: `live-${i}`, checkId: "live", submissionId: "live", versionId: "live", status: "open" }));
  }, [text]);
  const numbers = useMemo(() => new Map(findings.map((f, i) => [f.id, i + 1])), [findings]);
  return (
    <section id="try" aria-labelledby="try-h" className={`${s.showcase} ${s.wrap}`}>
      <div className={s.showGrid}>
        <div>
          <h2 id="try-h" data-enter className={`${s.display} ${s.h2} ${s.reveal}`}>
            Try it on a caption
          </h2>
          <p data-enter className={`${s.sectionLead} ${s.reveal}`} style={{ ["--i" as string]: 1 }}>
            The rule checks run as you type, in your browser, against Velvra&apos;s published rulebook and Claim Ledger. No account, and nothing is sent anywhere.
          </p>
          <div data-enter className={s.reveal} style={{ ["--i" as string]: 2 }}>
            <label htmlFor="caption" className={s.srOnly}>
              Instagram caption to check
            </label>
            <textarea id="caption" data-ui className={s.caption} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
            <div className={s.examples}>
              <span>Or try</span>
              {EXAMPLES.map(([name, caption]) => (
                <button key={name} type="button" className={s.example} aria-pressed={text === caption} onClick={() => setText(caption)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div data-enter data-ui className={`${s.answer} ${s.reveal}`} style={{ ["--i" as string]: 3 }} aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[16px] font-semibold">Velvra rulebook v3.2 · Instagram</p>
            <p className="num text-[16px] text-muted">
              {findings.length} finding{findings.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="mt-4 rounded-[16px] bg-raised p-4 text-[16px]">
            <AnnotatedText text={text} findings={findings} numbers={numbers} />
          </div>
          <ol className="mt-5 space-y-3">
            {findings.slice(0, 6).map((f) => (
              <li key={`${f.ruleId}-${f.quote}`} className={`${s.findingItem} flex gap-3 text-[16px] leading-[24px]`}>
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
            {findings.length === 0 && <li className="text-[16px] text-positive">No findings: this caption follows the rulebook.</li>}
          </ol>
        </div>
      </div>
    </section>
  );
}

function CitedFragment() {
  return (
    <div data-ui className="rounded-[20px] bg-raised p-5 text-ink">
      <div className="flex items-center gap-2">
        <span className="marker !ml-0">1</span>
        <span className="text-[14px] font-medium">Claim</span>
        <SeverityPill severity="high" />
        <span className="ml-auto text-[14px] text-muted">Rule check + Claim Ledger</span>
      </div>
      <p className="mt-2 text-[16px] font-semibold">Claim contradicts an approved fact</p>
      <p className="mt-2 rounded-[10px] bg-sheet px-3 py-1.5 text-[16px]">clinically proven to erase dark spots in just 7 days</p>
      <p className="mt-2 text-[16px] leading-[24px]">“7 days” doesn&apos;t match F-112, which says 4 weeks. “Clinically proven” is not approved wording for an in-house study.</p>
      <p className="mt-2 text-[14px] leading-5 text-muted">CLAIM-01 · Velvra Brand Book v3 p.18 §6.1 · F-112 · owner R&amp;D · valid to 31 Mar 2027</p>
    </div>
  );
}

function FixFragment() {
  return (
    <div data-ui className="rounded-[20px] bg-raised p-5 text-ink">
      <p className="text-[14px] font-medium text-muted">Suggested minimal edit</p>
      <p className="mt-1 text-[16px] leading-[25px]">
        our new <del className="diff-del">sunblock</del> <ins className="diff-ins">Daily Shield SPF 50</ins> is <del className="diff-del">clinically proven to erase dark spots in just 7 days</del>{" "}
        <ins className="diff-ins">shown in our 4-week study to help skin look more even</ins>
      </p>
      <p className="mt-2 text-[14px] text-muted">Adds footnote: *In-house study, 40 participants, 2025.</p>
      <p className="mt-2 text-[16px] font-medium text-positive">Intent kept: key message intact and strengthened</p>
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
    <div data-ui className="rounded-[20px] bg-raised p-5 text-ink">
      <p className="text-[14px] font-medium text-muted">Unclear score, seeded demo history</p>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.rule.id} className="grid grid-cols-[92px_1fr_28px] items-center gap-2 text-[14px]">
            <span className="font-medium">{r.rule.id}</span>
            <span className="h-2 rounded-full bg-rule">
              <span className={`block h-2 rounded-full ${r.unclear ? "bg-gold-mark" : "bg-[#cfc8b6]"}`} style={{ width: `${(r.score / max) * 100}%` }} />
            </span>
            <span className="num text-right">{r.score}</span>
          </li>
        ))}
      </ul>
      {rows[0] && (
        <p className="mt-3 text-[14px] leading-5">
          {rows[0].rule.id}: {rows[0].dismissed} dismissed and {rows[0].contested} contested in {rows[0].fires} findings.
        </p>
      )}
    </div>
  );
}

function HallmarkFragment() {
  const [hash, setHash] = useState<string>("");
  useEffect(() => {
    void sha256Hex(EXAMPLES[0][1]).then(setHash);
  }, []);
  return (
    <div data-ui className="flex items-start gap-3 rounded-[20px] bg-raised p-5 text-ink">
      <Mark size={36} />
      <div className="min-w-0">
        <p className="text-[16px] font-semibold">Hallmark · verified</p>
        <p className="text-[14px] text-muted">Rulebook v3.2 · Compliance and Reviewer approvals</p>
        <p className="num mt-1 truncate text-[14px]">sha256 {hash ? `${hash.slice(0, 24)}…` : "…"}</p>
        <ul className="mt-3 space-y-1 text-[14px] leading-5">
          <li>CLAIM-01 · fixed, then approved by Compliance</li>
          <li>CLAIM-03 · fixed, then approved by Compliance</li>
          <li>VOICE-02 · dismissed: “launch-day post, tone agreed”</li>
        </ul>
      </div>
    </div>
  );
}

function Features() {
  const rows: [string, string, React.ReactNode, string][] = [
    ["Cited findings", "An AI finding must quote real text and cite a real rule, or the evidence verifier drops it and says how many it dropped.", <CitedFragment key="c" />, "420px"],
    ["Fixes that keep the message", "Fixes replace only their own words, use the fact's approved wording, and are checked against the creator's Intent Card.", <FixFragment key="f" />, "360px"],
    ["Guideline Health", "Dismissals and contests show which rules people find unclear, with the real examples and a drafted clarification.", <HealthFragment key="h" />, "400px"],
    ["Hallmarks", "Each approval records the content's hash, the rulebook version, every decision and the AI used, chained to the last.", <HallmarkFragment key="m" />, "380px"],
  ];
  return (
    <section aria-labelledby="beyond-h" className={s.features}>
      <div className={`${s.wrap} ${s.axis}`}>
        <h2 id="beyond-h" data-enter className={`${s.display} ${s.h2} ${s.featureHead} ${s.reveal}`}>
          Beyond a style checker
        </h2>
        <div className={s.rows}>
          {rows.map(([title, text, fragment, w]) => (
            <div key={title} className={s.row}>
              <div>
                <h3 data-enter className={`${s.display} ${s.rowTitle} ${s.reveal}`}>
                  {title}
                </h3>
                <p data-enter className={`${s.rowText} ${s.reveal}`} style={{ ["--i" as string]: 1 }}>
                  {text}
                </p>
              </div>
              <div data-enter className={`${s.fragment} ${s.reveal}`} style={{ ["--w" as string]: w, ["--i" as string]: 2 }}>
                {fragment}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** One kind lit at a time, every two seconds, only while the sentence is on screen and the tab is visible. */
function Proof() {
  const [lit, setLit] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    let visible = false;
    const tick = () => {
      window.clearInterval(timer);
      if (visible && !document.hidden) timer = window.setInterval(() => setLit((n) => (n + 1) % KINDS.length), 2000);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      tick();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", tick);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", tick);
      window.clearInterval(timer);
    };
  }, []);
  return (
    <section aria-labelledby="kinds-h" className={`${s.proof} ${s.wrap}`}>
      <div ref={ref} data-enter className={`${s.proofText} ${s.reveal}`}>
        <h2 id="kinds-h">Six kinds of issue, each with its source: </h2>
        <p>
          {KINDS.map(([what, id], i) => (
            <span key={id}>
              <span className={s.kind} data-lit={i === lit ? "" : undefined}>
                {what} <span>({id})</span>
              </span>
              {i < KINDS.length - 2 ? ", " : i === KINDS.length - 2 ? ", and " : "."}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}

function About() {
  return (
    <section aria-labelledby="trust-h" className={s.about}>
      <div className={`${s.wrap} ${s.aboutGrid}`}>
        <div className={s.facts}>
          <p>Made in Mumbai</p>
          <p>CodeStar 30, Round 2</p>
          <p>
            <a href={REPO} className={`${s.textLink} underline`}>
              Source on GitHub
            </a>
          </p>
        </div>
        <div data-enter className={`${s.bio} ${s.reveal}`}>
          <span className={s.dropCap} aria-hidden="true">
            <Mark size={200} />
          </span>
          <h2 id="trust-h">Built to be trusted. </h2>
          <p>
            It works without AI: claims, terms, disclaimers, contrast and palette are checked in code, and Gemini judges only tone and messaging. Drafts stay in your browser;
            only redacted paragraphs reach the AI route, and Confidential mode sends nothing. People decide: nothing is applied automatically.
          </p>
          <p className={s.soft}>
            Built by Shlok Sudhakar Shinde, team 24K MAGIC, at SPIT Mumbai.{" "}
            <Link href="/about" className="text-ink underline">
              The About page
            </Link>{" "}
            lists every service, library and licence, and the free-tier data terms.
          </p>
        </div>
      </div>
    </section>
  );
}

function Close() {
  return (
    <footer className={s.close}>
      <div className={`${s.wrap} ${s.closeTop} w-full`}>
        <div>
          <p data-enter className={`${s.display} ${s.invite} ${s.reveal}`}>
            Five minutes, draft to Hallmark
          </p>
          <div data-enter className={`mt-8 ${s.reveal}`} style={{ ["--i" as string]: 1 }}>
            <Link href={DEMO} className={`${s.button} ${s.buttonAccent}`}>
              Start the demo, no sign-up
            </Link>
          </div>
        </div>
        <nav aria-label="Footer" className={s.closeLinks}>
          <Link href="/app" className={s.textLink}>
            Open the app
          </Link>
          <Link href="/about" className={s.textLink}>
            About and trust
          </Link>
          <a href={REPO} className={s.textLink}>
            Source code
          </a>
        </nav>
      </div>
      <div className={`${s.wrap} ${s.credits} w-full`}>
        <p>Team 24K MAGIC · Shlok Sudhakar Shinde · SPIT, Mumbai · CodeStar 30 Round 2, problem statement by Inkloom AI.</p>
        <p>Google Gemini runs inside the app. Velvra is fictional; its product photo was generated with Gemini.</p>
      </div>
      <p className={s.giant} aria-hidden="true">
        Assay
      </p>
    </footer>
  );
}

export function Landing() {
  const root = useEntrances();
  return (
    <div ref={root} className={s.page}>
      <main>
        <Hero />
        <LiveChecker />
        <AssayScene />
        <Features />
        <Proof />
        <About />
      </main>
      <Close />
    </div>
  );
}
