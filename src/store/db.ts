// One workspace per browser, in IndexedDB. Nothing here leaves the browser
// except redacted AI calls.
import Dexie, { type Table } from "dexie";
import type {
  AICacheEntry,
  AICallLog,
  Approval,
  AuditEntry,
  BrandKit,
  Check,
  Comment,
  Finding,
  Hallmark,
  RulebookVersion,
  Submission,
  Version,
} from "@/lib/types";

export interface Meta {
  key: string;
  value: unknown;
}

export class AssayDB extends Dexie {
  kits!: Table<BrandKit, string>;
  rulebooks!: Table<RulebookVersion, string>;
  submissions!: Table<Submission, string>;
  versions!: Table<Version, string>;
  checks!: Table<Check, string>;
  findings!: Table<Finding, string>;
  comments!: Table<Comment, string>;
  approvals!: Table<Approval, string>;
  hallmarks!: Table<Hallmark, string>;
  audit!: Table<AuditEntry, string>;
  aiLog!: Table<AICallLog, string>;
  aiCache!: Table<AICacheEntry, string>;
  meta!: Table<Meta, string>;

  constructor(name = "assay") {
    super(name);
    this.version(1).stores({
      kits: "id",
      rulebooks: "id, kitId, publishedAt",
      submissions: "id, status, updatedAt, seeded",
      versions: "id, submissionId, n",
      checks: "id, submissionId, versionId",
      findings: "id, submissionId, versionId, checkId, ruleId, status",
      comments: "id, submissionId, findingId, at",
      approvals: "id, submissionId, at",
      hallmarks: "id, seq, submissionId",
      audit: "id, at",
      aiLog: "id, at",
      aiCache: "key",
      meta: "key",
    });
  }
}

export const db = new AssayDB();

export const TABLES = [
  "kits",
  "rulebooks",
  "submissions",
  "versions",
  "checks",
  "findings",
  "comments",
  "approvals",
  "hallmarks",
  "audit",
  "aiLog",
  "aiCache",
  "meta",
] as const;

export type TableName = (typeof TABLES)[number];

export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);
