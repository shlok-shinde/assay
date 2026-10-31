# Architecture and main technical decisions

## Shape of the system

Assay is one Next.js 16 app deployed on Vercel. The demo and browser-only brands run almost entirely in the browser:

- **Intake** reads files locally: `mammoth` for DOCX, `pdfjs-dist` for text-based PDF (keeping a page map of character offsets), and the canvas for PNG/JPG.
- **The check engine** (`src/engine`) is plain TypeScript with no UI or storage code, so the same code runs in the browser, in the Vitest browser tests, and in the Node eval script.
- **The workspace** is IndexedDB through Dexie (`src/store`), one database per brand. Velvra keeps the database name it had in Round 2 and is seeded on first load, with export, import and Reset demo. In a browser-only workspace, a role switcher stands in for accounts.
- **Route handlers** on the server: `POST /api/ai` (typed AI tasks only), `GET /api/status`, `/api/label`, `/api/demo/fact-alert`, and, only with a database, `/api/team/*` and `/api/cron/fact-alerts`. Everything that needs Postgres or email connects lazily and reports itself off when its variables are absent.

## The check pipeline (`src/engine/pipeline.ts`)

1. **Parse** into paragraphs, sentences and clauses with character offsets (`text.ts`). PDF page spans map every finding to its page.
2. **Rule checks** (`rules.ts`): rule phrases and replacements live in the rule data, so a Brand Admin's edit changes the next check with no code change. Lexicon terms, hype and fear phrases, instant-results promises, guarantees, medical claims, link text, channel limits (emoji, exclamation marks, capitals), CamelCase hashtags with a small segmenter for the fix, Flesch readability, and the SPF disclaimer for email and website.
3. **Claims** (`claims.ts`, `quantities.ts`, `bm25.ts`): claims are found by fact triggers ("no white cast" → F-115), by quantities with units (%, ₹, ml, SPF, n, durations), and by study wording. Each quantity is matched to facts that carry the same kind of quantity, ranked by BM25 over the fact's statement, keywords and triggers with synonym expansion and with brand names removed. Then **code** compares: durations are normalised (7 days against 4 weeks), values must match, "clinically" needs a clinical fact, and expired facts make a claim outdated. Fixes either swap the wrong figure (offers, prices, specs) or use the fact's approved wording plus its footnote (studies and panels).
4. **AI judgment** (optional): only judgment rules for the current channel are sent, with their do and don't examples and the Intent Card. Paragraphs are redacted first and cached by a hash of the paragraph, channel, audience, intent and judgment rules, so a re-check sends only paragraphs that changed. Ambiguous claim-to-fact matches (two BM25 candidates within 30%) ride along in the same call. A short draft costs one call. A long one goes in batches under the route's limit, at most three a pass, and the banner says how many paragraphs the AI read; finished paragraphs are cached, so running it again continues. When a rulebook has more than 20 judgment rules, BM25 picks the 20 closest to the draft. Names of known people are redacted as well as contact details and secrets.
5. **Evidence verifier** (`verifier.ts`): every AI finding must cite an active judgment rule that applies to the channel and quote text that is at its offsets, or appears exactly once elsewhere (then it is relocated and counted). Anything else is dropped, and the UI says how many. Confidence under 0.5 becomes a low-severity suggestion.
6. **Merge and rank** (`merge.ts`): overlapping findings collapse into the most serious one, which lists the others as related rules ("CLAIM-03, also TERM-03"). An AI finding that agrees with a rule-check finding adds its confidence to it.
7. **Visual checks** (`visual.ts`): k-means over sampled pixels gives the dominant colours, compared with the palette by CIEDE2000 (`culori`). tesseract.js reads a contrast-stretched greyscale copy of the creative to find text lines; contrast is then measured on the original pixels with a two-cluster split per line, grouping adjacent failing lines into one finding. Alt text and logo size and clear space are checked too. The logo comes from a box marked by hand, or else the brand's wordmark: OCR over the whole image misses a small one, so the top and bottom fifths are stretched and enlarged on their own and read in OCR's mode for scattered words. A logo that is a picture has no text to find, and needs the box. OCR has a 60-second limit; a failure drops the worker, isn't remembered, and is said on the check.

## Fixes, versions and the intent check (`fix.ts`)

Fixes are staged by Accept or Edit. `planFixes` sorts them by sentence into those that compose and those that truly collide. Composing fixes apply together, from the end of the text backwards, so offsets stay valid, and get one combined intent check. A collision opens a resolver, defaulting to the more serious rule: either fix, a deterministic merge, an on-demand AI merge, or the person's own words. `validateMerge` refuses a merge that adds a finding or a number, or changes approved wording. A fix that loses keeps its decision and carries to the next version.

Collisions are rare in practice, because `merge.ts` collapses overlapping findings before anyone sees them.

Every fix carries a stored intent verdict: `kept`, `review`, `lost` or `unchecked`, the last when the Intent Card is blank, so nothing claims to have been checked against nothing. Terms are compared at check time; `intentCheckBatch` adds the AI's reading after the AI pass, cached, and it never holds anything up. Accepting a `lost` fix needs a reason, sealed into the Hallmark. Hand edits get the same check.

An append-only `events` table records each fix offered, accepted, edited, dismissed, contested or undone. `acceptanceByRule` counts accepted or lightly edited (30% or less changed) over decided, with the last event on a finding winning. Seeded history is excluded, and so are events from automated browsers.

