# Assay

**Brand content, tested before it ships.**

Assay checks captions, emails, product pages, brochures and creatives against a brand's approved rules, facts and assets. Every issue quotes its evidence and cites the rule or fact behind it, comes with the smallest fix that keeps the creator's message, and goes to a person for the final call. Approved versions get a hash-chained **Hallmark**, and **Guideline Health** shows which rules people keep pushing back on.

CodeStar 30 · Round 3 · Team **24K MAGIC** (solo: Shlok Sudhakar Shinde, SPIT Mumbai) · Problem statement by Inkloom AI.

- **Live app:** https://assay-kappa-three.vercel.app (no sign-in; press "Start the demo, no sign-up")
- **Start here:** open the app and press **Start the demo, no sign-up**. No account is needed; the demo workspace lives in your browser.

> Velvra, its brand book, rules, facts, people and drafts are fictional demo data made for this project.

## The three things Round 2 promised

| Promise | Where it stands |
|---|---|
| **Cited findings:** every finding opens the brand-book page at the cited paragraph; precision and recall per category, AI judgment included; a golden set of 100+ drafts labelled by people other than the builder | The viewer and the scores are here. The scoring states how many drafts people have labelled, and says "not delivered" or "partly delivered" until the count earns more: see [docs/EVALUATION.md](docs/EVALUATION.md) |
| **Intent-preserving fixes:** an automatic intent check on every fix, conflict-aware application of several fixes on one sentence, a measured acceptance rate per rule | Built. The rate is computed from real decisions in each workspace, leaving out seeded history and automated browsers. True collisions are rare, because the engine merges overlapping findings first; the sample "colliding fixes" reaches one in a click |
| **Guideline Health:** one-click publishing of AI-drafted clarifications as a new rulebook version; fact-expiry alerts sent to each fact's owner | Built. Demo owners use made-up addresses and are never mailed; a visitor can send one real alert to themselves. Team workspaces mail real owners once a day |

## The judge path (about five minutes)

1. **Open the Instagram sample.** It is the Round 1 worked example: a caption and its creative.
2. **Read the cited findings.** Eight findings: two claims, tone, a term, two visual and two accessibility issues. Each quotes the draft and cites a rule or a Claim Ledger fact. **Press a citation:** the brand book opens at that page with the paragraph marked.
3. **Accept fixes and apply them.** Fixes replace only their own words. The intent check says whether the key message and call to action survived. Applying them creates v2 with a diff.
4. **Submit for review.** It unlocks once no high-severity finding is left open. Claims, including ones already fixed, go to Compliance.
5. **Approve as Compliance, then as Reviewer** (role switcher at the top). Approval writes a Hallmark; press **Verify**.
6. **Open Guideline Health.** See which rule people push back on most, its acceptance rate, and facts about to expire. Publish a clarification in one click, and undo it.
7. **Open the Inbox.** Fact-expiry alerts by owner. Send one real one to your own address if you like.

The same checklist stays in the app's sidebar and ticks itself off, and you can put it away.

## What works

