// One workspace per browser, in IndexedDB. Nothing here leaves the browser
// except redacted AI calls.
import Dexie, { type Table } from "dexie";
import type {
  AICacheEntry,
  AICallLog,
  Approval,
  AuditEntry,
  BlobRow,
  BookRow,
  BrandKit,
  Check,
  Comment,
  Finding,
  FixEvent,
  Hallmark,
  NotificationRow,
  Owner,
  RulebookVersion,
  Submission,
  SyncRow,
  Version,
} from "@/lib/types";
import { activeBrand } from "./brands";
import { captureChanges } from "./capture";

export interface Meta {
  key: string;
  value: unknown;
}

/** Fired when another tab needs a newer schema: this tab has closed its connection and must reload. */
export const DB_STALE_EVENT = "assay:db-stale";

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
  blobs!: Table<BlobRow, string>;
  books!: Table<BookRow, string>;
  events!: Table<FixEvent, string>;
  owners!: Table<Owner, string>;
  notifications!: Table<NotificationRow, string>;
  syncRows!: Table<SyncRow, number>;
  syncState!: Table<{ key: string; value: number }, string>;

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
    // Only adds tables, with no unique indexes and no upgrade function: a Round 2 browser's data can't
    // abort it. Moving creatives into blobs runs later, outside the upgrade (migrateBlobs in actions.ts).
    this.version(2).stores({
      blobs: "hash",
      books: "id, kitId",
      events: "id, at, ruleId, findingId, kind",
      owners: "id, email",
      notifications: "id, key, factId, ownerId, at",
      syncRows: "++seq, tbl, rowId",
    });
    // Team workspaces only: the server version each row was last seen at. Adds a table, as version 2 does.
    this.version(3).stores({ syncState: "key" });
    this.on("versionchange", (ev) => {
      this.close({ disableAutoOpen: false });
      if (ev.newVersion && typeof window !== "undefined") window.dispatchEvent(new Event(DB_STALE_EVENT));
      return false;
    });
  }
}

export const db = new AssayDB(activeBrand().dbName);
if (activeBrand().team) captureChanges(db);

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
  "blobs",
  "books",
  "events",
  "owners",
  "notifications",
] as const;

export type TableName = (typeof TABLES)[number];

/** One at a time across tabs for the same brand, where the browser can. Not reentrant: never nest a name inside itself. */
export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks ? (locks.request(`${db.name}:${name}`, fn) as Promise<T>) : fn();
}

export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);
