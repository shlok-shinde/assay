// Domain model for Assay. Everything a workspace holds is one of these types,
// stored in the browser (IndexedDB) and exported or imported as JSON.

export type Role = "creator" | "reviewer" | "compliance" | "admin";
export type Channel = "instagram" | "email" | "website" | "linkedin" | "brochure";
export type Category = "tone" | "term" | "message" | "claim" | "visual" | "accessibility" | "legal";
export type Severity = "high" | "medium" | "low";

/** How a rule is enforced: in code (lexical, structural, claim, visual) or by the AI (judgment). */
export type RuleMode = "lexical" | "structural" | "claim" | "visual" | "judgment" | "manual";

export interface SourceRef {
  doc: string;
  page: number;
  section: string;
  /** Set on an imported rule: the book it came from, in the books table. */
  bookId?: string;
  /** Set on an imported rule: the book's own words, which the viewer looks for on the page. */
  quote?: string;
}

export interface Rule {
  id: string;
  title: string;
  text: string;
  category: Category;
  severity: Severity;
  modes: RuleMode[];
  /** Channels the rule applies to. Empty means every channel. */
  channels: Channel[];
  dos: string[];
  donts: string[];
  /** Phrases (case-insensitive, whole words) that trigger a lexical rule. */
  patterns: string[];
  /** Suggested replacement per pattern. "" means delete the phrase. */
  replacements: Record<string, string>;
  /** Generic minimal fix used when nothing more specific applies. */
  fixTemplate?: string;
  source: SourceRef;
  active: boolean;
  /** Set when the rule came from a brand-book import and still waits for approval. */
  pending?: boolean;
}

export type FactKind = "study" | "clinical" | "spec" | "price" | "offer" | "certification" | "policy" | "panel";

export interface Quantity {
  value: number;
  unit: Unit;
}

export type Unit = "percent" | "day" | "week" | "month" | "year" | "minute" | "hour" | "inr" | "ml" | "spf" | "n" | "count";

export interface Fact {
  id: string;
  statement: string;
  /** The approved wording, a full sentence. */
  approvedWording: string;
  /** A short predicate that can replace a claim inside a sentence. */
  inlineWording: string;
  footnote?: string;
  kind: FactKind;
  quantities: Quantity[];
  keywords: string[];
  /** Phrases that show a draft is making this claim even without a number. */
  triggers: string[];
  owner: string;
  source: string;
  validFrom?: string;
  validTo?: string;
}

export interface Term {
  id: string;
  ruleId: string;
  banned: string[];
  preferred: string;
  note: string;
  severity: Severity;
}

export interface PaletteColor {
  name: string;
  hex: string;
}

export interface ChannelLimits {
  maxEmoji: number;
  maxExclamation: number;
  maxCapsWords: number;
  /** Minimum Flesch reading ease. */
  readabilityMin: number;
}

export interface KitContent {
  name: string;
  brandBook: string;
  rules: Rule[];
  facts: Fact[];
  terms: Term[];
  palette: PaletteColor[];
  fonts: string[];
  logo: { minWidthPx: number; clearSpaceRatio: number };
  channelLimits: Record<Channel, ChannelLimits>;
  acronyms: string[];
  /** Words that BM25 retrieval treats as the same, e.g. "dark spots" ~ "even tone". */
  synonyms: string[][];
  pillars: string[];
  /** Brand and product names. They are not evidence when matching a claim to a fact. */
  products: string[];
  /** Words a run-together hashtag can be split into. Absent on snapshots published before Round 3. */
  vocabulary?: string[];
  /** A line certain copy must carry: which rule asks, what triggers it, and what counts as having it (regular expressions). */
  disclaimer?: { ruleId: string; mentions: string; present: string };
}

export interface BrandKit extends KitContent {
  id: string;
  confidential: boolean;
  updatedAt: string;
}

export interface RulebookVersion {
  id: string;
  kitId: string;
  version: string;
  publishedAt: string;
  publishedBy: string;
  notes: string;
  hash: string;
  snapshot: KitContent;
  /** Set on a version published from a clarification: what changed, why, and who drafted it. */
  clarification?: { ruleId: string; before: { text: string; dos: string[]; donts: string[] }; rationale: string; draftedBy: string; at: string };
  /** Set on a version that restores an earlier one. */
  rolledBackTo?: string;
}

