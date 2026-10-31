// The golden set: fictional Velvra drafts, each labelled with the rule IDs a
// careful reviewer would expect to fire. Labels were written by the builder
// with AI assistance from the rule texts, before looking at the engine's
// output on each draft. They measure the engine against its own spec, not
// real-world accuracy. Human labels from people other than the builder live
// in golden/labels/ and are scored separately.
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

  // ---- Added for Round 3. Labels written from the rule texts before these drafts met the engine. -----

  // ---- Judgment: voice ------------------------------------------------------
  { id: "voice-01", channel: "instagram", text: "Buy it. Wear it. Stop asking questions. Daily Shield SPF 50.", expect: ["VOICE-01"] },
  { id: "voice-02", channel: "linkedin", text: "Sunscreen isn't optional and anyone skipping it is making a mistake. Daily Shield SPF 50 exists.", expect: ["VOICE-01"] },
  { id: "voice-03", channel: "email", text: "You have one job this monsoon: wear sunscreen. Do it or regret it. Reapply every 2 hours.", expect: ["VOICE-01"] },
  { id: "voice-04", channel: "instagram", text: "Sunscreen. You know why. Go.", expect: ["VOICE-01"] },
  { id: "voice-05", channel: "website", text: "Our formula has been engineered around photostability parameters across the relevant spectrum. Reapply every 2 hours.", expect: ["VOICE-01"] },
  { id: "voice-06", channel: "instagram", text: "Still not wearing sunscreen? Seriously? Daily Shield SPF 50.", expect: ["VOICE-01"] },
  { id: "voice-07", channel: "email", text: "Everything you were told about sun care is wrong, and it is time someone said so. Reapply every 2 hours.", expect: ["VOICE-01"] },
  { id: "voice-08", channel: "instagram", text: "Sunscreen can feel like one more step, so we made Daily Shield SPF 50 light enough to forget. #EasyMornings", expect: [] },

  // ---- Judgment: launches and the pillars -----------------------------------
  { id: "launch-01", channel: "instagram", text: "New drop. Go get it. Daily Shield SPF 50 lands Friday.", expect: ["MSG-01"] },
  { id: "launch-02", channel: "linkedin", text: "We are launching Daily Shield SPF 50 on Monday. Our team worked hard and we could not be happier.", expect: ["MSG-01"] },
  { id: "launch-03", channel: "email", text: "It's here. Daily Shield SPF 50 launches today. Reapply every 2 hours.", expect: ["MSG-01"] },
  { id: "launch-04", channel: "instagram", text: "Launch day! Daily Shield SPF 50 comes in a cream tube and a new box.", expect: ["MSG-01"] },
  { id: "launch-05", channel: "website", text: "Now available: Daily Shield SPF 50, in a 50 ml tube. Reapply every 2 hours.", expect: ["MSG-01"] },
  { id: "launch-06", channel: "instagram", text: "Launching today: Daily Shield SPF 50, daily protection that helps skin look visibly more even.", expect: [] },
  { id: "launch-07", channel: "linkedin", text: "Today we launch Daily Shield SPF 50, built for daily protection in Indian weather.", expect: [] },
  { id: "launch-08", channel: "instagram", text: "Meet Daily Shield SPF 50. Out now, in a new tube.", expect: ["MSG-01"] },

  // ---- Legal, second round --------------------------------------------------
  { id: "legal-05", channel: "email", text: "Your SPF 50 is running low? Order Daily Shield on our website.", expect: ["LEGAL-01"] },
  { id: "legal-06", channel: "website", text: "What does SPF 50 mean? It shows how much UVB reaches your skin.", expect: ["LEGAL-01"] },
  { id: "legal-07", channel: "email", text: "SPF 50 for the whole family. Reapply every 2 hours.", expect: [] },
  { id: "legal-08", channel: "linkedin", text: "SPF 50 matters, even on cloudy days.", expect: [] },
  { id: "legal-09", channel: "brochure", text: "Daily Shield SPF 50 comes in a 50 ml tube.", expect: [] },
  { id: "legal-10", channel: "website", text: "Daily Shield is a gel sunscreen with SPF 50 PA++++ broad-spectrum protection.", expect: ["LEGAL-01"] },

  // ---- Several problems at once ----------------------------------------------
  { id: "multi-01", channel: "email", text: "OMG!!! Our new sunblock is clinically proven to erase dark spots overnight. Click here. SPF 50.", expect: ["VOICE-02", "TERM-04", "CLAIM-01", "MSG-02", "A11Y-02", "LEGAL-01"] },
  { id: "multi-02", channel: "email", text: "Hi there,\n\nSay goodbye to embarrassing flaws with our whitening serum. Results guaranteed.\n\nClick here to order.", expect: ["VOICE-03", "TERM-05", "TERM-03", "CLAIM-02", "A11Y-02"] },
  { id: "multi-03", channel: "email", text: "Get the best skin care of your life. 30% off this monsoon with code RAIN30. SPF 50 protection. Read more on our website.", expect: ["CLAIM-03", "TERM-01", "CLAIM-01", "LEGAL-01", "A11Y-02"] },
  { id: "multi-04", channel: "email", text: "This game changer treats acne and heals sunburn. Reapply every 2 hours.", expect: ["VOICE-02", "CLAIM-04"] },
  { id: "multi-05", channel: "email", text: "Our chemical-free moisturiser is a must-have. Free shipping on orders over ₹199. Reapply every 2 hours.", expect: ["TERM-02", "TERM-03", "VOICE-02", "CLAIM-01"] },
  { id: "multi-06", channel: "email", text: "90% of people saw fairer skin in just 3 days. Tap here to read the study. SPF 50.", expect: ["CLAIM-01", "TERM-05", "MSG-02", "A11Y-02", "LEGAL-01"] },
  { id: "multi-07", channel: "email", text: "Forever young skin, instantly! Daily Shield SPF 50 is the No. 1 choice.", expect: ["CLAIM-02", "MSG-02", "CLAIM-03", "LEGAL-01"] },
  { id: "multi-08", channel: "email", text: "We're proud to say our product is risk-free with no side effects. Learn more on our website. Reapply every 2 hours.", expect: ["CLAIM-02", "A11Y-02"] },
  { id: "multi-09", channel: "email", text: "Dear customer, your sun cream is waiting. It is water-resistant for 2 hours, so swim as long as you like. Reapply every 2 hours.", expect: ["TERM-04", "CLAIM-01"] },
  { id: "multi-10", channel: "email", text: "Hide your dark spots with our treatment. It works immediately and lasts forever. Click here. SPF 50.", expect: ["VOICE-03", "CLAIM-04", "MSG-02", "CLAIM-02", "A11Y-02", "LEGAL-01"] },
  { id: "multi-11", channel: "website", text: "The most effective sunblock in India, clinically proven. Read more.", expect: ["CLAIM-03", "TERM-04", "CLAIM-01", "A11Y-02"] },
  { id: "multi-12", channel: "instagram", text: "insane glow, zero flaws, guaranteed!!! #glowup #bestsunscreen", expect: ["VOICE-02", "VOICE-03", "CLAIM-02", "A11Y-05"] },

  // ---- Near misses and approved wording --------------------------------------
  { id: "near-01", channel: "instagram", text: "Visit the store for a fair deal this weekend. #WeekendPlans", expect: [] },
  { id: "near-02", channel: "website", text: "Our in-house study of 40 people found 82% saw a more even tone.", expect: ["CLAIM-01", "CLAIM-05"] },
  { id: "near-03", channel: "instagram", text: "Offer ends 20 November: 20% off for the monsoon.", expect: [] },
  { id: "near-04", channel: "linkedin", text: "A panel of 120 people told us it leaves no white cast.", expect: ["CLAIM-01"] },
  { id: "near-05", channel: "brochure", text: "Water-resistant for 40 minutes and fragrance-free. Find it at your nearest pharmacy.", expect: [] },
  { id: "near-06", channel: "website", text: "Cures sun damage. Reapply every 2 hours.", expect: ["CLAIM-04"] },
];

/** The first drafts, whose rule-check scores form the regression gate in golden/baseline.json. */
export const ROUND2_DRAFTS = 64;

/** Rules only the AI can judge. The rule-check score leaves them out, and says so. */
export const JUDGMENT_ONLY = new Set(["VOICE-01", "MSG-01"]);

/**
 * Half the drafts are for tuning and half are kept back, chosen from the ID alone so the split can't
 * be nudged after seeing results. Only the kept-back half counts as a test of the engine.
 */
export function goldenSplit(id: string): "dev" | "heldout" {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? "dev" : "heldout";
}
