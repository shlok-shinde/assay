# Assay

**Brand content, tested before it ships.**

Assay checks captions, emails, product pages, brochures and creatives against a brand's approved rules, facts and assets. Every issue quotes its evidence and cites the rule or fact behind it, comes with the smallest fix that keeps the creator's message, and goes to a person for the final call. Approved versions get a hash-chained **Hallmark**, and **Guideline Health** shows which rules people keep pushing back on.

CodeStar 30 · Round 2 · Team **24K MAGIC** (solo: Shlok Sudhakar Shinde, SPIT Mumbai) · Problem statement by Inkloom AI.

- **Live app:** https://assay-kappa-three.vercel.app (no sign-in; press "Start the demo, no sign-up")
- **Start here:** open the app and press **Start the demo, no sign-up**. No account is needed; the demo workspace lives in your browser.

> Velvra, its brand book, rules, facts, people and drafts are fictional demo data made for this project.

## The judge path (about five minutes)

1. **Open the Instagram sample.** It is the Round 1 worked example: a caption and its creative.
2. **Read the cited findings.** Eight findings: two claims, tone, a term, two visual and two accessibility issues. Each quotes the draft and cites a rule (with its Brand Book page and section) or a Claim Ledger fact (with its owner and validity).
3. **Accept fixes and apply them.** Fixes replace only their own words. The intent check says whether the key message and call to action survived. Applying them creates v2 with a diff.
4. **Submit for review.** It unlocks once no high-severity finding is left open. Claims, including ones already fixed, go to Compliance.
5. **Approve as Compliance, then as Reviewer** (role switcher at the top). Approval writes a Hallmark; press **Verify**.
6. **Open Guideline Health.** See the rules people dismiss or contest, repeated mistakes, and facts about to expire.

The same checklist stays in the app's sidebar and ticks itself off.

## What works