| Area | What is built |
|---|---|
| Intake | Paste text; upload DOCX, text-based PDF (page numbers kept) or PNG/JPG up to 10 MB and 40 megapixels; channel and audience; samples; an Intent Card drafted by a heuristic or the AI and confirmed by the creator; alt text; a logo box marked by hand, if the wordmark isn't found |
| Rule checks (code) | Lexicon and product names, banned and hype phrases, fear-based language, instant-results promises, guarantees, medical claims, superlatives, channel limits for emoji, exclamation marks and capitals, CamelCase hashtags, link text, Flesch readability, the SPF reapply disclaimer |
| Claim Ledger | Claims found by pattern families and fact triggers, matched to facts with BM25 (or the AI's choice among the same candidates), then compared **in code**: numbers, units, periods, “clinically” wording and validity dates. Each claim is supported, contradicted, outdated or unsupported, always with a fact ID |
| AI judgment | Gemini judges only the tone and messaging rules, with their do and don't examples and the Intent Card. Typed tasks only, 8,000 characters per call, zod-validated output. Long drafts go over several calls and the banner says how far the AI read; a large rulebook sends the 20 rules closest to the draft |
| Evidence verifier | AI findings must quote text at the stated offsets (or uniquely elsewhere, then relocated and counted) and cite an active judgment rule. Failures are dropped and the count is shown |
| Visual checks | Palette by k-means and CIEDE2000; text contrast from tesseract.js word boxes and a two-cluster colour split per line; missing alt text; logo size and clear space, from the brand's wordmark as OCR reads it, or a box marked by hand. A logo that is a picture needs the box |
| Fixes | Span-only replacements, the fact's approved wording plus footnote for claims. Fixes on one sentence are read together; fixes that want the same words open a resolver (either fix, a code merge, an AI merge that must pass validation, or your own words). An intent verdict on every fix; losing the message needs a recorded reason, sealed into the Hallmark. Versions with diffs, partial re-checks from the paragraph cache |
| Review | Accept, edit, dismiss with reason (not for high severity by the creator), contest rule, send to Compliance; comments per draft and per finding; Compliance approves or sends back claims; Reviewer approves or requests changes; append-only audit log |
| Hallmark | SHA-256 of the content and of the rulebook version, every finding's outcome, approvers, AI models, call and redaction counts, chained to the previous Hallmark; Verify, a Markdown record, and a report for any draft that downloads or prints |
| Brand Kit | Rules, Claim Ledger, terms, palette, logo and channel limits, edited as a draft and published as versioned rulebooks with rollback; whole-book import (rules only: AI draft or heuristic, each quote kept, the PDF kept) into an approval queue; Confidential mode |
| Brands | Any number, each its own browser database, with a setup screen and starter rules with nothing about Velvra in them |
| Team workspaces | Optional, and only on a deployment with a database and email: email sign-in, invitations with a role, row sync between members, and the workflow enforced on the server. Without them the app is browser-only and says so |
| Guideline Health | Unclear-rule score from dismissals, contests, reopenings and approvals despite a flag, with the real examples; fix acceptance per rule; repeated mistakes by channel and author; fact alerts at 30, 14, 7, 1 and 0 days, by owner; an AI-drafted clarification with a before and after that publishes as a new version in one click, and rolls back |
| Trust | About page with every service, library and licence, the Gemini free-tier data terms, the AI call log (no content), workspace export and validated import with a backup, and Reset demo |

## Architecture

```
Browser (Next.js client)                                  Server (Next.js route handlers on Vercel)
┌──────────────────────────────────────────────┐          ┌──────────────────────────────────────────┐
│ Intake: mammoth (DOCX), pdf.js (PDF), canvas  │          │ POST /api/ai   typed tasks only           │
│ Engine (src/engine, TypeScript):              │  redacted│   zod → cap → redact again → Gemini       │
│  parse → rule checks → claims (BM25 + code)   │ ────────▶│   (key pool, model chain) → zod           │
│  → AI judgment (cached per paragraph)         │ ◀────────│ GET  /api/status                          │
│  → evidence verifier → merge and rank         │          │ POST /api/label  answers from /label      │
│ Visual: k-means, ΔE2000, tesseract.js OCR     │          │ POST /api/demo/fact-alert  one fixed mail │
│ Book: pdf.js page with the paragraph marked   │          │ Only with a database:                     │
│ Workspace: IndexedDB (Dexie), one per brand   │  team    │ /api/team/*  sign-in, row sync, Hallmarks │
│ Team only: capture and sync, loaded on demand │ ◀──────▶ │ /api/cron/fact-alerts  daily owner digest │
└──────────────────────────────────────────────┘  rows    └──────────────┬───────────────────────────┘
                                                                         ▼ Postgres (Neon)
```

More detail, including the decisions and how they changed from the Round 1 plan, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## AI use and disclosure

- **Runtime:** Google Gemini (free tier) through `src/server/ai`. Default models `gemini-3.6-flash` then `gemini-3.8-flash` for judgment, `gemini-3.5-flash-lite` then `gemini-3.1-flash-lite` for lighter tasks; override with `GEMINI_MODEL` and `GEMINI_MODEL_LITE`. Google's terms for unpaid services allow Google to use inputs and outputs to improve its products, and human reviewers may read them. Assay redacts emails, phone numbers, ID and card numbers, secrets and the names of known people in the browser, redacts the rest again on the server, and **Confidential mode** sends nothing.
- **Without a key** the app runs in rule-checks-only mode and says so on every check.
- **Sample photo:** the product photo in the sample creative was generated with Google's Gemini image model (Nano Banana). Velvra and its tube are fictional.
- **AI assistance:** Built with Claude Code (Anthropic) as the AI coding tool, directed by the builder. Google Gemini runs inside the app.

## Running it locally

You need Node 22 and pnpm. **No account or environment variable is needed**: with none set, the demo works, AI findings say they are off, and team workspaces and email stay disabled.

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

[.env.example](.env.example) lists everything optional. `GEMINI_API_KEYS` accepts a JSON array, a JSON object of label to key (labels appear in logs; keys never do), or a list separated by commas, spaces, semicolons or newlines. Keys rotate round-robin; a 429 cools a key down, and a 401 or 403 disables it.

### Deploying with team workspaces

On Vercel, add a Neon database from the Storage tab, giving `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. Then set `SMTP_URL`, `EMAIL_FROM`, `CRON_SECRET` and `APP_ORIGIN` as in `.env.example`. Tables are created on first use, and `vercel.json` schedules the daily alert job. Hobby cron can fire late or twice; alerts are claimed before they are sent, and a failed send is retried the next day.

## Tests and evaluation

| Command | What it runs |
|---|---|
| `pnpm test` | Unit tests in Chromium (Vitest browser mode) |
| `pnpm build && pnpm e2e` | Playwright in Chromium against a production build, with axe on every screen. Needs Chromium: `pnpm exec playwright install chromium`, or set `CHROMIUM_PATH` |
| `pnpm test:team` | The team server against a throwaway local Postgres, set by `DATABASE_URL` |
| `pnpm eval` | Rule checks on the golden set per category; fails CI on a regression |
| `pnpm eval:ai` | Replays recorded AI answers. `--record` fills gaps through a deployment's own route, so no key is needed locally |
| `pnpm eval:visual` | 20 drawn creatives with known faults, with real OCR |
| `pnpm eval:people` | Scores against labels from people, in `golden/labels/`, and states what may be claimed |
| `pnpm eval:report` | Writes [docs/EVALUATION.md](docs/EVALUATION.md) from those results |
| `pnpm perf` | Long tasks and frame rate on the judge path, CPU slowed 4 times |

[docs/TESTING.md](docs/TESTING.md) says who tested what. The golden drafts and builder labels were written by the builder with AI assistance, so scores against them measure the engine against its own spec.

## More

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/ROADMAP.md](docs/ROADMAP.md) · [docs/CHANGES.md](docs/CHANGES.md) · [docs/BUILD_LOG.md](docs/BUILD_LOG.md)

## Built with

Next.js 16, React 19, Tailwind CSS 4, TypeScript (MIT / Apache-2.0) · Dexie and dexie-react-hooks (Apache-2.0) · zod (MIT) · pdfjs-dist (Apache-2.0) · mammoth (BSD-2-Clause) · tesseract.js and its English data (Apache-2.0) · culori (MIT) · diff-match-patch (Apache-2.0) · lucide-react (ISC) · GSAP and @gsap/react (GreenSock Standard License) · nodemailer (MIT-0) · pg (MIT) · Inter, Fraunces and JetBrains Mono (OFL-1.1) · Vitest, Playwright, axe-core (MIT / Apache-2.0 / MPL-2.0). Scaffolded with `create-next-app`. Hosted on Vercel. No UI kit or template.

Pictures on the landing page, cropped and resized, showing the world of assaying and not Velvra or its products: "2 Touchstones" by Mauro Cateb ([CC BY-SA 3.0](https://commons.wikimedia.org/wiki/File:2_Touchstones.JPG)); "1917-04-21 IBÉRICA 01", author unknown ([public domain](https://commons.wikimedia.org/wiki/File:1917-04-21_IB%C3%89RICA_01.jpg)); "Making a silver chain, 18 (25)" by W.carter ([CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Making_a_silver_chain,_18_(25).jpg)). Those licences, not MIT, cover these three files in `public/landing/world/`.

MIT licensed, apart from those pictures: see [LICENSE](LICENSE).

## Team

**24K MAGIC**: Shlok Sudhakar Shinde (solo), 3rd year Computer Science and Engineering, Sardar Patel Institute of Technology (SPIT), Mumbai. GitHub [@shlok-shinde](https://github.com/shlok-shinde).
