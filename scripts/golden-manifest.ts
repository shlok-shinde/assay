// pnpm golden:manifest writes public/label/manifest.json, all that the /label page gives a labeller: opaque IDs,
// each draft's words and channel, and the brand's rules, ledger and limits in plain language. It never carries
// the builder's labels, notes, code patterns or draft IDs such as claim-07, any of which would give away the answer.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { GOLDEN } from "../golden/drafts";
import { CHANNEL_LIMITS, VELVRA_KIT } from "../src/seed/velvra";

const opaque = (id: string) => createHash("sha256").update(`assay-golden:${id}`).digest("hex").slice(0, 12);
const rank = (id: string) => createHash("sha256").update(`order:${id}`).digest("hex");

// The two practice items sit outside the golden set, and their answers are shown to the labeller.
const PRACTICE = [
  { text: "OMG our sunblock is insane!!!", channel: "instagram", answer: ["VOICE-02", "TERM-04"], why: "“OMG” and “insane” are hype, the exclamation marks are over the limit, and the product should be called Daily Shield SPF 50." },
  { text: "Daily Shield SPF 50 sits light on skin, so it is easy to wear every morning.", channel: "instagram", answer: [], why: "This follows every rule, so no boxes are ticked. Clean drafts are as useful to label as broken ones." },
];

const manifest = {
  note: "Fictional brand. Tick each rule you think the draft breaks, and tick nothing if it breaks none.",
  rules: VELVRA_KIT.rules.filter((r) => r.active && !r.pending && r.modes[0] !== "visual" && r.modes[0] !== "manual" && !["A11Y-01", "A11Y-04", "VIS-01", "VIS-03"].includes(r.id)).map((r) => ({
    id: r.id,
    title: r.title,
    text: r.text,
    category: r.category,
    channels: r.channels,
    yes: r.dos[0],
    no: r.donts[0],
  })),
  facts: VELVRA_KIT.facts.map((f) => ({ wording: f.approvedWording, footnote: f.footnote, validTo: f.validTo })),
  today: "2026-10-26",
  limits: CHANNEL_LIMITS,
  practice: PRACTICE,
  items: GOLDEN.map((d) => ({ id: opaque(d.id), order: rank(d.id), channel: d.channel, text: d.text }))
    .sort((a, b) => a.order.localeCompare(b.order))
    .map(({ order: _order, ...item }) => item),
};

mkdirSync("public/label", { recursive: true });
writeFileSync("public/label/manifest.json", JSON.stringify(manifest, null, 1) + "\n");
console.log(`Wrote ${manifest.items.length} drafts and ${manifest.rules.length} rules.`);
