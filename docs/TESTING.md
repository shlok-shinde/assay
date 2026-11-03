# Testing

Everything here says who or what did the testing. Automated runs are machines. AI-assisted reviews are an AI tool looking at the product at the builder's request. Neither is a person using it.

## People

**Testing by people other than the builder:** one session, recorded on 3 Nov 2026. Each is written here by the builder from what actually happened: who (by role, not name, unless they agree), how long it took, where they got stuck, and their own words.

**Session 1.** A social media executive at a skincare brand (BCom, two years in the job), a friend of the builder, used the live site. The builder reports that it took him about 2 minutes to understand what the tool is for and about 4.5 minutes to work out how to use it, and that the approval process confused him a little. His answers, as the builder noted them:

- *What he thought it does:* "it's basically checking whether our marketing content follows the brand guidelines. Like a smarter version of checking the brand book manually." It catches things the brand mustn't say, wrong product claims and colours, "and apparently it also handles approvals."
- *What confused him:* the Intent Card ("Why do I need to fill in the goal, key message and CTA? Can't I just paste the caption and check it?"); the roles ("I'm just a marketing person. Who exactly is supposed to approve this?"); the Hallmark ("Is that just a fancy name for an approval stamp?"); and he wouldn't immediately know what a Claim Ledger is.
- *Would he use it instead of the PDF brand book:* "Yeah, I'd use this to check posts. Searching through a PDF every time is annoying." But he would keep the PDF: "What if the tool misses something?"

One person, who knows the builder, is a first look, not a measurement.

What changed because of it, the same day:

- **The Intent Card is optional.** Run check works without it, and says that fixes then aren't checked against the message. A card the creator hasn't confirmed is not used, so a guess drafted from the copy never stands in for what they meant.
- **Who acts next is one click away.** When a draft's next move belongs to another role, the line under its title offers "Act as Compliance" (or Reviewer, or Creator). In a team workspace whose roles are set by its Brand Admin, it isn't offered.
- **The roles are explained where they are chosen.** "Viewing as" opens what each role does in a real team.
- **The Hallmark and Claim Ledger definitions open with the everyday thing they are:** an approval stamp that can't be quietly changed later, and the list of product facts the brand may state.

**The −50% review-time target** from Round 1, a timed comparison against the PDF brand book, has not been measured.

**The builder's own testing.** The builder walked the judge path on the live site in a private window as Creator, Compliance and Reviewer, and tried uploads of their own.

On 1 Nov 2026 the builder also tried team workspaces on the live site, and reports that the email arrived, that they joined through it, and that a second email address joined the same workspace. That is the builder using two addresses, not a second person's test unless this file says otherwise.

**A correction.** The evaluation write-up of 27 Oct said this hand run "found four problems". That overstated it. Those problems were first found in an AI-assisted run of the same path; the builder reports seeing them too when testing by hand. The four, all fixed on 27 Oct:

- a draft could be approved and hallmarked with findings still open, and the status line called them resolved;
- the AI check took over 20 s and timed out on the re-check;
- the term check and the AI intent check gave opposite verdicts on the same line;
- a sample once hung while loading.

The builder also sent the demo fact-expiry alert from Guideline Health on the live site, and reports receiving the email. The daily team digest reaching an owner has not been separately confirmed.

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

## On production

On 1 Nov 2026 the judge path and the Round 2 upgrade tests ran against the live site with real Gemini (`E2E_BASE_URL=<production> E2E_LIVE=1`): 19 passed, and 1 was skipped because a real deployment can't be made to rate-limit on request. The first such run found a real bug: a stalled `/api/status` request held the rule checks on their spinner. It now has a five-second limit and a test.

## AI-assisted review

During the build, an AI tool checked screenshots of each screen against a design rubric and Nielsen's heuristics, and an automated inspector measured the pages at 1440, 768 and 390 px. That is a review by a tool, not a usability result.

## What real evidence would look like

More sessions like the one above, with people who don't know the builder. Short sessions with people who review brand content (a brand manager, an agency writer, a compliance reviewer), each given the task and no walkthrough, with time to first decision, where they got stuck, and their own words.