export interface IntentCard {
  goal: string;
  keyMessage: string;
  cta: string;
  confirmed: boolean;
  draftedBy: "ai" | "heuristic" | "creator";
}

export type SubmissionStatus = "draft" | "checked" | "in_review" | "changes_requested" | "approved";

export interface Submission {
  id: string;
  title: string;
  channel: Channel;
  audience: string;
  campaign: string;
  creator: string;
  agency?: string;
  status: SubmissionStatus;
  intent: IntentCard;
  rulebookVersion: string;
  createdAt: string;
  updatedAt: string;
  sampleId?: string;
  /** Seeded history used by Guideline Health, never shown as real activity. */
  seeded?: boolean;
}

export interface PageSpan {
  page: number;
  start: number;
  end: number;
}

export interface ImageAsset {
  /** Empty on a stored version row: the file lives once in the blobs table under `blob`. */
  dataUrl: string;
  /** sha256 of the data URL, the key into the blobs table. The Hallmark seals the same hash. */
  blob?: string;
  width: number;
  height: number;
  alt: string;
  fileName: string;
  /** Logo box marked by hand, in image pixels. It wins over the wordmark OCR finds. */
  logoBox?: { x: number; y: number; w: number; h: number };
}

export interface Version {
  id: string;
  submissionId: string;
  n: number;
  text: string;
  source: { kind: "paste" | "docx" | "pdf" | "image" | "fix" | "edit"; fileName?: string };
  pages?: PageSpan[];
  image?: ImageAsset;
  createdAt: string;
  author: string;
  note: string;
  /** Set on versions created by applying fixes. */
  intentCheck?: IntentCheckResult;
  /** Findings whose fixes made this version. */
  appliedFindingIds?: string[];
}

export type FindingStatus =
  | "open"
  | "accepted"
  | "edited"
  | "dismissed"
  | "contested"
  | "sent_to_compliance"
  | "compliance_approved"
  | "reopened"
  /** Still open when the reviewer approved; the reason is recorded in the Hallmark. */
  | "waived"
  | "superseded";

export type ClaimStatus = "supported" | "contradicted" | "outdated" | "unsupported";

export interface Fix {
  kind: "replace" | "append" | "manual";
  replacement: string;
  footnote?: string;
  label: string;
  /** Range the fix replaces when it differs from the finding's span. */
  range?: { start: number; end: number };
  /** The deletion starts a sentence, so the word after it takes the capital. */
  capNext?: boolean;
}

/** Whether a change still carries the Intent Card. "unchecked" means the card was blank, so nothing could be compared. */
export interface IntentCheckResult {
  kept: boolean;
  summary: string;
  verdict?: "kept" | "review" | "lost" | "unchecked";
  ai?: { kept: boolean; explanation: string; model: string };
}

export interface Finding {
  id: string;
  checkId: string;
  submissionId: string;
  versionId: string;
  ruleId: string;
  relatedRuleIds: string[];
  factId?: string;
  claimStatus?: ClaimStatus;
  category: Category;
  severity: Severity;
  origin: "rule" | "ai";
  model?: string;
  confidence?: number;
  /** Soft finding: AI confidence below 0.5. */
  suggestion?: boolean;
  /** Where the finding came from inside the text. Image findings use start = end = -1. */
  start: number;
  end: number;
  quote: string;
  page?: number;
  region?: { x: number; y: number; w: number; h: number };
  title: string;
  reason: string;
  fix?: Fix;
  status: FindingStatus;
  resolution?: { by: string; role: Role; reason?: string; at: string; editedText?: string };
  /** Kept after a contested finding moves on to Compliance or a waiver, so Guideline Health still counts it. */
  contest?: { by: string; reason?: string; at: string };
  /** What this finding's fix does to the Intent Card, checked when the finding is made and again on an edit. */
  intentCheck?: IntentCheckResult;
  /** Someone accepted a fix the check says loses the intent, and gave this reason. Sealed into the Hallmark. */
  intentOverride?: { by: string; reason: string; at: string };
  /** Accepted, but another fix won the same words; the decision carries to the next version. */
  notApplied?: { reason: string; at: string };
  cached?: { model: string; at: string };
}

