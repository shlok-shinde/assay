// The golden set: fictional Velvra drafts, each labelled with the rule IDs a
// careful reviewer would expect to fire. Labels were written by the builder
// with AI assistance from the rule texts, before looking at the engine's
// output on each draft. They measure the engine against its own spec, not
// real-world accuracy. Judgment-only rules (VOICE-01, MSG-01) are not
// labelled here because the AI is not part of the rule-check evaluation.
import type { Channel } from "@/lib/types";

export interface GoldenDraft {
  id: string;
  channel: Channel;
  text: string;
  expect: string[];
  note?: string;
}

export const GOLDEN: GoldenDraft[] = [
  // ---- Clean drafts: nothing should fire ----------------------------------
  { id: "clean-01", channel: "instagram", text: "Monsoon mornings call for Daily Shield SPF 50. Light, fragrance-free and ready for humid days. #DailyProtection", expect: [] },
  { id: "clean-02", channel: "linkedin", text: "Our R&D team spent this year listening to dermatologists. Daily Shield SPF 50 is dermatologist-tested and water-resistant for 40 minutes.", expect: [] },
  { id: "clean-03", channel: "email", text: "Hi there,\n\nDaily Shield SPF 50 is back in stock. Reapply every 2 hours, and after swimming or sweating.\n\nBrowse the Daily Shield range on our website.", expect: [] },
  { id: "clean-04", channel: "website", text: "Daily Shield SPF 50 costs ₹649 for 50 ml. Orders over ₹499 ship free. Reapply every 2 hours.", expect: [] },
  { id: "clean-05", channel: "instagram", text: "Sun care that feels like nothing at all. Daily Shield SPF 50, made for everyday protection. #SunCare", expect: [] },
  { id: "clean-06", channel: "linkedin", text: "In our 4-week study, 82% saw a visibly more even skin tone.* We are proud of what the team built.\n\n*In-house study, 40 participants, 2025.", expect: [] },
  { id: "clean-07", channel: "brochure", text: "Daily Shield SPF 50. Fragrance-free. Dermatologist-tested. Find it at your nearest pharmacy.", expect: [] },
  { id: "clean-08", channel: "instagram", text: "Treat yourself to a slow morning, then add Daily Shield SPF 50 before you head out. #SlowMornings", expect: [], note: "“treat yourself” is not a medical claim" },
  { id: "clean-09", channel: "website", text: "A fair price for daily protection: ₹649 for 50 ml. Reapply every 2 hours.", expect: [], note: "“fair price” is not fairness language" },
  { id: "clean-10", channel: "email", text: "Your order is on its way. Questions? Reply to this email and our team will help. Reapply your Daily Shield every 2 hours.", expect: [] },

  // ---- Tone ----------------------------------------------------------------
  { id: "tone-01", channel: "instagram", text: "OMG this sunscreen is everything. Daily Shield SPF 50 for daily protection.", expect: ["VOICE-02"] },
  { id: "tone-02", channel: "instagram", text: "Honestly obsessed with Daily Shield SPF 50 this monsoon. #DailyShield", expect: ["VOICE-02"] },
  { id: "tone-03", channel: "instagram", text: "Your skin will thank you!!! Daily Shield SPF 50.", expect: ["VOICE-02"] },
  { id: "tone-04", channel: "linkedin", text: "This launch is a total game changer for Indian sun care.", expect: ["VOICE-02"] },
  { id: "tone-05", channel: "instagram", text: "Hide those embarrassing dark patches with Daily Shield SPF 50.", expect: ["VOICE-03"] },
  { id: "tone-06", channel: "website", text: "Fix your skin flaws with daily protection. Reapply every 2 hours.", expect: ["VOICE-03"] },
  { id: "tone-07", channel: "instagram", text: "The holy grail of sun care is here. #SunCare", expect: ["VOICE-02"] },
  { id: "tone-08", channel: "instagram", text: "lowkey insane how light this SPF feels, no cap", expect: ["VOICE-02"] },
  { id: "tone-09", channel: "email", text: "Big news! Daily Shield SPF 50 is here! Reapply every 2 hours.", expect: ["VOICE-02"], note: "two exclamation marks; email allows one" },
  { id: "tone-10", channel: "instagram", text: "No more ugly sunburn days. Daily Shield SPF 50 has you covered.", expect: ["VOICE-03"] },

  // ---- Terminology --------------------------------------------------------
  { id: "term-01", channel: "instagram", text: "Our new sunblock is here for monsoon days.", expect: ["TERM-04"] },
  { id: "term-02", channel: "website", text: "A whitening sunscreen for every skin type. Reapply every 2 hours.", expect: ["TERM-05"] },
  { id: "term-03", channel: "instagram", text: "Get fairer skin with daily protection.", expect: ["TERM-05"], note: "label corrected on review: “fairer skin” is in TERM-05's banned list" },
  { id: "term-04", channel: "linkedin", text: "Our skin care range now includes Daily Shield SPF 50.", expect: ["TERM-01"] },
  { id: "term-05", channel: "website", text: "A chemical-free formula for daily protection. Reapply every 2 hours.", expect: ["TERM-02"] },
  { id: "term-06", channel: "instagram", text: "Our lightweight serum protects you from the sun.", expect: ["TERM-03"] },
  { id: "term-07", channel: "email", text: "Pack your sun cream for the trip. Daily Shield SPF 50 fits any bag. Reapply every 2 hours.", expect: ["TERM-04"] },
  { id: "term-08", channel: "brochure", text: "Skin lightening is not what we do. Daily Shield is about even tone.", expect: ["TERM-05"], note: "a negation still uses the banned term" },
  { id: "term-09", channel: "instagram", text: "Fairness is a value at Velvra: equal pay for every maker.", expect: ["TERM-05"], note: "a different sense of the word; the lexicon cannot tell" },
  { id: "term-10", channel: "website", text: "A daily moisturiser with SPF 50 protection. Reapply every 2 hours.", expect: ["TERM-03"] },

  // ---- Messaging ------------------------------------------------------------
  { id: "msg-01", channel: "instagram", text: "Dark spots vanish overnight with Daily Shield SPF 50.", expect: ["MSG-02"] },
  { id: "msg-02", channel: "website", text: "See instant results from the first use. Reapply every 2 hours.", expect: ["MSG-02"] },
  { id: "msg-03", channel: "instagram", text: "Erase uneven tone with daily protection.", expect: ["MSG-02"] },
  { id: "msg-04", channel: "email", text: "Protection that works immediately. Reapply every 2 hours.", expect: ["MSG-02"] },
  { id: "msg-05", channel: "linkedin", text: "Skin changes take weeks, which is why we built for daily use.", expect: [] },

  // ---- Claims ---------------------------------------------------------------
  { id: "claim-01", channel: "instagram", text: "Clinically proven to erase dark spots in just 7 days.", expect: ["CLAIM-01", "MSG-02"] },
  { id: "claim-02", channel: "email", text: "Take 25% off this monsoon with code RAIN25. Reapply every 2 hours.", expect: ["CLAIM-01"] },
  { id: "claim-03", channel: "instagram", text: "It leaves no white cast on any skin tone.", expect: ["CLAIM-01"], note: "F-115 has expired" },
  { id: "claim-04", channel: "website", text: "Daily Shield SPF 30 for everyday use. Reapply every 2 hours.", expect: ["CLAIM-01"] },
  { id: "claim-05", channel: "website", text: "Only ₹599 for 50 ml. Reapply every 2 hours.", expect: ["CLAIM-01"] },
  { id: "claim-06", channel: "instagram", text: "Water-resistant for 80 minutes, so swim away.", expect: ["CLAIM-01"] },
  { id: "claim-07", channel: "brochure", text: "The best sunscreen in India.", expect: ["CLAIM-03"] },
  { id: "claim-08", channel: "brochure", text: "India's No. 1 dermatologist-recommended sunscreen.", expect: ["CLAIM-03"] },
  { id: "claim-09", channel: "website", text: "Results guaranteed or your money back. Reapply every 2 hours.", expect: ["CLAIM-02"] },
  { id: "claim-10", channel: "instagram", text: "Permanent protection from sun damage.", expect: ["CLAIM-02"] },
  { id: "claim-11", channel: "website", text: "Its niacinamide blend treats acne. Reapply every 2 hours.", expect: ["CLAIM-04"] },
  { id: "claim-12", channel: "instagram", text: "Heals sunburn while it protects.", expect: ["CLAIM-04"] },
  { id: "claim-13", channel: "linkedin", text: "In our 4-week study, 82% saw a visibly more even skin tone.", expect: ["CLAIM-05"] },
  { id: "claim-14", channel: "linkedin", text: "90% of users saw brighter skin in our trial.", expect: ["CLAIM-01"] },
  { id: "claim-15", channel: "instagram", text: "Better than any sunscreen you have tried.", expect: ["CLAIM-03"] },
  { id: "claim-16", channel: "instagram", text: "The best way to apply sunscreen is two finger-lengths for your face.", expect: [], note: "“best way” is advice, not a product superlative" },
  { id: "claim-17", channel: "email", text: "Free shipping on orders over ₹999 this week. Reapply every 2 hours.", expect: ["CLAIM-01"] },
  { id: "claim-18", channel: "website", text: "Dermatologist-tested and fragrance-free. Reapply every 2 hours.", expect: [] },

  // ---- Legal ----------------------------------------------------------------
  { id: "legal-01", channel: "email", text: "Daily Shield SPF 50 is back in stock. Shop the range on our website.", expect: ["LEGAL-01"] },
  { id: "legal-02", channel: "website", text: "Daily Shield SPF 50 is a light gel sunscreen for humid days.", expect: ["LEGAL-01"] },
  { id: "legal-03", channel: "instagram", text: "Daily Shield SPF 50 is a light gel sunscreen for humid days.", expect: [], note: "Instagram does not need the disclaimer" },
  { id: "legal-04", channel: "email", text: "Our sunscreen is ready for your trip. Reapply after swimming.", expect: [] },

  // ---- Accessibility --------------------------------------------------------
  { id: "a11y-01", channel: "email", text: "Want to see the full range? Click here. Reapply every 2 hours.", expect: ["A11Y-02"] },
  { id: "a11y-02", channel: "website", text: "Read more about Daily Shield SPF 50. Reapply every 2 hours.", expect: ["A11Y-02"] },
  { id: "a11y-03", channel: "instagram", text: "Sun care for monsoon days. #monsoonskincare #DailyShield", expect: ["A11Y-05"] },
  { id: "a11y-04", channel: "instagram", text: "Sun care 🌞☀️🔆🌤️ for monsoon days.", expect: ["A11Y-05"] },
  { id: "a11y-05", channel: "linkedin", text: "BIG NEWS FROM VELVRA: Daily Shield SPF 50 is here.", expect: ["A11Y-05"] },
  {
    id: "a11y-06",
    channel: "website",
    text: "Notwithstanding considerable meteorological variability characterising subcontinental monsoon conditions, comprehensive photoprotective formulations necessitate meticulous, consistent application methodologies, particularly considering perspiration-induced degradation, environmental particulate accumulation and cumulative ultraviolet exposure throughout extended outdoor activities undertaken by individuals with diverse dermatological characteristics. Reapply every 2 hours.",
    expect: ["A11Y-03"],
  },
  { id: "a11y-07", channel: "instagram", text: "Find the full guide on our website. #SunCareTips", expect: [] },
];