## Review and Hallmarks

Submit unlocks when no high-severity finding is open and no accepted fix is waiting to be applied. All claim findings, including claims fixed in earlier versions, go to Compliance. The Reviewer approves only once Compliance has decided every claim. Approval writes a **Hallmark** (`hallmark.ts`): SHA-256 over canonical JSON of the content hash (text plus the creative's hash and alt text), the rulebook version and its hash, every finding with its outcome and reason, the approvals, the AI models, call and redaction counts, and the previous Hallmark's hash. Verify recomputes all three: the content, the record and the chain.

## Brand Kit and rulebook versions

The Brand Kit is a working draft. Publishing snapshots it as rulebook v3.3, v3.4 and so on, with its own hash; checks use the version that was current when the draft was created, so old Hallmarks keep their version. Brand-book import reads PDF or DOCX pages, asks the AI for candidate rules with page and quote (keeping only candidates whose quote really is on that page), or falls back to a heuristic (sentences with must, never, always, avoid, don't). A whole book goes in batches, and pages the AI doesn't reach or fails on still get the heuristic, so none is skipped silently. Each rule keeps its quote, and a PDF is kept, so its citation opens at those words. Candidates stay inactive until approved.

`publishClarification` patches one rule on the latest published snapshot, so pending imports can't block it or ride along. `rollbackRulebook` publishes the old content as a new version, and moves back in the Kit draft only what the undone version changed.

## The brand book (`src/seed/velvra-book.json`)

One JSON file holds the fictional book's pages, paragraph IDs and a citation map from rule and fact IDs to paragraphs. `scripts/make_book.py` renders it to a PDF, and a test reads the PDF back to prove that every paragraph sits on the page it claims. A separate map means workspaces seeded in Round 2 need no migration. The viewer is pdf.js with its text layer, matching the normalised quote and drawing a box over it.

## Keeping old browsers working

Schema versions only add tables, with no unique indexes and no upgrade function, so an existing duplicate can't abort an upgrade. Creatives moved out of version rows into `blobs`, keyed by the same sha256 the Hallmarks seal, in a job that runs after open, is safe to interrupt, and keeps old Hallmarks verifying. An end-to-end test opens a database captured from Round 2. Web Locks stop two tabs writing the same version or Hallmark number.

## Team workspaces (`src/server/team`, `src/store/team.ts`, `src/store/capture.ts`)

Optional and additive: the demo never loads this code. Each workspace is another Dexie database in the browser.

- **Capture:** Dexie middleware notes every local write in `syncRows`, so `actions.ts` doesn't need to know about teams. It writes the note just after the transaction commits, because a store transaction's scope doesn't include that table; a tab dying in that moment can lose one note.
- **Sync:** clients pull by cursor every few seconds while a tab is in view, and push with the version they last saw. It is compare-and-swap, never last-write-wins, so a stale client can't overwrite an approval. The server's row replaces the client's on every answer, because the server fills in names and hashes. `aiLog`, `aiCache` and `meta` stay in each browser.
- **Enforcement (`src/lib/team-rules.ts`):** rule checks run in the browser, so a tampered browser could lie about what a draft contains. What it can't get past: who may move a draft or finding (the same `policy.ts` the store uses), who a record says acted (overwritten from the session), a finding's rule and severity (immutable, so nobody downgrades past the high-severity lock), rulebook hashes (recomputed) and approved records (frozen).
- **Hallmarks:** only `POST /api/team/hallmark` writes them. It takes a transaction-scoped lock, refuses a stale `prevHash` with a 409 so the client catches up and seals again, recomputes the hash and assigns the number.
- **Sign-in:** single-use links by email, stored only as hashes. The link's page POSTs on a button click, so a mail scanner can't use it up. Sessions are opaque rows in Postgres, checked on every request, so revoking and removing a member take effect at once. Limits live in Postgres, because each serverless instance has its own memory. `DATABASE_URL` is pooled, so only row locks and transaction-scoped advisory locks are used; the schema is created over `DATABASE_URL_UNPOOLED`.
- **Files:** 3 MB chunks, because Vercel's 4.5 MB limit covers responses too.
- **Roles:** set by a Brand Admin's invitation. An admin may take any desk.

## AI layer (`src/server/ai`)

- **Typed tasks only**: `judge`, `matchFacts`, `intentCheck`, `intentCheckBatch`, `mergeFixes`, `draftIntent`, `draftRules`, `clarifyRule`. Each has a zod input and output schema; the output schema is also sent to Gemini as a JSON schema. The route is not a prompt proxy.
- **Limits**: 8,000 characters of text per call, an in-memory per-IP rate limit, content never logged.
- **Key pool** (`keys.ts`): `GEMINI_API_KEYS` as a JSON array, a JSON object of label to key, or a delimited list, plus `GEMINI_API_KEY` and `GEMINI_API_KEY_1…9`; trimmed and de-duplicated. Each call starts at the next key in turn. A 429 cools that key down for Gemini's `retryDelay` (60 s by default) or until Pacific midnight for a daily quota; 401/403 disables it; 5xx and timeouts move on. Every available key is tried on the primary model, then the next model in the chain, with 5 seconds per attempt inside a 14-second budget.
- **Degrading**: no key, a rate limit, a timeout or an error all fall back to rule checks with a banner that says why.

## Changes from the plans

See [CHANGES.md](CHANGES.md).
