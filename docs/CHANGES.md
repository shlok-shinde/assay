# What changed from the plans

Round 1 was a plan and Round 2 a working first version. This lists everything that came out differently, and why. Things dropped are listed as dropped.

## From Round 1 to now

| Round 1 plan | What exists | Why |
|---|---|---|
| FastAPI and Python engine on Render | TypeScript engine in the browser; Next.js routes for AI, email, labels and team sync | One deploy, no cold start, and drafts stay on the device unless a team chooses a server |
| Supabase for Postgres, auth and storage | IndexedDB per brand for the demo and local brands; Neon Postgres for team workspaces, with Assay's own email sign-in | Judges use the demo with no sign-up, and the demo depends on no service |
| A hosted LLM with Haiku for extraction | Google Gemini behind a provider adapter, with a rules-only mode | The participant's free Gemini keys; the app must work with none |
| bge-small embeddings with full-text search | BM25 with synonyms, then code comparison | No model download; numbers and dates are compared in code anyway |
| PyMuPDF, python-docx, OpenCV, Tesseract | pdf.js, mammoth, canvas k-means with ΔE2000, tesseract.js | The same measurable checks with no server |
| Logo detection by feature matching | Reads the brand's wordmark with OCR on enlarged top and bottom strips, or a box marked by hand | Feature matching needs a logo image the kit doesn't hold. A logo that is a picture still needs the hand-marked box |
| TipTap editor, shadcn/ui | A custom annotated view with findings anchored to text offsets; custom primitives | Fewer moving parts |
| Four AI tasks | Eight typed tasks, each validated with zod on both sides | Intent Cards, clarifications, intent on every fix and merging fixes needed their own |
| pytest and Playwright | Vitest in Chromium, Playwright, axe, a golden-set gate in CI, a team-server test on real Postgres | One language, and the tests run in the same engine as the app |
| Demo video | **Dropped.** The event requires none | Time went to the product |
| Realtime comments | **Dropped.** Team workspaces sync every few seconds while a tab is in view | Polling needs no realtime service on the free tier |
| Row-level access per organisation | One logical workspace per team on the server, with every row checked against the workflow rules | Clearer to reason about than row policies, and the same rules run in the browser and on the server |
| User testing sessions | See `docs/TESTING.md` for exactly what happened | Few outside people were available |

## From Round 2 to now

| Round 2 said | What exists | Note |
|---|---|---|
| Accounts move to Round 3 | Team workspaces with email sign-in, invitations and server-enforced roles | The demo still has no sign-up |
| Basic brand-book import | The whole book, in batches, keeping each quote and the PDF | Rules only. Facts and terms are entered by hand |
| One brand, Velvra | Any number of brands, each its own browser database, with a setup screen | Velvra's workspace from Round 2 opens untouched; an end-to-end test proves it on a captured Round 2 database |
| 64-draft golden set | 104 drafts and 20 drawn creatives | The first run on the 104 stays on record in `docs/eval-first-run-104.json` |

## The order things would have been cut

Round 1 agreed this order: logo detection, brand-book PDF import, report export, realtime comments. Round 3 used a different one, because the three named improvements came first and team workspaces were the newest and riskiest thing in the plan: team workspaces, AI merge of fixes, logo detection, the setup wizard, design on About and Hallmarks, then human labels on creatives.
