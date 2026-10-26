# Build log

Round 2 of CodeStar 30. The build window is Mon 26 Oct 2026 10:00 IST to Wed 28 Oct 2026 10:00 IST.
Nothing in this repository was written before the window opened. Times below are IST and match the commit history.

| Time (IST) | What happened |
|---|---|
| 26 Oct 16:51 | Scaffolded with `create-next-app@16.4.3` (TypeScript, Tailwind v4, App Router). |
| 26 Oct 16:53 | Added dependencies: zod, Dexie, pdfjs-dist, mammoth, tesseract.js, diff-match-patch, culori, lucide-react, @google/genai, Vitest browser mode, Playwright, axe. |
| 26 Oct 17:08 | Domain types, the fictional Velvra Brand Kit (rulebook v3.2, Claim Ledger, terms, palette), and the TypeScript check engine: rule checks, claim matching (BM25 + code comparison of numbers, periods, wording and validity), merge and rank, evidence verifier, redaction, fixes with intent check, SHA-256 Hallmarks, Guideline Health scoring, visual checks (k-means, ΔE2000, OCR contrast). |
| 26 Oct 17:14 | Server AI layer: Gemini key pool (array, object or list; round-robin; 429 cooldown, daily-quota cooldown to Pacific midnight, invalid-key disable), REST client with model fallback and a 20 s budget, typed tasks validated with zod, server-side redaction, per-IP rate limit, `/api/ai` and `/api/status`. Six sample drafts. 64 unit tests passing in Chromium (Vitest browser mode). |
