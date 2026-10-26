// Seeded demo history for Guideline Health: about 30 past reviews, generated
// from a fixed seed so every judge sees the same numbers. Every record is
// marked `seeded` and the UI labels it "seeded demo history".
import type { AuditEntry, Channel, Finding, FindingStatus, Role, Submission } from "@/lib/types";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Template {
  ruleId: string;
  category: Finding["category"];
  severity: Finding["severity"];
  quotes: string[];
  /** Picks an outcome given the audience. */
  outcome: (rand: () => number, youth: boolean) => { status: FindingStatus; reason?: string; role: Role };
  weight: (youth: boolean, channel: Channel, agency: string) => number;
}

const pick = <T,>(rand: () => number, xs: T[]) => xs[Math.floor(rand() * xs.length)];

const TEMPLATES: Template[] = [
  {
    ruleId: "VOICE-02",
    category: "tone",
    severity: "medium",
    quotes: ["lowkey insane", "OMG", "obsessed", "!!!", "literally epic", "no cap, unreal"],
    outcome: (r, youth) =>
      youth && r() < 0.85
        ? { status: "dismissed", reason: pick(r, ["Gen-Z campaign, slang approved by brand lead", "Youth audience, informal tone agreed", "Campus drop: casual voice is the brief"]), role: "creator" }
        : { status: "accepted", role: "creator" },
    weight: (youth) => (youth ? 0.95 : 0.25),
  },
  {
    ruleId: "MSG-01",
    category: "message",
    severity: "low",
    quotes: ["New drop. Go get it.", "Our monsoon edit is here", "Something new is coming"],
    outcome: (r) =>
      r() < 0.55
        ? { status: "contested", reason: pick(r, ["Which pillar? The rule doesn't say how much is enough", "Teaser posts can't mention pillars yet", "Rule is vague for non-launch posts"]), role: "creator" }
        : r() < 0.5
          ? { status: "dismissed", reason: "Teaser, pillars come in the follow-up post", role: "creator" }
          : { status: "accepted", role: "creator" },
    weight: () => 0.45,
  },
  {
    ruleId: "TERM-04",
    category: "term",
    severity: "low",
    quotes: ["sunblock", "sun cream", "sun block"],
    outcome: () => ({ status: "accepted", role: "creator" }),
    weight: (_y, _c, agency) => (agency === "Bloom Social" ? 0.7 : 0.2),
  },
  {
    ruleId: "CLAIM-01",
    category: "claim",
    severity: "high",
    quotes: ["clinically proven", "25% off", "90% saw results", "in just 7 days"],
    outcome: (r) => (r() < 0.6 ? { status: "compliance_approved", role: "compliance" } : { status: "accepted", role: "creator" }),
    weight: () => 0.35,
  },
  {
    ruleId: "A11Y-02",
    category: "accessibility",
    severity: "low",
    quotes: ["click here", "read more", "tap here"],
    outcome: () => ({ status: "accepted", role: "creator" }),
    weight: (_y, channel) => (channel === "email" ? 0.8 : 0.1),
  },
  {
    ruleId: "LEGAL-01",
    category: "legal",
    severity: "high",
    quotes: ["SPF 50"],
    outcome: () => ({ status: "accepted", role: "creator" }),
    weight: (_y, channel) => (channel === "email" || channel === "website" ? 0.4 : 0),
  },
  {
    ruleId: "TERM-05",
    category: "term",
    severity: "high",
    quotes: ["fairness", "whitening"],
    outcome: () => ({ status: "accepted", role: "creator" }),
    weight: () => 0.08,
  },
  {
    ruleId: "A11Y-05",
    category: "accessibility",
    severity: "low",
    quotes: ["#sunscreentok", "#dailyshield", "#monsoonglow"],
    outcome: (r, youth) => (youth && r() < 0.3 ? { status: "dismissed", reason: "Trend hashtag must stay lowercase", role: "creator" } : { status: "accepted", role: "creator" }),
    weight: (youth) => (youth ? 0.5 : 0.15),
  },
];

const CAMPAIGNS: { campaign: string; channel: Channel; audience: string; agency: string; creator: string }[] = [
  { campaign: "Campus drop", channel: "instagram", audience: "Gen Z, 18–24", agency: "Bloom Social", creator: "Bloom Social" },
  { campaign: "Monsoon launch", channel: "instagram", audience: "Women 22–35, metro India", agency: "Bloom Social", creator: "Riya (agency intern)" },
  { campaign: "Monsoon offer", channel: "email", audience: "Existing customers", agency: "In-house CRM", creator: "Dev (CRM team)" },
  { campaign: "Always on", channel: "website", audience: "Website visitors", agency: "Freelance", creator: "Sana (freelance writer)" },
  { campaign: "Retail launch", channel: "brochure", audience: "Pharmacy shoppers", agency: "Inkwell Print", creator: "Print studio" },
  { campaign: "Brand trust", channel: "linkedin", audience: "Industry and investors", agency: "In-house brand", creator: "Arjun (brand lead)" },
  { campaign: "Reels series", channel: "instagram", audience: "Gen Z, 18–24", agency: "Bloom Social", creator: "Bloom Social" },
];

export interface SeedHistory {
  submissions: Submission[];
  findings: Finding[];
  audit: AuditEntry[];
}

export function seededHistory(now = Date.parse("2026-10-25T09:00:00Z"), count = 30): SeedHistory {
  const rand = mulberry32(24_2026);
  const submissions: Submission[] = [];
  const findings: Finding[] = [];
  const audit: AuditEntry[] = [];
  for (let i = 0; i < count; i++) {
    const c = CAMPAIGNS[Math.floor(rand() * CAMPAIGNS.length)];
    const youth = /gen z/i.test(c.audience);
    const at = new Date(now - Math.floor(rand() * 56 * 86_400_000)).toISOString();
    const id = `seed_sub_${String(i + 1).padStart(2, "0")}`;
    const status: Submission["status"] = rand() < 0.85 ? "approved" : "changes_requested";
    submissions.push({
      id,
      title: `${c.campaign}: ${c.channel} draft ${i + 1}`,
      channel: c.channel,
      audience: c.audience,
      campaign: c.campaign,
      creator: c.creator,
      agency: c.agency,
      status,
      intent: { goal: c.campaign, keyMessage: "", cta: "", confirmed: true, draftedBy: "creator" },
      rulebookVersion: "3.2",
      createdAt: at,
      updatedAt: at,
      seeded: true,
    });
    let n = 0;
    for (const t of TEMPLATES) {
      if (rand() >= t.weight(youth, c.channel, c.agency)) continue;
      const o = t.outcome(rand, youth);
      const quote = pick(rand, t.quotes);
      findings.push({
        id: `seed_f_${i + 1}_${n++}`,
        checkId: `seed_chk_${i + 1}`,
        submissionId: id,
        versionId: `seed_v_${i + 1}`,
        ruleId: t.ruleId,
        relatedRuleIds: [],
        category: t.category,
        severity: t.severity,
        origin: t.ruleId.startsWith("VOICE") || t.ruleId.startsWith("MSG") ? "ai" : "rule",
        start: 0,
        end: quote.length,
        quote,
        title: t.ruleId,
        reason: "Seeded demo history",
        status: o.status,
        resolution: { by: o.role === "compliance" ? "Meera (compliance)" : c.creator, role: o.role, reason: o.reason, at },
      });
    }
    audit.push({ id: `seed_a_${i + 1}`, at, actor: "Seeded demo history", role: "reviewer", action: status === "approved" ? "approved" : "requested changes", target: id, seeded: true });
  }
  return { submissions, findings, audit };
}
