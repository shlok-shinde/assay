# Testing

Everything here says who or what did the testing. Automated runs are machines. AI-assisted reviews are an AI tool looking at the product at the builder's request. Neither is a person using it.

## People

**Testing by people other than the builder:** none is recorded yet. If that changes, it is written here by the builder from what actually happened: who (by role, not name, unless they agree), what they were asked to do, how long it took, where they got stuck, and their own words.

**The −50% review-time target** from Round 1, a timed comparison against the PDF brand book, has not been measured.

**The builder's own testing.** The builder walked the judge path on the live site in a private window as Creator, Compliance and Reviewer, and tried uploads of their own.

**A correction.** The evaluation write-up of 27 Oct said this hand run "found four problems". That overstated it. Those problems were first found in an AI-assisted run of the same path; the builder reports seeing them too when testing by hand. The four, all fixed on 27 Oct:

- a draft could be approved and hallmarked with findings still open, and the status line called them resolved;
- the AI check took over 20 s and timed out on the re-check;
- the term check and the AI intent check gave opposite verdicts on the same line;
- a sample once hung while loading.

## How to run the automated tests

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm eval && pnpm build && pnpm e2e
```

```bash
DATABASE_URL=postgres://postgres:test@localhost:5432/assay_test pnpm test:team
```

`pnpm test:team` drops its own tables, so it refuses anything but a local database. `pnpm e2e` runs Playwright against a production build with the AI route stubbed. With `E2E_BASE_URL` set it runs against a deployment, and `E2E_LIVE=1` turns the stubs off. Chromium is at `/usr/bin/chromium` locally, or wherever `CHROMIUM_PATH` says.

## What the automated tests cover

- **Unit (Vitest, in Chromium):** phrase matching, quantities, readability, BM25, the Claim Ledger, fix planning and merging, intent checks, the evidence verifier, redaction, Hallmark chains, Guideline Health, the workflow rules, double clicks and two-tab races, damaged workspace files, the brand book's page positions.
- **End to end (Playwright, in Chromium):** the judge path, uploads, opening a citation at its paragraph, fixes that collide, Send back and Contest, Guideline Health, the inbox, the labelling page, brands, opening a captured Round 2 workspace, phone layouts, and axe on every screen.
- **Team server (real Postgres):** links used once under a race, revoked sessions, stale writes, workflow rules enforced on the server, eight approvals at once making one unbroken chain.
- **Accuracy:** `docs/EVALUATION.md`.

## AI-assisted review

During the build, an AI tool checked screenshots of each screen against a design rubric and Nielsen's heuristics, and an automated inspector measured the pages at 1440, 768 and 390 px. That is a review by a tool, not a usability result.

## What real evidence would look like

Short sessions with people who review brand content (a brand manager, an agency writer, a compliance reviewer), each given the task and no walkthrough, with time to first decision, where they got stuck, and their own words.
