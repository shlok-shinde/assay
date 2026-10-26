# Architecture and main technical decisions

## Shape of the system

Assay is one Next.js 16 app deployed on Vercel. Almost everything runs in the browser:

- **Intake** reads files locally: `mammoth` for DOCX, `pdfjs-dist` for text-based PDF (keeping a page map of character offsets), and the canvas for PNG/JPG.
- **The check engine** (`src/engine`) is plain TypeScript with no UI or storage code, so the same code runs in the browser, in the Vitest browser tests, and in the Node eval script.
- **The workspace** is IndexedDB through Dexie (`src/store`): one Velvra demo workspace per browser, seeded on first load, with export, import and Reset demo. A role switcher stands in for accounts.
- **Two route handlers** run on the server: `POST /api/ai` (typed AI tasks only) and `GET /api/status`.

## The check pipeline (`src/engine/pipeline.ts`)

1. **Parse** into paragraphs, sentences and clauses with character offsets (`text.ts`). PDF page spans map every finding to its page.
2. **Rule checks** (`rules.ts`): rule phrases and replacements live in the rule data, so a Brand Admin's edit changes the next check with no code change. Lexicon terms, hype and fear phrases, instant-results promises, guarantees, medical claims, link text, channel limits (emoji, exclamation marks, capitals), CamelCase hashtags with a small segmenter for the fix, Flesch readability, and the SPF disclaimer for email and website.
3. **Claims** (`claims.ts`, `quantities.ts`, `bm25.ts`): claims are found by fact triggers ("no white cast" → F-115), by quantities with units (%, ₹, ml, SPF, n, durations), and by study wording. Each quantity is matched to facts that carry the same kind of quantity, ranked by BM25 over the fact's statement, keywords and triggers with synonym expansion and with brand names removed. Then **code** compares: durations are normalised (7 days against 4 weeks), values must match, "clinically" needs a clinical fact, and expired facts make a claim outdated. Fixes either swap the wrong figure (offers, prices, specs) or use the fact's approved wording plus its footnote (studies and panels).
4. **AI judgment** (optional): only judgment rules for the current channel are sent, with their do and don't examples and the Intent Card. Paragraphs are redacted first and cached by a hash of the paragraph, channel, audience, intent and judgment rules, so a re-check sends only paragraphs that changed. Ambiguous claim-to-fact matches (two BM25 candidates within 30%) ride along in the same call, so a check costs at most one AI call.
5. **Evidence verifier** (`verifier.ts`): every AI finding must cite an active judgment rule that applies to the channel and quote text that is at its offsets, or appears exactly once elsewhere (then it is relocated and counted). Anything else is dropped, and the UI says how many. Confidence under 0.5 becomes a low-severity suggestion.
6. **Merge and rank** (`merge.ts`): overlapping findings collapse into the most serious one, which lists the others as related rules ("CLAIM-03, also TERM-03"). An AI finding that agrees with a rule-check finding adds its confidence to it.
7. **Visual checks** (`visual.ts`): k-means over sampled pixels gives the dominant colours, compared with the palette by CIEDE2000 (`culori`). tesseract.js reads a contrast-stretched greyscale copy of the creative to find text lines; contrast is then measured on the original pixels with a two-cluster split per line, grouping adjacent failing lines into one finding. Alt text and the hand-marked logo box are checked too. Logo detection is Round 3.

## Fixes, versions and the intent check (`fix.ts`)

Fixes are staged by Accept or Edit and applied together from the end of the text backwards, so offsets stay valid; overlapping fixes are refused and reported. Footnotes are appended once. The intent check compares the key-message and call-to-action terms before and after ("kept", "strengthened" or "lost"), and the AI's `intentCheck` adds a second opinion when available. Each apply creates a version, diffed with diff-match-patch, and the next check carries decisions (dismissed, contested, with Compliance) over to the same issue.

## Review and Hallmarks

Submit unlocks when no high-severity finding is open and no accepted fix is waiting to be applied. All claim findings, including claims fixed in earlier versions, go to Compliance. The Reviewer approves only once Compliance has decided every claim. Approval writes a **Hallmark** (`hallmark.ts`): SHA-256 over canonical JSON of the content hash (text plus the creative's hash and alt text), the rulebook version and its hash, every finding with its outcome and reason, the approvals, the AI models, call and redaction counts, and the previous Hallmark's hash. Verify recomputes all three: the content, the record and the chain.

## Brand Kit and rulebook versions

The Brand Kit is a working draft. Publishing snapshots it as rulebook v3.3, v3.4 and so on, with its own hash; checks use the version that was current when the draft was created, so old Hallmarks keep their version. Brand-book import reads PDF or DOCX pages, asks the AI for candidate rules with page and quote (keeping only candidates whose quote really is on that page), or falls back to a heuristic (sentences with must, never, always, avoid, don't). Candidates stay inactive until approved.

## AI layer (`src/server/ai`)

- **Typed tasks only**: `judge`, `matchFacts`, `intentCheck`, `draftIntent`, `draftRules`, `clarifyRule`. Each has a zod input and output schema; the output schema is also sent to Gemini as a JSON schema. The route is not a prompt proxy.
- **Limits**: 8,000 characters of text per call, an in-memory per-IP rate limit, content never logged.
- **Key pool** (`keys.ts`): `GEMINI_API_KEYS` as a JSON array, a JSON object of label to key, or a delimited list, plus `GEMINI_API_KEY` and `GEMINI_API_KEY_1…9`; trimmed and de-duplicated. Each call starts at the next key in turn. A 429 cools that key down for Gemini's `retryDelay` (60 s by default) or until Pacific midnight for a daily quota; 401/403 disables it; 5xx and timeouts move on. Every available key is tried on the primary model, then the next model in the chain, inside a 20-second budget.
- **Degrading**: no key, a rate limit, a timeout or an error all fall back to rule checks with a banner that says why.

## Changes from the Round 1 plan

| Round 1 plan | Round 2 build | Why |
|---|---|---|
| Next.js, TS, Tailwind, shadcn/ui, TipTap | Next.js 16, TS, Tailwind v4; a custom offset-anchored annotated view instead of TipTap; no component kit | Fewer moving parts; findings are anchored to offsets anyway |
| FastAPI + Python engine on Render | A TypeScript engine in the browser; route handlers only for AI | One deploy, no cold start, drafts never leave the browser except redacted AI calls |
| Supabase (Postgres, auth, storage) | IndexedDB through Dexie, export and import, a role switcher | A judge can use it at once with no sign-up; real accounts move to Round 3 |
| A hosted LLM API for judgment | A provider adapter with Gemini (the participant's free keys) and a rules-only mode | The participant chose Gemini; the app must also work with no key |
| bge-small embeddings + full-text search | BM25 over the Claim Ledger, with code comparisons | No 30 MB model download; numbers and dates are compared in code either way |
| PyMuPDF, python-docx, OpenCV, Tesseract | pdfjs-dist, mammoth, canvas k-means with CIEDE2000, tesseract.js, all in the browser | The same measurable checks with no server |
| pytest, Playwright, GitHub Actions | Vitest browser mode and Playwright, both in Chromium; axe; a golden-set eval; GitHub Actions | The participant asked for Chromium for unit and E2E tests |
| Logo size detection | A hand-marked logo box; detection is Round 3 | Honest scope for the build window |
| `judge`, `matchFacts`, `intentCheck`, `draftRules` tasks | Those four plus `draftIntent` and `clarifyRule` | The Intent Card and Guideline Health clarifications needed their own typed tasks |
| Next.js defaults | Cache Components turned off | The workspace is client-side, so server caching adds nothing |
