// The Velvra wording the engine used to carry itself. Velvra's kit now holds it as data, and rulebook
// snapshots published before these fields existed read it from here.
import type { KitContent } from "@/lib/types";

export const VELVRA_VOCABULARY =
  "sun screen sunscreen tok daily shield skin care skincare glow monsoon spf protect protection even tone velvra lab life day beauty routine summer rain ready wear every morning love new launch drop fresh tips tip friday monday self team india indian health happy natural light weight lightweight clean free fragrance tested derm dermatologist study science water proof shine bright".split(
    " ",
  );

export const VELVRA_DISCLAIMER: NonNullable<KitContent["disclaimer"]> = {
  ruleId: "LEGAL-01",
  mentions: "\\bDaily Shield(?: SPF ?\\d+)?|\\bSPF ?\\d+|\\bsunscreen\\b",
  present: "\\breappl(y|ied|ication)\\b",
};
