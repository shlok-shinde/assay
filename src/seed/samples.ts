// The six "Try a sample" drafts. All fictional. The DOCX, PDF and PNG files
// in public/samples are generated from this text by scripts/make-samples.mjs,
// so the upload path a judge uses is the same one these samples use.
import type { Channel, IntentCard } from "@/lib/types";

export interface Sample {
  id: string;
  title: string;
  channel: Channel;
  audience: string;
  campaign: string;
  creator: string;
  agency?: string;
  /** What the sample shows, in one line, for the sample picker. */
  shows: string;
  text: string;
  /** For the brochure: the text of each page. */
  pages?: string[];
  file?: { path: string; kind: "docx" | "pdf" | "image"; name: string };
  image?: { path: string; name: string; alt: string; logoBox: { x: number; y: number; w: number; h: number } };
  intent: Omit<IntentCard, "confirmed" | "draftedBy">;
}

export const SAMPLES: Sample[] = [
  {
    id: "instagram-launch",
    title: "Monsoon launch: Instagram post",
    channel: "instagram",
    audience: "Women 22–35, metro India",
    campaign: "Monsoon launch",
    creator: "Riya (agency intern)",
    agency: "Bloom Social",
    shows: "The Round 1 worked example: claims, tone, terms, contrast, palette, logo and alt text",
    text: "OMG 😍 our new sunblock is clinically proven to erase dark spots in just 7 days! The best serum in India. Shop now 👉 link in bio",
    image: {
      path: "/samples/velvra-monsoon-creative.png",
      name: "velvra-monsoon-creative.png",
      alt: "",
      logoBox: { x: 64, y: 940, w: 96, h: 34 },
    },
    intent: { goal: "Launch awareness", keyMessage: "Daily sun protection that evens skin tone", cta: "Shop via link in bio" },
  },
  {
    id: "monsoon-email",
    title: "Monsoon offer: email",
    channel: "email",
    audience: "Existing customers",
    campaign: "Monsoon offer",
    creator: "Dev (CRM team)",
    shows: "A wrong discount, an expired fact, “click here” and a missing SPF disclaimer",
    text: `Subject: Monsoon glow, now 25% off

Hi there,

Rainy days still need sun care. Daily Shield SPF 50 gives you broad-spectrum protection that sits light on skin, and our consumer panel says it leaves no white cast.

For the monsoon, take 25% off with code RAIN25. Orders over ₹499 ship free.

Want to see the full range? Click here.

Stay protected,
Team Velvra`,
    intent: { goal: "Drive offer sales", keyMessage: "Daily Shield SPF 50 is on offer this monsoon", cta: "Shop the offer with the code" },
  },
  {
    id: "product-page-docx",
    title: "Product page copy (DOCX)",
    channel: "website",
    audience: "Website visitors",
    campaign: "Always on",
    creator: "Sana (freelance writer)",
    shows: "A Word upload with banned fairness language, a guarantee and a medical claim",
    text: `Daily Shield SPF 50

Meet Daily Shield SPF 50, the lightweight sunscreen for whitening and everyday protection. Visible results guaranteed.

Its niacinamide blend treats acne while it protects, and it is water-resistant for 40 minutes.

₹649 for 50 ml. Reapply every 2 hours, and after swimming or sweating.`,
    file: { path: "/samples/velvra-product-page.docx", kind: "docx", name: "velvra-product-page.docx" },
    intent: { goal: "Drive purchases", keyMessage: "Lightweight everyday sun protection", cta: "Add to cart" },
  },
  {
    id: "brochure-pdf",
    title: "Retail brochure (2-page PDF)",
    channel: "brochure",
    audience: "Pharmacy shoppers",
    campaign: "Retail launch",
    creator: "Print studio",
    agency: "Inkwell Print",
    shows: "A PDF upload where every finding carries its page number",
    text: "",
    pages: [
      `Velvra Daily Shield SPF 50

Everyday protection, made for Indian weather. Dermatologist-tested and fragrance-free.

SPF 50 PA++++ broad-spectrum protection in a light gel.`,
      `Why people switch

Clinically proven: 90% saw brighter skin.

The No. 1 sunscreen in India, with permanent results.

₹649 for 50 ml at your nearest pharmacy.`,
    ],
    file: { path: "/samples/velvra-brochure.pdf", kind: "pdf", name: "velvra-brochure.pdf" },
    intent: { goal: "Launch awareness in retail", keyMessage: "Everyday protection made for Indian weather", cta: "Find it at your nearest pharmacy" },
  },
  {
    id: "linkedin-clean",
    title: "R&D update: LinkedIn post",
    channel: "linkedin",
    audience: "Industry and investors",
    campaign: "Brand trust",
    creator: "Arjun (brand lead)",
    shows: "A clean draft: supported claims, footnote present, almost no findings",
    text: `We are proud to share what our R&D team learned this year. In our 4-week study, 82% saw a visibly more even skin tone.* Daily Shield SPF 50 is fragrance-free and dermatologist-tested, built for daily protection in Indian weather.

Read the full study summary on our website. #DailyProtection #VelvraLab

*In-house study, 40 participants, 2025.`,
    intent: { goal: "Build trust with evidence", keyMessage: "Our study shows a visibly more even skin tone", cta: "Read the full study summary" },
  },
  {
    id: "genz-caption",
    title: "Gen-Z agency caption",
    channel: "instagram",
    audience: "Gen Z, 18–24",
    campaign: "Campus drop",
    creator: "Bloom Social",
    agency: "Bloom Social",
    shows: "Youth slang that VOICE-02 flags, and that teams keep dismissing (see Guideline Health)",
    text: "ok this SPF is lowkey insane 🔥🔥 zero greasy feel, no cap. your skin will thank you!!! #sunscreentok #DailyShield",
    intent: { goal: "Campus awareness", keyMessage: "A sunscreen that doesn't feel greasy", cta: "" },
  },
];

export const sampleText = (s: Sample) => (s.pages ? s.pages.join("\n\n") : s.text);
