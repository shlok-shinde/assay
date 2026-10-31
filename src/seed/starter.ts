// What a new brand starts with: rules that hold for almost any brand's marketing, with nothing about
// Velvra. Everything brand-specific (words, palette, facts) is theirs to add in the Brand Kit.
import type { KitContent, Rule } from "@/lib/types";
import { CHANNEL_LIMITS } from "./velvra";

const SOURCE = { doc: "Assay starter rules", page: 0, section: "Starter" };

const rule = (r: Pick<Rule, "id" | "title" | "text" | "category" | "severity" | "modes"> & Partial<Rule>): Rule => ({ dos: [], donts: [], patterns: [], replacements: {}, channels: [], active: true, source: SOURCE, ...r });

export const starterRules = (): Rule[] => [
  rule({ id: "VOICE-01", title: "Sounds like the brand", text: "Write in the brand's voice. Replace this with how your brand sounds, with an example of what to do and what to avoid.", category: "tone", severity: "low", modes: ["judgment"] }),
  rule({ id: "CLAIM-01", title: "Claims must match the Claim Ledger", text: "Any study or numeric claim must match an approved Claim Ledger fact and use its approved wording.", category: "claim", severity: "high", modes: ["claim"] }),
  rule({
    id: "CLAIM-02",
    title: "No guarantees",
    text: "Never guarantee results or promise anything permanent.",
    category: "claim",
    severity: "high",
    modes: ["lexical"],
    patterns: ["results guaranteed", "guaranteed results", "guaranteed", "guarantee", "guarantees", "permanent results", "forever", "100% safe", "risk-free"],
  }),
  rule({
    id: "CLAIM-03",
    title: "Superlatives need a fact",
    text: "Superlatives and comparisons (“best”, “No. 1”, “better than”) need an approved Claim Ledger fact.",
    category: "claim",
    severity: "high",
    modes: ["claim"],
    patterns: ["the best", "best", "no. 1", "no.1", "#1", "number one", "most effective", "better than", "leading", "unbeatable", "world's first", "most trusted"],
  }),
  rule({ id: "CLAIM-05", title: "Study claims need a footnote", text: "Every study claim carries a footnote with the study type, size and year.", category: "claim", severity: "medium", modes: ["claim"] }),
  rule({ id: "A11Y-01", title: "Text contrast", text: "Text needs a contrast ratio of at least 4.5:1, or 3:1 for large text (WCAG 2.2 AA).", category: "accessibility", severity: "medium", modes: ["visual"] }),
  rule({
    id: "A11Y-02",
    title: "Descriptive link text",
    text: "Link text says where it goes. Never “click here” or “read more”.",
    category: "accessibility",
    severity: "low",
    modes: ["lexical"],
    patterns: ["click here", "tap here", "read more", "learn more"],
  }),
  rule({ id: "A11Y-03", title: "Readable for the channel", text: "Copy meets the readability target for its channel (Flesch reading ease).", category: "accessibility", severity: "low", modes: ["structural"] }),
  rule({ id: "A11Y-04", title: "Images need alt text", text: "Every image needs alt text that describes it.", category: "accessibility", severity: "medium", modes: ["structural"] }),
  rule({
    id: "A11Y-05",
    title: "Hashtags, emoji and capitals",
    text: "Use CamelCase hashtags so screen readers read them as words. Keep emoji and ALL-CAPS words within the channel limit.",
    category: "accessibility",
    severity: "low",
    modes: ["structural"],
  }),
];

export function starterKit(name: string): KitContent {
  return {
    name,
    brandBook: `${name} brand book`,
    rules: starterRules(),
    facts: [],
    terms: [],
    palette: [],
    fonts: [],
    logo: { minWidthPx: 120, clearSpaceRatio: 0.5 },
    channelLimits: structuredClone(CHANNEL_LIMITS),
    acronyms: [],
    synonyms: [],
    pillars: [],
    products: [],
    vocabulary: [],
  };
}
