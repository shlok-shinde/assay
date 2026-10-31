# Roadmap

Dates assume one builder after the event. Nothing here comes from user research yet, because no outside person has tested Assay ([TESTING.md](TESTING.md)); the first milestone is there to change that, and what it finds reorders the rest.

## November 2026: find out what people actually do

- Sessions with three to five people who review brand content, with no walkthrough. Rewrite what they stumble on before building anything below.
- Finish the human labels on the golden set if the event ended short of them, and label the creatives too.
- Fix the false positives on record: "best way" read as a superlative (`CLAIM-03`), and contrast on small thin logos (`A11Y-01`, `docs/eval-visual-first-run.json`).
- Measure the −50% review-time target from Round 1 in a timed comparison against the PDF brand book.

## December 2026 to January 2027: a real brand, and where people already work

- Pilot with one real brand, with its own book, on a team workspace.
- Facts and terms from book import, which is rules only today.
- Scanned PDFs with OCR, and logo matching against an uploaded logo file, so a logo that is a picture no longer needs a marked box.
- Photographic creatives in the visual evaluation, which so far uses drawn ones.
- A JSON check API, then a Google Docs add-on and a Figma plugin, in whichever order the pilot asks for.

## February to April 2027: more languages and formats

- Hindi, Marathi and Hinglish checks. Today a non-English draft only gets a notice that the rules don't cover it.
- Slide decks, email HTML, landing pages with live accessibility checks.
- Optional regulatory starter packs from ASCI guidelines, always reviewed by the organisation's own compliance team.

## Later

- Video and audio, from transcripts and sampled frames.
- SSO and agency portals.
- Live updates in place of polling, if team use shows that it matters.

## Known limits today

- The team server enforces the workflow, not the check results: rule checks run in the browser, so a tampered browser could under-report findings.
- Fix acceptance rates live in each workspace, so there is no rate across workspaces.
- A tab that dies in the instant after a write can lose that write's sync note.
- Free tiers: Gemini quota, Neon's 0.5 GB and 100 compute hours, Gmail's daily limit, and Hobby cron running daily and possibly late.
