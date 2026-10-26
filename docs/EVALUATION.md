# Evaluation and testing evidence

Everything here is labelled for what it is. **No real users have tested Assay yet**, and nothing below should be read as user feedback.

## 1. Golden set (rule checks, no AI)

`pnpm eval` runs the rule checks over 64 fictional Velvra drafts in `golden/drafts.ts` (16 of them clean) and scores each draft at the level of rule IDs: a finding counts if its rule, or a related rule merged into it, matches a label.

**How the labels were made:** written by the builder with AI assistance, from the rule texts, before running the engine on each draft. They measure the engine against its own specification, not real-world accuracy. Judgment-only rules (VOICE-01, MSG-01) are not in the set because they need the AI.

Result on 26 Oct 2026 (`docs/eval-results.json`):

| Category | True pos. | False pos. | False neg. | Precision | Recall |
|---|---:|---:|---:|---:|---:|
| Accessibility | 5 | 0 | 1 | 1.000 | 0.833 |
| Claim | 16 | 1 | 0 | 0.941 | 1.000 |
| Legal | 2 | 0 | 0 | 1.000 | 1.000 |
| Message | 5 | 0 | 0 | 1.000 | 1.000 |
| Term | 10 | 0 | 0 | 1.000 | 1.000 |
| Tone | 10 | 0 | 0 | 1.000 | 1.000 |
| **Overall** | **48** | **1** | **1** | **0.980** | **0.980** |

What changed between the first and the recorded run, stated plainly:

- **One engine bug fixed.** On the first run, "Reapply your Daily Shield every 2 hours" was matched to fact F-121 (water-resistant for 40 minutes) only because both mention the product name, and flagged as a contradiction. Brand and product names no longer count as evidence when matching a claim to a fact.
- **One label corrected.** "Get fairer skin" was labelled clean, but TERM-05's banned list does include "fairer skin". The label was wrong, not the engine.

The two remaining errors are left in, not tuned away:

- *False positive:* "The best way to apply sunscreen…" is advice, but CLAIM-03 flags "best". Telling advice from a product superlative needs the AI or a phrase list; noted for Round 3.
- *False negative:* a 50-word, very dense sentence is not flagged for readability, because A11Y-03 only scores drafts of 60 words or more (shorter texts give unstable Flesch scores).

CI runs the eval and fails if any category drops below `golden/baseline.json`.

**Not yet measured:** the AI judgment categories (tone and messaging by Gemini). They will be measured once a Gemini key is configured on the deployment; until then this section covers rule checks only.

## 2. Unit tests: 65 in Chromium

`pnpm test` runs Vitest in browser mode on Chromium. It covers phrase matching and sentence splitting, quantity parsing and duration comparison, readability, BM25 and synonyms, the claim ledger (contradicted, outdated, supported, footnotes), the rule checks and the six samples, the evidence verifier with invented quotes, wrong offsets, unknown rules and code-checked rules, redaction and offset mapping, fixes with overlaps and footnotes, the intent check, WCAG contrast, CIEDE2000 and k-means, Hallmark hashing and tamper detection, Guideline Health scoring, the key pool (every input format, de-duplication, cooldown, daily quota, disable, round-robin, warnings with no secrets), the Gemini fallback order with a fake server, and the full visual check on the sample creative with real OCR.

## 3. End-to-end tests: 17 in Chromium

`pnpm e2e` runs Playwright on Chromium against a production build, with the AI route stubbed so the run is repeatable:

- the full judge path: sample → 8 findings → 3 fixes applied with the intent kept → submit → Compliance approves 2 claims → Reviewer approves → Hallmark #1 verifies → Guideline Health, then a reload that keeps the workspace;
- DOCX upload (fairness language, guarantee, medical claim), PDF upload (findings on page 2), image upload (alt text, contrast);
- brand-book import → approve and reject candidates → publish rulebook v3.3;
- an AI rate limit falling back to rule checks with a banner;
- Reset demo, and the phone layout's menu;
- **axe** on the landing page, Drafts, New draft, Review queue, Brand Kit, Guideline Health, Hallmarks, About and a checked draft, with **zero serious or critical violations** (WCAG 2.0, 2.1 and 2.2 A/AA rules).

The same suite is meant to run against the live deployment with `E2E_BASE_URL` set (and `E2E_LIVE=1` to turn the stubs off) once the deployment is up.

## 4. The AI path, tested against a mock Gemini server

There was no Gemini key on the machine during the build, so the server's AI path was tested against `scripts/mock-gemini.mjs`, a local stand-in that speaks Gemini's REST format. With two mock keys (`{"first":…,"second":…}`), one of which always answers 429, and the primary models answering 404:

- `/api/status` reported `aiConfigured: true, keyCount: 2` and never a key value;
- a judge call went key `first` (429, cooled down) → key `second` (404) → the next model in the chain, and succeeded; the server log shows only key labels and status codes;
- an email address in the draft reached the mock as `[EMAIL]`, and the returned offsets were mapped back to the original text;
- the full judge path (`E2E_BASE_URL=… E2E_LIVE=1`, no stubs) passed: the verifier dropped the mock's invented quote, kept its MSG-01 and VOICE-02 findings, the intent check went to the lite model chain, and the re-check after fixes sent only the changed paragraph while the rate-limited key was skipped.

This proves the plumbing, not the quality of Gemini's judgments, which will be checked on the live deployment once the key is added.

## 5. Timing (scripted, not human)

From the E2E judge-path test on a local production build (26 Oct 2026, one run), milliseconds from the start of the test:

| Step reached | ms |
|---|---:|
| Check finished (copy and creative, including OCR) | 4,518 |
| Findings read and asserted | 4,757 |
| Fixes applied and re-checked | 5,680 |
| Submitted | 5,952 |
| Approved, Hallmark verified | 6,788 |
| Guideline Health open | 6,989 |

These are machine timings. They show the app does not make a person wait, not how long a person takes.

## 6. Design and accessibility review (AI-assisted)

During the build, an AI-assisted review checked screenshots of every screen against an app-screen design rubric and Nielsen's ten heuristics, and an automated inspector measured the landing page at 1440, 768 and 390 px (0 failures after fixes). This is an AI-assisted heuristic review, not user testing. Changes made because of it:

- the phone menu button showed on desktop (CSS layering), fixed;
- highlighted evidence had accessible names that did not contain their visible text (WCAG 2.5.3), fixed with screen-reader text;
- empty states inside lists broke list semantics, fixed;
- Guideline Health's summary named dismissals for a rule that is mostly contested, fixed to name the main pushback;
- claims fixed before submission were invisible to Compliance, so they are now routed to Compliance and shown under "Fixed or decided in earlier versions";
- the landing page gained real interface fragments, entrance motion with a reduced-motion fallback, and a shorter second headline.

## 7. What would count as real evidence next

Short sessions with three to five people who review brand content (a brand manager, an agency writer, a compliance reviewer), each doing the judge path unassisted while thinking aloud, with time on task and a single ease rating per step. None of this has been done yet.