/** A stored file (creative or brand book), kept once however many versions point at it. */
export interface BlobRow {
  hash: string;
  dataUrl: string;
  at: string;
}

/** A brand book a kit cites, with its pages and paragraphs. */
export interface BookRow {
  id: string;
  kitId: string;
  title: string;
  /** Hash of the PDF in the blobs table; absent for the seeded book, which ships as a static file. */
  blob?: string;
  url?: string;
  importedAt: string;
}

export type FixEventKind = "offered" | "accepted" | "edited" | "dismissed" | "contested" | "undone";

/** One thing someone did with a suggested fix. Append-only: the fix acceptance rate is computed from these. */
export interface FixEvent {
  id: string;
  at: string;
  kind: FixEventKind;
  ruleId: string;
  findingId: string;
  submissionId: string;
  role: Role;
  /** Share of the suggestion the person changed, 0 to 1, on an edit. */
  editShare?: number;
  /** Made by an automated browser (a test run), so never counted in the acceptance rate. */
  automated?: boolean;
}

export interface Owner {
  id: string;
  name: string;
  email: string;
  /** A made-up demo address: alerts to it are shown in the inbox, never sent. */
  simulated?: boolean;
}

export interface NotificationRow {
  id: string;
  /** factId|validTo|threshold, so each alert is raised once. */
  key: string;
  factId: string;
  ownerId: string;
  threshold: number;
  at: string;
  sentAt?: string;
  readAt?: string;
}

/** A local write waiting to reach the team server. Unused in a browser-only workspace. */
export interface SyncRow {
  seq?: number;
  tbl: string;
  rowId: string;
  op: "put" | "delete";
  at: string;
}

export interface DroppedFinding {
  reason: string;
  ruleId?: string;
  quote?: string;
}

export interface CheckedClaim {
  text: string;
  start: number;
  end: number;
  status: ClaimStatus;
  factId?: string;
  detail: string;
}

export interface Check {
  id: string;
  submissionId: string;
  versionId: string;
  rulebookVersion: string;
  mode: "rules+ai" | "rules-only" | "confidential";
  banner?: string;
  startedAt: string;
  ms: number;
  aiCalls: number;
  aiModel?: string;
  redactions: number;
  segmentsTotal: number;
  segmentsReused: number;
  dropped: DroppedFinding[];
  relocated: number;
  claims: CheckedClaim[];
  findingIds: string[];
  /** Rule checks are stored; the AI judgment for changed paragraphs is still running. */
  aiPending?: boolean;
  /** How long the AI judgment took, once it finished. */
  aiMs?: number;
}

export interface Comment {
  id: string;
  submissionId: string;
  findingId?: string;
  author: string;
  role: Role;
  text: string;
  at: string;
}

export interface Approval {
  id: string;
  submissionId: string;
  versionId: string;
  role: Role;
  by: string;
  decision: "approved" | "changes_requested" | "claims_approved";
  note: string;
  at: string;
}

export interface HallmarkBody {
  submissionId: string;
  title: string;
  versionId: string;
  versionN: number;
  contentHash: string;
  rulebookVersion: string;
  rulebookHash: string;
  findings: { id: string; ruleId: string; severity: Severity; status: FindingStatus; reason?: string; by?: string; intentOverride?: string }[];
  approvals: { role: Role; by: string; decision: string; at: string }[];
  ai: { models: string[]; calls: number; redactions: number; mode: string };
  prevHash: string;
  issuedAt: string;
}

export interface Hallmark extends HallmarkBody {
  id: string;
  seq: number;
  hash: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  role: Role;
  action: string;
  target: string;
  details?: string;
  seeded?: boolean;
}

export interface AICallLog {
  id: string;
  at: string;
  task: string;
  model?: string;
  ok: boolean;
  ms: number;
  redactions: number;
  outcome: string;
  /** Each try as model, outcome and seconds, from the server. */
  attempts?: string;
}

export interface AICacheEntry {
  key: string;
  task: string;
  model: string;
  at: string;
  data: unknown;
  /** True when the entry shipped with the demo seed. */
  seeded?: boolean;
}

export interface Person {
  name: string;
  role: Role;
  org: string;
}
