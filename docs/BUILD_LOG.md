# Build log

Round 2 of CodeStar 30. The build window is Mon 26 Oct 2026 10:00 IST to Wed 28 Oct 2026 10:00 IST.
Nothing in this repository was written before the window opened. Times below are IST and match the commit history.

| Time (IST) | What happened |
|---|---|
| 26 Oct 16:51 | Scaffolded with `create-next-app@16.4.3` (TypeScript, Tailwind v4, App Router). |
| 26 Oct 16:53 | Added dependencies: zod, Dexie, pdfjs-dist, mammoth, tesseract.js, diff-match-patch, culori, lucide-react, @google/genai, Vitest browser mode, Playwright, axe. |
| 26 Oct 17:08 | Domain types, the fictional Velvra Brand Kit (rulebook v3.2, Claim Ledger, terms, palette), and the TypeScript check engine: rule checks, claim matching (BM25 + code comparison of numbers, periods, wording and validity), merge and rank, evidence verifier, redaction, fixes with intent check, SHA-256 Hallmarks, Guideline Health scoring, visual checks (k-means, ΔE2000, OCR contrast). |
| 26 Oct 17:14 | Server AI layer: Gemini key pool (array, object or list; round-robin; 429 cooldown, daily-quota cooldown to Pacific midnight, invalid-key disable), REST client with model fallback and a 20 s budget, typed tasks validated with zod, server-side redaction, per-IP rate limit, `/api/ai` and `/api/status`. Six sample drafts. 64 unit tests passing in Chromium (Vitest browser mode). |
| 26 Oct 17:21 | Generated the sample files (creative PNG, product-page DOCX, 2-page brochure PDF, brand-book update PDF) with `scripts/make_samples.py`. Visual check verified in Chromium with real OCR: the creative's headline reads 1.7:1 contrast, the pink is ΔE 21 from Rose Clay, alt text is missing and the hand-marked logo is 96 px, so the Round 1 worked example reproduces all 8 findings. |
| 26 Oct 17:33 | App UI (design direction: tasteskill app sheet "framed sheet", gold-tinted frame, rounded sheets and pill controls): app shell with role switcher, AI status and judge-path card; intake with samples, uploads, Intent Card and hand-marked logo box; the submission screen with annotated evidence, cited finding cards, fix previews with intent check, review actions, versions and diff, comments, activity and Hallmark; review queue; Guideline Health; Brand Kit admin with import and publishing. Turned off Cache Components because the workspace is client-side. |
| 26 Oct 17:44 | Landing page with a live checker that runs the real rule engine as you type, the six-step judge path, and real interface fragments. Design inspector: 0 FAIL at 1440, 768 and 390 px (emoji allowed because they are the draft being checked). Walked the full judge path in the built-in browser: sample → 8 findings → 3 fixes applied with intent kept → submit → Compliance approves 2 claims → Reviewer approves → Hallmark #1 verifies. |