| Area | What is built |
|---|---|
| Intake | Paste text; upload DOCX, text-based PDF (page numbers kept) or PNG/JPG; channel and audience; six samples; an Intent Card drafted by a heuristic or the AI and confirmed by the creator; alt text; a hand-marked logo box |
| Rule checks (code) | Lexicon and product names, banned and hype phrases, fear-based language, instant-results promises, guarantees, medical claims, superlatives, channel limits for emoji, exclamation marks and capitals, CamelCase hashtags, link text, Flesch readability, the SPF reapply disclaimer |
| Claim Ledger | Claims found by pattern families and fact triggers, matched to facts with BM25 (or the AI's choice among the same candidates), then compared **in code**: numbers, units, periods, “clinically” wording and validity dates. Each claim is supported, contradicted, outdated or unsupported, always with a fact ID |
| AI judgment | Gemini judges only the tone and messaging rules, with their do and don't examples and the Intent Card. Typed tasks only, 8,000-character cap, zod-validated output |
| Evidence verifier | AI findings must quote text at the stated offsets (or uniquely elsewhere, then relocated and counted) and cite an active judgment rule. Failures are dropped and the count is shown |
| Visual checks | Palette by k-means and CIEDE2000; text contrast from tesseract.js word boxes and a two-cluster colour split per line; missing alt text; logo size and clear space from the marked box |
| Fixes | Span-only replacements, the fact's approved wording plus footnote for claims, batch apply with overlap detection, heuristic and AI intent checks, versions with diffs, partial re-checks from the paragraph cache |
| Review | Accept, edit, dismiss with reason (not for high severity by the creator), contest rule, send to Compliance; comments per draft and per finding; Compliance approves or sends back claims; Reviewer approves or requests changes; append-only audit log |
| Hallmark | SHA-256 of the content and of the rulebook version, every finding's outcome, approvers, AI models, call and redaction counts, chained to the previous Hallmark; Verify and a Markdown record |
| Brand Kit | Rules, Claim Ledger, terms, palette, logo and channel limits, edited as a draft and published as versioned rulebooks; brand-book import (AI draft or heuristic) into an approval queue; Confidential mode |
| Guideline Health | Unclear-rule score from dismissals, contests, reopenings and approvals despite a flag, with the real examples; repeated mistakes by channel and author; facts expiring within 30 days; a template or AI-drafted clarification that a Brand Admin can save to the rulebook draft |
| Trust | About page with every service, library and licence, the Gemini free-tier data terms, the AI call log (no content), workspace export and import, and Reset demo |

## Architecture

```
Browser (Next.js client)                                  Server (Next.js route handlers on Vercel)
┌──────────────────────────────────────────────┐          ┌──────────────────────────────────────────┐
│ Intake: mammoth (DOCX), pdfjs (PDF), canvas   │          │ POST /api/ai  typed tasks only            │
│ Engine (src/engine, TypeScript):              │  redacted│   zod input → cap → redact again          │
│  parse → rule checks → claims (BM25 + code)   │ ────────▶│   → Gemini REST (key pool, model chain)   │
│  → AI judgment (cached per paragraph)         │ ◀────────│   → zod output → offsets mapped back      │
│  → evidence verifier → merge and rank         │  JSON    │ GET /api/status  {aiConfigured, keyCount, │
│ Visual: k-means, ΔE2000, tesseract.js OCR     │          │                  keysAvailable, models}   │
│ Workspace: IndexedDB (Dexie), roles, Hallmarks│          └──────────────────────────────────────────┘
└──────────────────────────────────────────────┘
```

More detail, including the decisions and how they changed from the Round 1 plan, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## AI use and disclosure

- **Runtime:** Google Gemini (free tier) through `src/server/ai`. Default models `gemini-3.6-flash` then `gemini-3.8-flash` for judgment, `gemini-3.5-flash-lite` then `gemini-3.1-flash-lite` for lighter tasks; override with `GEMINI_MODEL` and `GEMINI_MODEL_LITE`. Google's terms for unpaid services allow Google to use inputs and outputs to improve its products, and human reviewers may read them. Assay redacts emails, phone numbers, ID and card numbers and secrets in the browser and again on the server, and **Confidential mode** sends nothing.
- **Without a key** the app runs in rule-checks-only mode and says so on every check.
- **Sample photo:** the product photo in the sample creative was generated with Google's Gemini image model (Nano Banana). Velvra and its tube are fictional.
- **AI assistance:** Built with AI coding assistance. Google Gemini runs inside the app.

## Running it locally

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Optional AI: set `GEMINI_API_KEYS` before `pnpm dev`. It accepts any of these:

- a JSON array: `["key-one","key-two"]`
- a JSON object of label to key: `{"main":"key-one","backup":"key-two"}` (labels appear in logs; keys never do)
- a list separated by commas, spaces, semicolons or newlines

`GEMINI_API_KEY` and `GEMINI_API_KEY_1` … `GEMINI_API_KEY_9` are merged in too. Keys rotate round-robin; a 429 cools a key down for Gemini's `retryDelay` (or until Pacific midnight for a daily quota), and a 401/403 disables it.

## Tests and evaluation

| Command | What it runs |
|---|---|
| `pnpm test` | 74 unit tests in **Chromium** (Vitest browser mode): claim ledger, rule checks, verifier, redaction, fixes and intent, colour maths, Hallmarks, Guideline Health, the key pool and Gemini fallback, and the visual check on the real sample creative with real OCR |
| `pnpm eval` | The golden set (64 labelled drafts) per category; fails CI on a regression |
| `pnpm build && pnpm e2e` | 17 Playwright tests in **Chromium**: the full judge path, uploads, brand-book import and publishing, AI rate-limit fallback, the phone layout, and axe on every main screen |

Results are in [docs/EVALUATION.md](docs/EVALUATION.md). The golden labels were written by the builder with AI assistance, so they measure the engine against its own spec, not real-world accuracy.

## Built with

Next.js 16, React 19, Tailwind CSS 4, TypeScript (MIT / Apache-2.0) · Dexie and dexie-react-hooks (Apache-2.0) · zod (MIT) · pdfjs-dist (Apache-2.0) · mammoth (BSD-2-Clause) · tesseract.js and its English data (Apache-2.0) · culori (MIT) · diff-match-patch (Apache-2.0) · lucide-react (ISC) · Inter, Fraunces and JetBrains Mono (OFL-1.1) · Vitest, Playwright, axe-core (MIT / Apache-2.0 / MPL-2.0). Scaffolded with `create-next-app`. Hosted on Vercel. No UI kit or template.

## Team

**24K MAGIC**: Shlok Sudhakar Shinde (solo), 3rd year Computer Science and Engineering, Sardar Patel Institute of Technology (SPIT), Mumbai. GitHub [@shlok-shinde](https://github.com/shlok-shinde).
