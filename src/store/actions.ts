// Every workflow step as one function: intake, check, fix, review, approve,
// Hallmark, Brand Kit editing and publishing, export, import and reset.
// Each step appends to the audit log.
import type {
  AICacheEntry,
  BrandKit,
  Channel,
  Finding,
  FindingStatus,
  FixEvent,
  Hallmark,
  HallmarkBody,
  ImageAsset,
  IntentCard,
  KitContent,
  PageSpan,
  Role,
  Rule,
  RulebookVersion,
  Submission,
  Version,
} from "@/lib/types";
import { runCheck, type CacheStore, type CheckInput } from "@/engine/pipeline";
import type { RawFinding } from "@/engine/types";
import { applyFixPlan, fixIntent, intentCheck, intentVerdict, planFixes, validateMerge, type ConflictChoice, type FixPlan } from "@/engine/fix";
import { alertsDue, clarifiedRule, editShare, ownerId } from "@/engine/health";
import { sentences } from "@/engine/text";
import { canonicalJson, hashJson, sha256Hex } from "@/engine/hash";
import { GENESIS, sealHallmark, verifyHallmark } from "@/engine/hallmark";
import { pipelineAi, aiStatus, aiTask, peopleNames } from "@/lib/ai-client";
import { INPUT_CAP } from "@/lib/ai-tasks";
import { candidateToRule, draftBookRules, type BookPage } from "@/lib/import";
import { draftReportMarkdown } from "@/lib/report";
import { findingMoveProblem, isDeletable, isEditable, submissionMoveProblem } from "@/lib/policy";
import { DEMO_PEOPLE, VELVRA_KIT } from "@/seed/velvra";
import { seededHistory } from "@/seed/history";
import { starterKit } from "@/seed/starter";
import seededCache from "@/seed/ai-cache.json";
import { activeBrand } from "./brands";
import { db, nowIso, todayIso, uid, withLock, TABLES } from "./db";
import { readWorkspaceFile } from "./workspace-file";

/** The kit this page is working on. Fixed for the life of the page: switching brand reloads. */
export const KIT_ID = activeBrand().kitId;

/** On a team workspace, everything is done under the signed-in person's name. */
export const personFor = (role: Role) => activeBrand().team?.name ?? DEMO_PEOPLE[role].name;

export async function audit(role: Role, action: string, target: string, details?: string) {
  await db.audit.add({ id: uid("a"), at: nowIso(), actor: personFor(role), role, action, target, details });
}

// ---- Seed, reset, role --------------------------------------------------

let seeding: Promise<void> | null = null;

/** Raised whenever a browser seeded by an earlier build needs new seed rows. A fresh seed starts here. */
const SEED_REVISION = 2;

/** What each revision adds to a workspace seeded before it. Each step only adds, and never touches a person's work. */
const SEED_STEPS: Record<number, () => Promise<void>> = { 2: seedOwners };

/** One owner per team named in the Claim Ledger. Demo addresses are marked simulated and never receive mail. */
async function seedOwners() {
  if (!activeBrand().demo) return;
  const known = new Set(await db.owners.toCollection().primaryKeys());
  const names = [...new Set(VELVRA_KIT.facts.map((f) => f.owner))];
  await db.owners.bulkPut(
    names
      .filter((name) => !known.has(ownerId(name)))
      .map((name) => ({ id: ownerId(name), name, email: `${ownerId(name)}@velvra.example`, simulated: true })),
  );
}

async function upgradeSeed() {
  const from = ((await db.meta.get("seedRevision"))?.value as number | undefined) ?? 1;
  for (let rev = from + 1; rev <= SEED_REVISION; rev++) await SEED_STEPS[rev]?.();
  if (from < SEED_REVISION) await db.meta.put({ key: "seedRevision", value: SEED_REVISION });
}

/** A new brand: the starter rules as version 1.0, its Brand Admin at the desk, no demo history. */
async function seedStarter() {
  const brand = activeBrand();
  const snapshot = starterKit(brand.name);
  const hash = await hashJson(snapshot);
  await db.transaction("rw", [db.kits, db.rulebooks, db.meta], async () => {
    await db.kits.put({ id: KIT_ID, ...structuredClone(snapshot), confidential: false, updatedAt: nowIso() });
    await db.rulebooks.put({ id: "rb_1.0", kitId: KIT_ID, version: "1.0", publishedAt: nowIso(), publishedBy: "Set-up", notes: "Starter rules", hash, snapshot });
    await db.meta.put({ key: "role", value: "admin" });
    await db.meta.put({ key: "seedRevision", value: SEED_REVISION });
    await db.meta.put({ key: "seededAt", value: nowIso() });
  });
}

export function ensureSeeded(): Promise<void> {
  seeding ??= (async () => {
    const brand = activeBrand();
    if (brand.team) {
      const { bootstrapWorkspace, startSync } = await import("./team");
      // Only the first admin, on an empty workspace, writes the starter rulebook. Everyone else receives it.
      if (!(await bootstrapWorkspace())) {
        if (brand.team.role !== "admin") throw new Error("This workspace has no rulebook yet. Ask its Brand Admin to open it once, then try again.");
        await seedStarter();
      }
      startSync();
      return;
    }
    const done = await db.meta.get("seededAt");
    if (done) {
      await upgradeSeed();
      scheduleBlobMigration();
      return;
    }
    if (!activeBrand().demo) return seedStarter();
    // Everything async that is not IndexedDB (the SHA-256 via Web Crypto) runs before the
    // transaction: awaiting it inside lets IndexedDB commit early (TransactionInactiveError).
    const kit: BrandKit = { id: KIT_ID, ...structuredClone(VELVRA_KIT), confidential: false, updatedAt: nowIso() };
    const snapshot = structuredClone(VELVRA_KIT);
    const hash = await hashJson(snapshot);
    const h = seededHistory();
    await db.transaction("rw", [db.kits, db.rulebooks, db.submissions, db.findings, db.audit, db.aiCache, db.meta], async () => {
      await db.kits.put(kit);
      await db.rulebooks.put({
        id: "rb_3.2",
        kitId: KIT_ID,
        version: "3.2",
        publishedAt: "2026-09-01T09:00:00.000Z",
        publishedBy: "Kabir (brand admin)",
        notes: "Imported from Velvra Brand Book v3 (seeded demo rulebook).",
        hash,
        snapshot,
      });
      await db.submissions.bulkPut(h.submissions);
      await db.findings.bulkPut(h.findings);
      await db.audit.bulkPut(h.audit);
      await db.aiCache.bulkPut((seededCache as AICacheEntry[]).map((e) => ({ ...e, seeded: true })));
      await db.meta.put({ key: "role", value: "creator" });
      await db.meta.put({ key: "seedRevision", value: SEED_REVISION });
      await db.meta.put({ key: "seededAt", value: nowIso() });
    });
    await seedOwners();
  })().finally(() => {
    seeding = null;
  });
  return seeding;
}

export async function resetDemo() {
  if (activeBrand().team) throw new Error("A team workspace can't be reset from here. A Brand Admin can export or delete it.");
  await db.transaction("rw", TABLES.map((t) => db[t]), async () => {
    await Promise.all(TABLES.map((t) => db[t].clear()));
  });
  await ensureSeeded();
}

export async function setRole(role: Role) {
  if (activeBrand().team && activeBrand().team!.role !== "admin" && role !== activeBrand().team!.role) throw new Error("Your role in this workspace is set by its Brand Admin.");
  await db.meta.put({ key: "role", value: role });
}

export async function markJudgeStep(step: string) {
  const current = ((await db.meta.get("judgePath"))?.value as string[] | undefined) ?? [];
  if (!current.includes(step)) await db.meta.put({ key: "judgePath", value: [...current, step] });
}

// ---- Rulebook -----------------------------------------------------------

export async function latestRulebook(): Promise<RulebookVersion> {
  const all = await db.rulebooks.orderBy("publishedAt").toArray();
  return all[all.length - 1];
}

export async function getKit(): Promise<BrandKit> {
  return (await db.kits.get(KIT_ID))!;
}

// ---- Stored files -------------------------------------------------------

/** Moves a creative into the blobs table. The row keeps everything except the file itself. */
async function storeImage(image: ImageAsset): Promise<ImageAsset> {
  if (!image.dataUrl) return image;
  const hash = await sha256Hex(image.dataUrl);
  await db.blobs.put({ hash, dataUrl: image.dataUrl, at: nowIso() });
  return { ...image, dataUrl: "", blob: hash };
}

/** A version's image with its file back in place, for anything that shows or tests the pixels. */
export async function hydrateImage(image: ImageAsset): Promise<ImageAsset>;
export async function hydrateImage(image: ImageAsset | undefined): Promise<ImageAsset | undefined>;
export async function hydrateImage(image: ImageAsset | undefined): Promise<ImageAsset | undefined> {
  if (!image || image.dataUrl || !image.blob) return image;
  const row = await db.blobs.get(image.blob);
  return row ? { ...image, dataUrl: row.dataUrl } : image;
}

/**
 * Moves creatives out of version rows written before the blobs table existed. Safe to run repeatedly
 * and to interrupt: each row moves in its own transaction, and readers accept both shapes. The hash
 * is taken outside the transaction, because awaiting Web Crypto inside would let IndexedDB commit early.
 */
export async function migrateBlobs(): Promise<number> {
  let moved = 0;
  for (const id of await db.versions.toCollection().primaryKeys()) {
    const v = await db.versions.get(id);
    if (!v?.image?.dataUrl) continue;
    const { dataUrl } = v.image;
    const hash = await sha256Hex(dataUrl);
    await db.transaction("rw", [db.versions, db.blobs], async () => {
      await db.blobs.put({ hash, dataUrl, at: nowIso() });
      await db.versions.update(id, { image: { ...v.image!, dataUrl: "", blob: hash } });
    });
    moved++;
  }
  return moved;
}

function scheduleBlobMigration() {
  if (typeof window === "undefined") return;
  const run = () => void migrateBlobs().catch((e) => console.warn("Creative storage will retry on the next visit.", e));
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 500);
}

// ---- Intake -------------------------------------------------------------

export interface NewSubmission {
  title: string;
  channel: Channel;
  audience: string;
  campaign: string;
  agency?: string;
  text: string;
  pages?: PageSpan[];
  image?: ImageAsset;
  source: Version["source"];
  intent: IntentCard;
  sampleId?: string;
}

export async function createSubmission(input: NewSubmission): Promise<string> {
  const rb = await latestRulebook();
  const id = uid("sub");
  const at = nowIso();
  const creator = personFor("creator");
  const image = input.image && (await storeImage(input.image));
  const versionId = uid("v");
  // One transaction: a full disk can't leave a draft with no version behind.
  await db.transaction("rw", [db.submissions, db.versions], async () => {
    await db.submissions.add({
      id,
      title: input.title,
      channel: input.channel,
      audience: input.audience,
      campaign: input.campaign,
      creator,
      agency: input.agency,
      status: "draft",
      intent: input.intent,
      rulebookVersion: rb.version,
      createdAt: at,
      updatedAt: at,
      sampleId: input.sampleId,
    });
    await db.versions.add({
      id: versionId,
      submissionId: id,
      n: 1,
      text: input.text,
      source: input.source,
      pages: input.pages,
      image,
      createdAt: at,
      author: creator,
      note: input.source.fileName ? `Uploaded ${input.source.fileName}` : "Draft pasted",
    });
  });
  await audit("creator", "created draft", id, input.title);
  return id;
}

// ---- Checking -----------------------------------------------------------

const cacheStore: CacheStore = {
  async get(key) {
    const e = await db.aiCache.get(key);
    return e ? { data: e.data as never, model: e.model, at: e.at, seeded: e.seeded } : undefined;
  },
  async set(key, data, model) {
    await db.aiCache.put({ key, task: "judge", model, at: nowIso(), data });
  },
};

const visualMemo = new Map<string, Promise<import("@/engine/visual").VisualReport>>();

async function visualCheck(image: ImageAsset, kit: KitContent) {
  const key = await hashJson({ img: await sha256Hex(image.dataUrl), alt: image.alt, logo: image.logoBox, kit: await hashJson(kit) });
  if (!visualMemo.has(key)) {
    const report = import("@/engine/visual").then((m) => m.analyzeImage(image, kit));
    visualMemo.set(key, report);
    // Only a real reading is remembered, so a failed OCR gets another try on the next run.
    const forget = () => void visualMemo.delete(key);
    void report.then((r) => (r.ocr === "failed" ? forget() : undefined), forget);
  }
  return visualMemo.get(key)!;
}

const CARRY: FindingStatus[] = ["dismissed", "contested", "sent_to_compliance", "compliance_approved"];

async function checkInput(submissionId: string, versionId: string): Promise<CheckInput> {
  const sub = (await db.submissions.get(submissionId))!;
  const version = (await db.versions.get(versionId))!;
  const kit = await getKit();
  const rb = (await db.rulebooks.where("kitId").equals(KIT_ID).toArray()).find((r) => r.version === sub.rulebookVersion) ?? (await latestRulebook());
  return {
    text: version.text,
    channel: sub.channel,
    audience: sub.audience,
    intent: sub.intent,
    kit: rb.snapshot,
    rulebookVersion: rb.version,
    confidential: kit.confidential,
    today: todayIso(),
    pages: version.pages,
    image: await hydrateImage(version.image),
    ai: kit.confidential ? null : await pipelineAi(),
    cache: cacheStore,
    names: await peopleNames(),
    visual: visualCheck,
  };
}

/** Gives a raw finding its id; a decision already made on an earlier version carries over to the same issue. */
function stamp(f: RawFinding, previous: Finding[], ids: { checkId: string; submissionId: string; versionId: string }, text: string, intent: IntentCard): Finding {
  const samePlace = (p: Finding) => p.ruleId === f.ruleId && p.quote.toLowerCase() === f.quote.toLowerCase();
  const prior = previous.find((p) => samePlace(p) && CARRY.includes(p.status));
  // A fix that lost out to another on the same words is still the person's decision, and now it can apply.
  const waiting = previous.find((p) => samePlace(p) && p.notApplied && f.fix && f.fix.kind !== "manual");
  const carried = prior ?? waiting;
  const stamped: Finding = { ...f, id: uid("f"), ...ids, status: carried?.status ?? "open", resolution: carried?.resolution, contest: prior?.contest };
  return hasInlineFix(stamped) ? { ...stamped, intentCheck: fixIntent(text, withEdit(stamped), intent) } : stamped;
}

const hasInlineFix = (f: Finding) => !!f.fix && f.fix.kind !== "manual" && f.start >= 0;
const withEdit = (f: Finding) => ({ id: f.id, start: f.start, end: f.end, fix: f.fix, editedText: f.status === "edited" ? f.resolution?.editedText : undefined });
const planInput = (f: Finding) => ({ ...withEdit(f), ruleId: f.ruleId, quote: f.quote, severity: f.severity, category: f.category, origin: f.origin, factId: f.factId });

/** Recorded on each fix offered and each decision on it, for the acceptance rate. Test browsers mark theirs. */
async function fixEvent(f: Finding, kind: FixEvent["kind"], role: Role, share?: number) {
  await db.events.add({
    id: uid("ev"),
    at: nowIso(),
    kind,
    ruleId: f.ruleId,
    findingId: f.id,
    submissionId: f.submissionId,
    role,
    editShare: share,
    automated: typeof navigator !== "undefined" && navigator.webdriver ? true : undefined,
  });
}

const DRAFT_GONE = "This draft no longer exists.";

const sameCreative = (a: ImageAsset | undefined, b: ImageAsset | undefined) => a?.blob === b?.blob && a?.alt === b?.alt && JSON.stringify(a?.logoBox) === JSON.stringify(b?.logoBox);

const FIX_EVENT: Partial<Record<FindingStatus, FixEvent["kind"]>> = { accepted: "accepted", edited: "edited", dismissed: "dismissed", contested: "contested", open: "undone" };

const sameIssue = (a: RawFinding, b: RawFinding) => a.ruleId === b.ruleId && a.start === b.start && a.end === b.end && a.quote.toLowerCase() === b.quote.toLowerCase();

/**
 * Stores the rule checks (and any cached AI results) at once, then runs the AI for the paragraphs that
 * changed in the background (resumeAi), so nobody waits on a slow model to see the rule findings.
 */
export async function checkVersion(submissionId: string, versionId: string): Promise<string> {
  const sub = await db.submissions.get(submissionId);
  if (!sub || !(await db.versions.get(versionId))) throw new Error(DRAFT_GONE);
  const input = await checkInput(submissionId, versionId);
  const startedAt = nowIso();
  const out = await runCheck({ ...input, deferAi: true });

  const previous = await db.findings.where("submissionId").equals(submissionId).filter((f) => f.versionId !== versionId).toArray();
  const checkId = uid("chk");
  const findings = out.findings.map((f) => stamp(f, previous, { checkId, submissionId, versionId }, input.text, sub.intent));
  await db.transaction("rw", [db.checks, db.findings, db.submissions, db.versions], async () => {
    // The workspace was reset or the draft deleted while this ran: storing the result would leave orphans.
    if (!(await db.versions.get(versionId))) throw new Error(DRAFT_GONE);
    // Open findings on older versions are replaced by this check. A claim Compliance sent back stays:
    // a new version doesn't answer Compliance, so it goes back to them on the next submit.
    await db.findings
      .where("submissionId")
      .equals(submissionId)
      .filter((f) => f.versionId !== versionId && (f.status === "open" || (f.status === "reopened" && f.resolution?.role !== "compliance")))
      .modify({ status: "superseded" });
    await db.findings.where("versionId").equals(versionId).delete();
    await db.findings.bulkAdd(findings);
    await db.checks.add({
      id: checkId,
      submissionId,
      versionId,
      rulebookVersion: input.rulebookVersion,
      mode: out.mode,
      banner: out.banner,
      startedAt,
      ms: out.ms,
      aiCalls: out.aiCalls,
      aiModel: out.aiModel,
      redactions: out.redactions,
      segmentsTotal: out.segmentsTotal,
      segmentsReused: out.segmentsReused,
      dropped: out.dropped,
      relocated: out.relocated,
      claims: out.claims,
      findingIds: findings.map((f) => f.id),
      aiPending: out.aiPending || undefined,
    });
    if (sub.status === "draft" || sub.status === "changes_requested") await db.submissions.update(submissionId, { status: "checked", updatedAt: nowIso() });
  });
  await Promise.all(findings.filter(hasInlineFix).map((f) => fixEvent(f, "offered", "creator")));
  await audit("creator", "ran check", submissionId, `${findings.length} findings, ${out.mode}, ${out.ms} ms${out.aiPending ? ", AI judgment running" : ""}`);
  if (out.aiPending) void resumeAi(checkId);
  else void checkFixIntents(checkId);
  return checkId;
}

/** Tries the AI pass again on a check that fell back to rule checks, or read only part of a long draft. */
export async function retryAi(checkId: string): Promise<void> {
  const check = await db.checks.get(checkId);
  if (!check || check.aiPending || check.mode === "confidential") return;
  await aiStatus(true);
  await db.checks.update(checkId, { aiPending: true, mode: "rules+ai", banner: undefined });
  await resumeAi(checkId);
}

/** Runs the check on a draft whose last version never got one, because it failed or the tab closed. A version that has a check keeps it, and the decisions on it. */
export function runMissingCheck(submissionId: string): Promise<string> {
  return withLock(`check:${submissionId}`, async () => {
    const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
    const current = versions[versions.length - 1];
    if (!current) throw new Error(DRAFT_GONE);
    const done = (await db.checks.where("versionId").equals(current.id).toArray()).pop();
    return done?.id ?? checkVersion(submissionId, current.id);
  });
}

const inflight = new Map<string, Promise<void>>();

/** Runs (or joins) the AI pass of a check whose rule checks are already stored. */
export function resumeAi(checkId: string): Promise<void> {
  let p = inflight.get(checkId);
  if (!p) {
    p = completeAi(checkId)
      .then(() => void checkFixIntents(checkId))
      .catch(() => db.checks.update(checkId, { aiPending: false, mode: "rules-only", banner: "The AI service is unavailable right now. Showing rule checks only." }).then(() => undefined))
      .finally(() => inflight.delete(checkId));
    inflight.set(checkId, p);
  }
  return p;
}

async function completeAi(checkId: string) {
  const check = await db.checks.get(checkId);
  if (!check?.aiPending) return;
  const { submissionId, versionId } = check;
  const t0 = performance.now();
  const input = await checkInput(submissionId, versionId);
  const out = await runCheck(input);
  const aiMs = Math.round(performance.now() - t0);

  const sub = await db.submissions.get(submissionId);
  if (!sub) return;
  const offered: Finding[] = [];
  let added = 0;
  let replaced = false;
  await db.transaction("rw", [db.checks, db.findings, db.versions], async () => {
    // A newer version or check replaced this one while the AI ran: its findings no longer count.
    const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
    const newest = (await db.checks.where("versionId").equals(versionId).toArray()).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop();
    if (versions[versions.length - 1]?.id !== versionId || newest?.id !== checkId) {
      await db.checks.update(checkId, { aiPending: false });
      replaced = true;
      return;
    }
    // Same issue: keep the stored finding (and any decision on it), refresh an open one's wording.
    // New issue: add it. An open finding the AI pass no longer produces is replaced.
    const stored = await db.findings.where("versionId").equals(versionId).toArray();
    const previous = await db.findings.where("submissionId").equals(submissionId).filter((f) => f.versionId !== versionId).toArray();
    const used = new Set<string>();
    const order: string[] = [];
    const fresh: Finding[] = [];
    for (const f of out.findings) {
      const match = stored.find((s) => !used.has(s.id) && sameIssue(s, f));
      if (!match) {
        const nf = stamp(f, previous, { checkId, submissionId, versionId }, input.text, sub.intent);
        fresh.push(nf);
        order.push(nf.id);
        continue;
      }
      used.add(match.id);
      order.push(match.id);
      if (match.status === "open") await db.findings.put({ ...f, id: match.id, checkId, submissionId, versionId, status: "open", intentCheck: match.intentCheck });
    }
    for (const s of stored) {
      if (used.has(s.id)) continue;
      if (s.status === "open") await db.findings.delete(s.id);
      else order.push(s.id);
    }
    if (fresh.length) await db.findings.bulkAdd(fresh);
    offered.push(...fresh.filter(hasInlineFix));
    added = fresh.length;
    await db.checks.update(checkId, {
      mode: out.mode,
      banner: out.banner,
      aiCalls: check.aiCalls + out.aiCalls,
      aiModel: out.aiModel,
      redactions: out.redactions,
      segmentsReused: out.segmentsReused,
      dropped: out.dropped,
      relocated: out.relocated,
      claims: out.claims,
      findingIds: order,
      aiPending: false,
      aiMs,
    });
  });
  if (replaced) return;
  await Promise.all(offered.map((f) => fixEvent(f, "offered", "creator")));
  await audit("creator", "AI judgment finished", submissionId, `${out.mode === "rules+ai" ? `${added} new finding${added === 1 ? "" : "s"}` : out.banner ?? out.mode}, ${aiMs} ms`);
}

// ---- Intent on every fix ------------------------------------------------

/** The sentence around a fix, before and after it, which is all the AI needs to read to judge it. */
function fixSentence(text: string, f: Finding) {
  const fix = withEdit(f);
  const start = fix.fix?.range?.start ?? f.start;
  const end = fix.fix?.range?.end ?? f.end;
  const s = sentences(text).find((x) => x.start <= start && x.end >= end) ?? { start, end };
  const inner = text.slice(s.start, start) + (fix.editedText ?? fix.fix!.replacement) + text.slice(end, s.end);
  return { before: text.slice(s.start, s.end).slice(0, 700), after: inner.slice(0, 700) };
}

const BATCH = 10;
const BATCH_CHARS = 7000;

/**
 * Adds the AI's reading to the term check already stored on each fix. It runs after the rule findings and AI
 * judgment have landed, is cached, and never holds anything up: without it the term check stands.
 */
export async function checkFixIntents(checkId: string): Promise<void> {
  const check = await db.checks.get(checkId);
  if (!check) return;
  const [sub, version, kit, status] = await Promise.all([db.submissions.get(check.submissionId), db.versions.get(check.versionId), getKit(), aiStatus()]);
  if (!sub || !version || kit.confidential || !status?.aiConfigured) return;
  const intent = { goal: sub.intent.goal, keyMessage: sub.intent.keyMessage, cta: sub.intent.cta };
  const todo = (await db.findings.where("versionId").equals(check.versionId).toArray()).filter((f) => hasInlineFix(f) && !f.intentCheck?.ai && f.intentCheck?.verdict !== "unchecked");
  const items = todo.map((f) => ({ f, item: { id: f.id, rule: `${f.ruleId}: ${f.title}`.slice(0, 200), ...fixSentence(version.text, f) } }));
  while (items.length) {
    const chunk: typeof items = [];
    let chars = 0;
    while (items.length && chunk.length < BATCH && chars + items[0].item.before.length + items[0].item.after.length + items[0].item.rule.length < BATCH_CHARS) {
      const next = items.shift()!;
      chars += next.item.before.length + next.item.after.length + next.item.rule.length;
      chunk.push(next);
    }
    if (!chunk.length) break;
    // The key leaves out the finding IDs, which change on each check, so a re-check of the same words reuses the answer.
    const key = `intentBatch:${await hashJson({ intent, fixes: chunk.map(({ item: { id: _id, ...rest } }) => rest) })}`;
    const hit = await db.aiCache.get(key);
    let results = (hit?.data as { results: { index: number; kept: boolean; explanation: string }[] } | undefined)?.results;
    let model = hit?.model;
    if (!results) {
      const r = await aiTask("intentCheckBatch", { intent, fixes: chunk.map((c) => c.item) });
      if (!r.ok) return;
      model = r.model;
      results = r.data.results.flatMap((x) => {
        const index = chunk.findIndex((c) => c.f.id === x.id);
        return index >= 0 ? [{ index, kept: x.kept, explanation: x.explanation }] : [];
      });
      await db.aiCache.put({ key, task: "intentCheckBatch", model: r.model, at: nowIso(), data: { results } });
    }
    for (const x of results) {
      const f = chunk[x.index]?.f;
      if (!f) continue;
      const fresh = await db.findings.get(f.id);
      if (!fresh || fresh.status === "edited") continue;
      const heuristic = intentCheck(version.text, applyFixPlan(version.text, [planInput(f)], { conflicts: [], composed: [] }).text, sub.intent);
      await db.findings.update(f.id, { intentCheck: intentVerdict(heuristic, { kept: x.kept, explanation: x.explanation, model: model ?? "" }) });
    }
  }
}

// ---- Findings -----------------------------------------------------------

async function guardFindingMove(f: Finding, to: FindingStatus, role: Role) {
  const sub = (await db.submissions.get(f.submissionId))!;
  const problem = findingMoveProblem({ role, from: f.status, to, severity: f.severity, submissionStatus: sub.status });
  if (problem) throw new Error(problem);
}

export async function resolveFinding(findingId: string, status: FindingStatus, role: Role, opts: { reason?: string; editedText?: string; intentOverride?: string } = {}) {
  const f = (await db.findings.get(findingId))!;
  // A double click, or a second tab, asking for what already happened.
  if (f.status === status) return;
  await guardFindingMove(f, status, role);
  const at = nowIso();
  // An edit gets its own check: the words being accepted aren't the ones the check read earlier.
  let intent = f.intentCheck;
  if (status === "edited" && opts.editedText !== undefined) {
    const [sub, version] = await Promise.all([db.submissions.get(f.submissionId), db.versions.get(f.versionId)]);
    if (sub && version) intent = fixIntent(version.text, { ...withEdit(f), editedText: opts.editedText }, sub.intent);
  }
  if ((status === "accepted" || status === "edited") && intent?.verdict === "lost" && !opts.intentOverride?.trim()) {
    throw new Error("The intent check says this fix loses the message. Give a reason to accept it anyway.");
  }
  await db.findings.update(findingId, {
    status,
    resolution: { by: personFor(role), role, reason: opts.reason, at, editedText: opts.editedText },
    contest: status === "contested" ? { by: personFor(role), reason: opts.reason, at } : status === "open" ? undefined : f.contest,
    intentCheck: intent,
    intentOverride: opts.intentOverride?.trim() ? { by: personFor(role), reason: opts.intentOverride.trim(), at } : status === "open" ? undefined : f.intentOverride,
    notApplied: undefined,
  });
  const kind = hasInlineFix(f) ? FIX_EVENT[status] : undefined;
  if (kind) await fixEvent(f, kind, role, status === "edited" ? editShare(f.fix!.replacement, opts.editedText ?? "") : undefined);
  await audit(role, `finding ${status.replace(/_/g, " ")}`, f.submissionId, `${f.ruleId}${opts.reason ? `: ${opts.reason}` : ""}`);
}

export async function reopenFinding(findingId: string, role: Role, reason: string) {
  const f = (await db.findings.get(findingId))!;
  if (f.status === "reopened") return;
  await guardFindingMove(f, "reopened", role);
  await db.findings.update(findingId, { status: "reopened", resolution: { by: personFor(role), role, reason, at: nowIso() } });
  await db.submissions.update(f.submissionId, { status: "changes_requested", updatedAt: nowIso() });
  await audit(role, "reopened finding", f.submissionId, `${f.ruleId}: ${reason}`);
}

/** Findings accepted or edited on the current version but not yet applied. */
export const isStaged = (f: Finding) => (f.status === "accepted" || f.status === "edited") && !!f.fix && f.fix.kind !== "manual" && f.start >= 0;

/**
 * Findings from earlier versions sent back after the current version was made. Nothing on screen can
 * answer them except a new version, so they hold the draft until there is one.
 */
export const awaitingRework = (earlier: Finding[], current: Version) =>
  earlier.filter((f) => f.status === "reopened" && f.versionId !== current.id && (f.resolution?.at ?? "") >= current.createdAt);

export function blockers(findings: Finding[], rework: Finding[] = []) {
  const openHigh = findings.filter((f) => f.severity === "high" && (f.status === "open" || f.status === "reopened"));
  const staged = findings.filter(isStaged);
  return { openHigh, staged, rework, canSubmit: openHigh.length === 0 && staged.length === 0 && rework.length === 0 };
}

/** How this draft's accepted fixes fit together: what composes, and what needs a choice. */
export async function stagedFixPlan(submissionId: string): Promise<FixPlan> {
  const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
  const current = versions[versions.length - 1];
  if (!current) return { conflicts: [], composed: [] };
  const sub = (await db.submissions.get(submissionId))!;
  const rb = (await db.rulebooks.toArray()).find((r) => r.version === sub.rulebookVersion) ?? (await latestRulebook());
  const staged = (await db.findings.where("versionId").equals(current.id).toArray()).filter(isStaged);
  return planFixes(current.text, staged.map(planInput), { kit: rb.snapshot, channel: sub.channel, today: todayIso() });
}

/** Asks the AI to word a merge the code couldn't, and accepts it only if it passes the same validation. */
export async function aiMergeFixes(submissionId: string, conflictId: string): Promise<{ text: string; explanation: string; model: string } | { problem: string }> {
  const sub = (await db.submissions.get(submissionId))!;
  const kit = await getKit();
  if (kit.confidential) return { problem: "This workspace is confidential, so nothing is sent to the AI." };
  const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
  const current = versions[versions.length - 1];
  const staged = (await db.findings.where("versionId").equals(current.id).toArray()).filter(isStaged);
  const plan = await stagedFixPlan(submissionId);
  const conflict = plan.conflicts.find((c) => c.id === conflictId);
  if (!conflict) return { problem: "These fixes no longer overlap." };
  const r = await aiTask("mergeFixes", {
    intent: { goal: sub.intent.goal, keyMessage: sub.intent.keyMessage, cta: sub.intent.cta },
    before: conflict.before.slice(0, 1500),
    fixes: conflict.options.map((o) => ({ rule: o.ruleId, text: o.text.slice(0, 700) })),
  });
  if (!r.ok) return { problem: "The AI could not suggest a merge just now. Pick one of the fixes, or write your own." };
  const rb = (await db.rulebooks.toArray()).find((x) => x.version === sub.rulebookVersion) ?? (await latestRulebook());
  const after = current.text.slice(0, conflict.start) + r.data.text + current.text.slice(conflict.end);
  const check = validateMerge(current.text, after, staged.filter((f) => conflict.ids.includes(f.id)).map(planInput), { kit: rb.snapshot, channel: sub.channel, today: todayIso() });
  if (!check.ok) return { problem: `The AI's merge was rejected. ${check.problems[0]}` };
  return { text: r.data.text, explanation: r.data.explanation, model: r.model };
}

export async function applyStagedFixes(submissionId: string, choices: Record<string, ConflictChoice> = {}): Promise<string> {
  // The lock covers reading the newest version through adding the next, so two tabs can't both make v3.
  const { id, n, heuristic, aiIntent } = await withLock(`version:${submissionId}`, () => addFixedVersion(submissionId, choices));
  await audit("creator", "applied fixes", submissionId, `v${n}: ${heuristic.summary}`);
  await Promise.all([
    checkVersion(submissionId, id),
    aiIntent?.then((r) => (r.ok ? db.versions.update(id, { intentCheck: intentVerdict(heuristic, { ...r.data, model: r.model }) }) : undefined)),
  ]);
  return id;
}

async function addFixedVersion(submissionId: string, choices: Record<string, ConflictChoice>) {
  const sub = (await db.submissions.get(submissionId))!;
  if (!isEditable(sub.status)) throw new Error("This draft is with its reviewers, so it cannot be changed here.");
  const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
  const current = versions[versions.length - 1];
  const staged = (await db.findings.where("versionId").equals(current.id).toArray()).filter(isStaged);
  if (!staged.length) throw new Error("No accepted fixes to apply.");
  const input = staged.map(planInput);
  const plan = planFixes(current.text, input);
  const result = applyFixPlan(current.text, input, plan, choices);
  const together = plan.composed.filter((s) => s.ids.every((fid) => result.applied.includes(fid))).length;
  const heuristic = intentCheck(current.text, result.text, sub.intent);
  const kit = await getKit();
  // The AI's reading of the intent runs alongside the re-check; the version shows the term check until it lands.
  const aiIntent =
    !kit.confidential && (await aiStatus())?.aiConfigured
      ? aiTask("intentCheck", {
          before: current.text.slice(0, 3900),
          after: result.text.slice(0, 3900),
          intent: { goal: sub.intent.goal, keyMessage: sub.intent.keyMessage, cta: sub.intent.cta },
          changes: staged
            .filter((f) => result.applied.includes(f.id))
            .map((f) => ({ rule: `${f.ruleId}: ${f.title}`.slice(0, 200), before: f.quote.slice(0, 500), after: (f.resolution?.editedText ?? f.fix?.replacement ?? "").slice(0, 500) })),
        })
      : null;
  const id = uid("v");
  await db.versions.add({
    id,
    submissionId,
    n: current.n + 1,
    text: result.text,
    source: { kind: "fix" },
    pages: undefined,
    image: current.image,
    createdAt: nowIso(),
    author: personFor("creator"),
    note: `Applied ${result.applied.length} fix${result.applied.length === 1 ? "" : "es"}${together ? `; ${together} sentence${together === 1 ? "" : "s"} took several fixes, read together` : ""}${result.conflicts.length ? `; ${result.conflicts.length} kept for the next version (overlapping)` : ""}`,
    intentCheck: intentVerdict(heuristic),
    appliedFindingIds: result.applied,
  });
  // Fixes that lost out keep their decision and edited text; the re-check below carries them to the new version.
  for (const fid of result.conflicts) await db.findings.update(fid, { notApplied: { reason: "Another fix changed the same words", at: nowIso() } });
  return { id, n: current.n + 1, heuristic, aiIntent };
}

export async function saveEditedVersion(submissionId: string, text: string, image?: ImageAsset) {
  const nextImage = image ? await storeImage(image) : undefined;
  const added = await withLock(`version:${submissionId}`, async () => {
    const sub = (await db.submissions.get(submissionId))!;
    if (!isEditable(sub.status)) throw new Error("This draft is with its reviewers, so it cannot be changed here.");
    const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
    const current = versions[versions.length - 1];
    const kept = nextImage ?? current.image;
    if (!text.trim() && !kept) throw new Error("A draft needs some text or a creative.");
    // Saving twice, or from a second tab, with nothing different is not a new version.
    if (text === current.text && sameCreative(kept, current.image)) return { sub, current, id: current.id, unchanged: true };
    const id = uid("v");
    await db.versions.add({
      id,
      submissionId,
      n: current.n + 1,
      text,
      source: { kind: "edit" },
      image: kept,
      createdAt: nowIso(),
      author: personFor("creator"),
      note: image ? (image.dataUrl && image.blob !== current.image?.blob ? "Replaced the creative" : "Updated the creative") : "Edited the draft",
    });
    return { sub, current, id, unchanged: false };
  });
  if (added.unchanged) return added.id;
  const { sub, current, id } = added;
  await audit("creator", "edited draft", submissionId, `v${current.n + 1}`);
  // A hand edit can lose the message too, so it gets the same check a fix does.
  const heuristic = intentCheck(current.text, text, sub.intent);
  const kit = await getKit();
  await db.versions.update(id, { intentCheck: intentVerdict(heuristic) });
  const aiIntent =
    text !== current.text && heuristic.checked && !kit.confidential && (await aiStatus())?.aiConfigured
      ? aiTask("intentCheck", { before: current.text.slice(0, 3900), after: text.slice(0, 3900), intent: { goal: sub.intent.goal, keyMessage: sub.intent.keyMessage, cta: sub.intent.cta } })
      : null;
  await Promise.all([checkVersion(submissionId, id), aiIntent?.then((r) => (r.ok ? db.versions.update(id, { intentCheck: intentVerdict(heuristic, { ...r.data, model: r.model }) }) : undefined))]);
  return id;
}

// ---- Review -------------------------------------------------------------

export function submitForReview(submissionId: string) {
  return withLock(`decision:${submissionId}`, () => submit(submissionId));
}

async function submit(submissionId: string) {
  const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
  const current = versions[versions.length - 1];
  const findings = await db.findings.where("versionId").equals(current.id).toArray();
  const check = (await db.checks.where("versionId").equals(current.id).toArray()).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop();
  if (!check || check.aiPending) throw new Error("The check on this version is still running; submit when it finishes.");
  const sub = (await db.submissions.get(submissionId))!;
  if (sub.status === "in_review") return;
  const problem = submissionMoveProblem("creator", sub.status, "in_review");
  if (problem) throw new Error(problem);
  const all = await db.findings.where("submissionId").equals(submissionId).toArray();
  const earlier = all.filter((f) => f.versionId !== current.id);
  const rework = awaitingRework(earlier, current);
  if (rework.length) throw new Error(`Compliance sent back ${rework.map((f) => f.ruleId).join(", ")}. Edit the draft so a new version answers them, then submit again.`);
  if (!blockers(findings).canSubmit) throw new Error("Resolve or route every high-severity finding first.");
  await db.submissions.update(submissionId, { status: "in_review", updatedAt: nowIso() });
  // Claim findings always go to Compliance: open or contested ones on this version, and claims fixed
  // or sent back on an earlier version. A claim sent back that still fires is the current finding's
  // to answer, so its older copy retires instead of reaching Compliance twice.
  const sentBack = earlier.filter((x) => x.status === "reopened");
  const stillFires = (x: Finding) => findings.some((f) => f.ruleId === x.ruleId && f.quote.toLowerCase() === x.quote.toLowerCase());
  const claims = [
    ...findings.filter((x) => x.category === "claim" && (x.status === "open" || x.status === "reopened" || x.status === "contested")),
    ...earlier.filter((x) => x.category === "claim" && (x.status === "accepted" || x.status === "edited")),
    ...sentBack.filter((x) => !stillFires(x)),
  ];
  for (const f of claims) await db.findings.update(f.id, { status: "sent_to_compliance" });
  for (const f of sentBack.filter(stillFires)) await db.findings.update(f.id, { status: "superseded" });
  await audit("creator", "submitted for review", submissionId, `v${current.n}`);
}

export async function complianceDecision(findingId: string, approve: boolean, note: string) {
  if (approve) await resolveFinding(findingId, "compliance_approved", "compliance", { reason: note || "Claim approved" });
  else await reopenFinding(findingId, "compliance", note || "Claim not approved");
}

export async function addComment(submissionId: string, role: Role, text: string, findingId?: string) {
  if (!text.trim()) throw new Error("Write something to post.");
  const author = personFor(role);
  const recent = await db.comments.where("submissionId").equals(submissionId).filter((c) => c.author === author && c.text === text && c.findingId === findingId && Date.now() - Date.parse(c.at) < 5000).count();
  if (recent) return;
  await db.comments.add({ id: uid("c"), submissionId, findingId, author: personFor(role), role, text, at: nowIso() });
  await audit(role, "commented", submissionId, findingId ? `on a finding` : undefined);
}

export async function hallmarkContent(v: Version): Promise<string> {
  if (!v.image) return v.text;
  // The blob key is the same sha256 of the data URL that Round 2 sealed, so old Hallmarks still verify.
  const hash = v.image.blob ?? (await sha256Hex(v.image.dataUrl));
  return `${v.text}\n\n[image ${v.image.fileName} sha256:${hash} alt:${JSON.stringify(v.image.alt)}]`;
}

/**
 * Findings that nobody has fixed, decided or routed. A contest on a high-severity finding is an
 * objection, not a decision: only a reviewer or Compliance can clear it, so it counts as open here.
 */
export const stillOpen = (findings: Finding[]) => findings.filter((f) => f.status === "open" || f.status === "reopened" || (f.status === "contested" && f.severity === "high"));

/**
 * Approving writes a Hallmark, so it never passes over an open finding silently: each one needs the
 * reviewer's reason (`waiveReason`), which is stored on the finding and sealed into the Hallmark.
 */
export function reviewerDecision(submissionId: string, approve: boolean, note: string, waiveReason?: string): Promise<string | null> {
  // Hallmark numbers and links are per workspace, so every decision queues on the same lock.
  return withLock("decision", () => decide(submissionId, approve, note, waiveReason));
}

async function decide(submissionId: string, approve: boolean, note: string, waiveReason?: string): Promise<string | null> {
  const sub = (await db.submissions.get(submissionId))!;
  const moveProblem = submissionMoveProblem("reviewer", sub.status, approve ? "approved" : "changes_requested");
  if (moveProblem) throw new Error(moveProblem);
  const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
  const current = versions[versions.length - 1];
  let findings = (await db.findings.where("submissionId").equals(submissionId).toArray()).filter((f) => f.status !== "superseded");
  if (approve) {
    if (findings.some((f) => f.status === "sent_to_compliance")) throw new Error("Compliance still has claims to decide.");
    // A contest on an older version was answered by the version after it.
    const open = stillOpen(findings.filter((f) => f.versionId === current.id || f.status !== "contested"));
    if (open.length && !waiveReason?.trim()) {
      throw new Error(`${open.length} finding${open.length === 1 ? " is" : "s are"} still open. Request changes, or give a reason to approve with ${open.length === 1 ? "it" : "them"} open.`);
    }
    for (const f of open) await resolveFinding(f.id, "waived", "reviewer", { reason: waiveReason!.trim() });
    if (open.length) findings = (await db.findings.where("submissionId").equals(submissionId).toArray()).filter((f) => f.status !== "superseded");
  }
  await db.approvals.add({
    id: uid("ap"),
    submissionId,
    versionId: current.id,
    role: "reviewer",
    by: personFor("reviewer"),
    decision: approve ? "approved" : "changes_requested",
    note,
    at: nowIso(),
  });
  if (!approve) {
    await db.submissions.update(submissionId, { status: "changes_requested", updatedAt: nowIso() });
    if (note) await addComment(submissionId, "reviewer", note);
    await audit("reviewer", "requested changes", submissionId, note);
    return null;
  }

  const rb = (await db.rulebooks.toArray()).find((r) => r.version === sub.rulebookVersion) ?? (await latestRulebook());
  const checks = await db.checks.where("submissionId").equals(submissionId).toArray();
  const approvals = await db.approvals.where("submissionId").equals(submissionId).toArray();
  const content = await hallmarkContent(current);
  const issuedAt = nowIso();
  const contentHash = await sha256Hex(content);
  /** Sealed from the newest record there is. On a team, that can change between sealing and the server's answer. */
  const sealOn = async (): Promise<{ body: HallmarkBody; seq: number }> => {
    const all = await db.hallmarks.orderBy("seq").toArray();
    const prev = all[all.length - 1];
    return {
      seq: (prev?.seq ?? 0) + 1,
      body: {
        submissionId,
        title: sub.title,
        versionId: current.id,
        versionN: current.n,
        contentHash,
        rulebookVersion: rb.version,
        rulebookHash: rb.hash,
        findings: findings
          .filter((f) => f.status !== "superseded")
          .map((f) => ({ id: f.id, ruleId: f.ruleId, severity: f.severity, status: f.status, reason: f.resolution?.reason, by: f.resolution?.by, intentOverride: f.intentOverride?.reason })),
        approvals: [
          ...findings
            .filter((f) => f.status === "compliance_approved")
            .map((f) => ({ role: "compliance" as Role, by: f.resolution!.by, decision: `claim ${f.ruleId} approved`, at: f.resolution!.at })),
          ...approvals.filter((a) => a.decision === "approved").map((a) => ({ role: a.role, by: a.by, decision: a.decision, at: a.at })),
        ],
        ai: {
          models: [...new Set(checks.map((c) => c.aiModel).filter((m): m is string => !!m))],
          calls: checks.reduce((n, c) => n + c.aiCalls, 0),
          redactions: checks.reduce((n, c) => n + c.redactions, 0),
          mode: checks[checks.length - 1]?.mode ?? "rules-only",
        },
        prevHash: prev?.hash ?? GENESIS,
        issuedAt,
      },
    };
  };
  let hallmark: Hallmark | null = null;
  const hallmarkId = uid("hm");
  if (activeBrand().team) {
    // The server numbers it, one at a time across the team. Losing that race means sealing again on the newer record.
    const { claimHallmark } = await import("./team");
    for (let attempt = 0; attempt < 4 && !hallmark; attempt++) hallmark = await claimHallmark((await sealOn()).body, hallmarkId);
    if (!hallmark) throw new Error("Other Hallmarks kept being issued first. Try again.");
  } else {
    const { body, seq } = await sealOn();
    hallmark = await sealHallmark(body, hallmarkId, seq);
    const local = hallmark;
    await db.transaction("rw", [db.hallmarks, db.submissions], async () => {
      await db.hallmarks.add(local);
      await db.submissions.update(submissionId, { status: "approved", updatedAt: issuedAt });
    });
  }
  if (note) await addComment(submissionId, "reviewer", note);
  await audit("reviewer", "approved and wrote Hallmark", submissionId, `Hallmark #${hallmark.seq}`);
  return hallmark.id;
}

export async function verifyHallmarkById(id: string) {
  const h = (await db.hallmarks.get(id))!;
  const v = (await db.versions.get(h.versionId))!;
  const prev = h.seq > 1 ? await db.hallmarks.where("seq").equals(h.seq - 1).first() : undefined;
  return verifyHallmark(h, await hallmarkContent(v), prev);
}

// ---- Brand Kit ----------------------------------------------------------

export async function updateKit(patch: Partial<BrandKit>, what: string) {
  await db.kits.update(KIT_ID, { ...patch, updatedAt: nowIso() });
  await audit("admin", "edited Brand Kit", KIT_ID, what);
}

export async function upsertRule(rule: Rule) {
  const kit = await getKit();
  const rules = kit.rules.some((r) => r.id === rule.id) ? kit.rules.map((r) => (r.id === rule.id ? rule : r)) : [...kit.rules, rule];
  await updateKit({ rules }, `rule ${rule.id}`);
}

export async function deleteRule(id: string) {
  const kit = await getKit();
  await updateKit({ rules: kit.rules.filter((r) => r.id !== id) }, `deleted rule ${id}`);
}

const kitContent = (k: BrandKit): KitContent => {
  const { id: _id, confidential: _c, updatedAt: _u, ...content } = k;
  return structuredClone(content);
};

export async function unpublishedChanges(): Promise<boolean> {
  const [kit, rb] = await Promise.all([getKit(), latestRulebook()]);
  return (await hashJson(kitContent(kit))) !== rb.hash;
}

const nextVersion = (rb: RulebookVersion) => {
  const [major, minor] = rb.version.split(".").map(Number);
  return `${major}.${minor + 1}`;
};

export interface ClarificationDraft {
  text: string;
  dos: string[];
  donts: string[];
  rationale: string;
  /** "AI draft (model)", or who wrote it. */
  draftedBy: string;
}

/** What publishing a clarification will do, for the preview shown before the click. */
export async function clarificationPreview(ruleId: string, draft: ClarificationDraft) {
  const rb = await latestRulebook();
  const before = rb.snapshot.rules.find((r) => r.id === ruleId);
  if (!before) throw new Error(`${ruleId} is not in rulebook v${rb.version}.`);
  const after = clarifiedRule(before, draft);
  const subs = await db.submissions.filter((s) => !s.seeded).toArray();
  return {
    before,
    after,
    version: nextVersion(rb),
    /** Drafts in progress keep the rulebook they started on. */
    pinned: subs.filter((s) => s.status !== "approved").map((s) => ({ id: s.id, title: s.title, rulebookVersion: s.rulebookVersion })),
    /** Rewording a rule doesn't change the phrases code matches: those findings fire as before. */
    codeUnchanged: before.patterns.length > 0 || before.modes.some((m) => m === "lexical" || m === "structural" || m === "claim" || m === "visual"),
  };
}

/**
 * One click: a new rulebook version that differs from the latest by this one rule. Works from the
 * latest published snapshot, not the Brand Kit draft, so pending imports and other edits don't ship with it.
 */
export function publishClarification(ruleId: string, draft: ClarificationDraft): Promise<string> {
  return withLock("rulebook", () => publishClarified(ruleId, draft));
}

async function publishClarified(ruleId: string, draft: ClarificationDraft): Promise<string> {
  const { before, after, version } = await clarificationPreview(ruleId, draft);
  const rb = await latestRulebook();
  const snapshot = structuredClone(rb.snapshot);
  snapshot.rules = snapshot.rules.map((r) => (r.id === ruleId ? after : r));
  const hash = await hashJson(snapshot);
  const at = nowIso();
  await db.transaction("rw", [db.rulebooks, db.kits], async () => {
    await db.rulebooks.add({
      id: `rb_${version}`,
      kitId: KIT_ID,
      version,
      publishedAt: at,
      publishedBy: personFor("admin"),
      notes: `Clarified ${ruleId}: ${draft.rationale}`.slice(0, 500),
      hash,
      snapshot,
      clarification: { ruleId, before: { text: before.text, dos: before.dos, donts: before.donts }, rationale: draft.rationale, draftedBy: draft.draftedBy, at },
    });
    // The draft kit takes the same wording, so the next full publish doesn't undo this.
    const kit = await db.kits.get(KIT_ID);
    if (kit) await db.kits.update(KIT_ID, { rules: kit.rules.map((r) => (r.id === ruleId ? clarifiedRule(r, draft) : r)), updatedAt: at });
  });
  await audit("admin", "published clarification", KIT_ID, `v${version}: ${ruleId}, drafted by ${draft.draftedBy}`);
  return version;
}

/** The draft kit's fields after a rollback: each thing that differs between the two versions moves back; the rest stays. */
function undoInDraft(kit: BrandKit, from: KitContent, to: KitContent): Partial<KitContent> {
  const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)]) as Set<keyof KitContent>) {
    if (key !== "rules" && !same(from[key], to[key])) patch[key] = structuredClone(to[key]);
  }
  const was = new Map(from.rules.map((r) => [r.id, r]));
  const back = new Map(to.rules.map((r) => [r.id, r]));
  const changed = (id: string) => !same(was.get(id), back.get(id));
  const rules = kit.rules.filter((r) => back.has(r.id) || !changed(r.id)).map((r) => (changed(r.id) ? structuredClone(back.get(r.id)!) : r));
  for (const r of to.rules) if (!rules.some((x) => x.id === r.id)) rules.push(structuredClone(r));
  patch.rules = rules;
  return patch as Partial<KitContent>;
}

/** Undoes a publish by publishing again: a new version with the old snapshot. History is never rewritten. */
export function rollbackRulebook(toVersion: string): Promise<string> {
  return withLock("rulebook", () => rollBack(toVersion));
}

async function rollBack(toVersion: string): Promise<string> {
  const target = (await db.rulebooks.toArray()).find((r) => r.version === toVersion);
  if (!target) throw new Error(`Rulebook v${toVersion} does not exist.`);
  const latest = await latestRulebook();
  const version = nextVersion(latest);
  const snapshot = structuredClone(target.snapshot);
  const at = nowIso();
  await db.transaction("rw", [db.rulebooks, db.kits], async () => {
    await db.rulebooks.add({
      id: `rb_${version}`,
      kitId: KIT_ID,
      version,
      publishedAt: at,
      publishedBy: personFor("admin"),
      notes: `Rolled back to v${toVersion}`,
      hash: target.hash,
      snapshot,
      rolledBackTo: toVersion,
    });
    // The draft takes only what the rollback changed, so edits nobody has published yet survive it.
    const kit = await db.kits.get(KIT_ID);
    if (kit) await db.kits.update(KIT_ID, { ...undoInDraft(kit, latest.snapshot, snapshot), updatedAt: at });
  });
  await audit("admin", "rolled back rulebook", KIT_ID, `v${version} restores v${toVersion}`);
  return version;
}

// ---- Fact-expiry alerts -------------------------------------------------

/**
 * Raises any alert due today, once each. Safe to call repeatedly and from two tabs at once: a duplicate
 * key is checked inside the transaction, so a second caller finds the first one's row.
 */
export async function syncFactAlerts(today = todayIso()): Promise<number> {
  const rb = await latestRulebook();
  if (!rb) return 0;
  const due = alertsDue(rb.snapshot.facts, today);
  let raised = 0;
  await db.transaction("rw", [db.notifications, db.owners], async () => {
    for (const a of due) {
      if (await db.notifications.where("key").equals(a.key).count()) continue;
      const id = ownerId(a.fact.owner);
      // A real brand's owner starts with no address, and the inbox asks for one. Only the demo invents them.
      if (!(await db.owners.get(id))) await db.owners.put(activeBrand().demo ? { id, name: a.fact.owner, email: `${id}@velvra.example`, simulated: true } : { id, name: a.fact.owner, email: "" });
      await db.notifications.add({ id: uid("n"), key: a.key, factId: a.fact.id, ownerId: id, threshold: a.threshold, at: nowIso() });
      raised++;
    }
  });
  return raised;
}

export async function markNotificationRead(id: string) {
  await db.notifications.update(id, { readAt: nowIso() });
}

/** A fact's owner, editable so a real brand can put real addresses in. A real address clears the demo mark. */
export async function saveOwner(id: string, patch: { name?: string; email?: string }) {
  await db.owners.update(id, patch.email === undefined ? patch : { ...patch, simulated: patch.email.endsWith(".example") });
  await audit("admin", "edited fact owner", id, patch.email ? `address changed` : undefined);
}

export function publishRulebook(notes: string): Promise<string> {
  return withLock("rulebook", () => publish(notes));
}

async function publish(notes: string): Promise<string> {
  const kit = await getKit();
  const rb = await latestRulebook();
  const version = nextVersion(rb);
  const snapshot = kitContent(kit);
  snapshot.rules = snapshot.rules.filter((r) => !r.pending);
  if (!snapshot.rules.some((r) => r.active)) throw new Error("A rulebook needs at least one approved, active rule, or every check would pass with nothing to say.");
  const hash = await hashJson(snapshot);
  if (hash === rb.hash) throw new Error(`Nothing has changed since version ${rb.version}.`);
  await db.rulebooks.add({
    id: `rb_${version}`,
    kitId: KIT_ID,
    version,
    publishedAt: nowIso(),
    publishedBy: personFor("admin"),
    notes,
    hash,
    snapshot,
  });
  await audit("admin", "published rulebook", KIT_ID, `v${version}: ${notes}`);
  return version;
}

// ---- Workspace export and import ---------------------------------------

export async function exportWorkspace(): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await db[t].toArray();
  return JSON.stringify({ app: "assay", format: 1, exportedAt: nowIso(), data }, null, 2);
}

export async function importWorkspace(json: string) {
  if (activeBrand().team) throw new Error("Importing would replace your team's work, so it isn't available in a team workspace.");
  // Validate before anything is cleared, so a bad file costs nothing.
  const data = readWorkspaceFile(json, KIT_ID);
  await db.transaction("rw", TABLES.map((t) => db[t]), async () => {
    for (const t of TABLES) {
      await db[t].clear();
      const rows = data[t];
      if (Array.isArray(rows)) await (db[t] as unknown as { bulkPut: (r: unknown[]) => Promise<unknown> }).bulkPut(rows);
    }
  });
  await migrateBlobs();
}

// ---- Deleting a draft ----------------------------------------------------

/** Removes an unreviewed draft and everything hanging off it. Fix events stay: they are an append-only record of real decisions. */
export async function deleteSubmission(submissionId: string) {
  const sub = await db.submissions.get(submissionId);
  if (!sub) return;
  if (sub.seeded) throw new Error("Seeded history feeds Guideline Health, so it can't be deleted one draft at a time. Reset the demo to clear it.");
  if (!isDeletable(sub.status) || (await db.hallmarks.where("submissionId").equals(submissionId).count())) throw new Error("This draft is with its reviewers or has a Hallmark, so it is kept as a record.");
  const versions = await db.versions.where("submissionId").equals(submissionId).toArray();
  await db.transaction("rw", [db.submissions, db.versions, db.checks, db.findings, db.comments, db.approvals, db.blobs], async () => {
    await db.submissions.delete(submissionId);
    await db.versions.where("submissionId").equals(submissionId).delete();
    await db.checks.where("submissionId").equals(submissionId).delete();
    await db.findings.where("submissionId").equals(submissionId).delete();
    await db.comments.where("submissionId").equals(submissionId).delete();
    await db.approvals.where("submissionId").equals(submissionId).delete();
    // A file stays while another draft still points at it (the samples share theirs).
    for (const hash of new Set(versions.map((v) => v.image?.blob).filter((b): b is string => !!b))) {
      if (!(await db.versions.filter((v) => v.image?.blob === hash).count())) await db.blobs.delete(hash);
    }
  });
  await audit("creator", "deleted draft", submissionId, sub.title);
}

// ---- Brand-book import ---------------------------------------------------

export interface BookImportResult {
  rules: number;
  pagesTotal: number;
  pagesByAi: number;
  model?: string;
  rejected: number;
}

/** Reads a brand book into candidate rules that wait for approval, keeping a PDF so each rule's citation can open it at its quote. */
export async function importBrandBook(file: File, onProgress?: (done: number, total: number) => void): Promise<BookImportResult> {
  const { docxText, pdfText, MAX_FILE_BYTES } = await import("@/lib/parse");
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over 10 MB.`);
  const name = file.name.toLowerCase();
  const isPdf = name.endsWith(".pdf");
  if (!isPdf && !name.endsWith(".docx")) throw new Error("Import a PDF or DOCX brand book.");
  const buffer = await file.arrayBuffer();
  let pages: BookPage[];
  if (isPdf) {
    const r = await pdfText(buffer);
    pages = r.pages.map((p) => ({ page: p.page, text: r.text.slice(p.start, p.end) }));
  } else pages = [{ page: 1, text: await docxText(buffer) }];

  const kit = await getKit();
  const ai = !kit.confidential && (await aiStatus())?.aiConfigured;
  const draft = await draftBookRules(
    pages,
    ai
      ? async (batch) => {
          const r = await aiTask("draftRules", { pages: batch });
          return r.ok ? { ok: true, rules: r.data.rules, model: r.model } : { ok: false };
        }
      : null,
    INPUT_CAP - 200,
    onProgress,
  );

  let bookId: string | undefined;
  if (isPdf) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read the file."));
      reader.readAsDataURL(file);
    });
    const hash = await sha256Hex(dataUrl);
    bookId = `book_${hash.slice(0, 16)}`;
    await db.blobs.put({ hash, dataUrl, at: nowIso() });
    await db.books.put({ id: bookId, kitId: KIT_ID, title: file.name, blob: hash, importedAt: nowIso() });
  }

  // Read again: the kit may have changed during a long import. IDs carry on from the highest in use.
  const current = await getKit();
  const highest = current.rules.reduce((n, r) => Math.max(n, /^IMP-(\d+)$/.exec(r.id)?.[1] ? Number(/^IMP-(\d+)$/.exec(r.id)![1]) : 0), 0);
  const rules = draft.candidates.map((c, i) => candidateToRule(c, `IMP-${String(highest + i + 1).padStart(2, "0")}`, file.name, bookId));
  await updateKit({ rules: [...current.rules, ...rules] }, `imported ${rules.length} candidate rules from ${file.name}`);
  return { rules: rules.length, pagesTotal: draft.pagesTotal, pagesByAi: draft.pagesByAi, model: draft.model, rejected: draft.rejected };
}

/** An imported book's PDF as a data URL, for the viewer. */
export async function bookFile(bookId: string): Promise<{ title: string; dataUrl: string } | undefined> {
  const book = await db.books.get(bookId);
  const blob = book?.blob ? await db.blobs.get(book.blob) : undefined;
  return book && blob ? { title: book.title, dataUrl: blob.dataUrl } : undefined;
}

// ---- A draft's report ----------------------------------------------------

/** Everything a person outside Assay would need to see about a draft, as Markdown. */
export async function draftReport(submissionId: string): Promise<{ fileName: string; markdown: string }> {
  const sub = await db.submissions.get(submissionId);
  if (!sub) throw new Error(DRAFT_GONE);
  const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
  const current = versions[versions.length - 1];
  const check = current && (await db.checks.where("versionId").equals(current.id).toArray()).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop();
  const rb = (await db.rulebooks.toArray()).find((r) => r.version === (check?.rulebookVersion ?? sub.rulebookVersion)) ?? (await latestRulebook());
  const markdown = draftReportMarkdown({
    sub,
    versions,
    check,
    findings: current ? await db.findings.where("versionId").equals(current.id).toArray() : [],
    rules: rb.snapshot.rules,
    approvals: await db.approvals.where("submissionId").equals(submissionId).toArray(),
    comments: await db.comments.where("submissionId").equals(submissionId).toArray(),
    hallmark: await db.hallmarks.where("submissionId").equals(submissionId).first(),
    at: nowIso(),
  });
  return { fileName: `${sub.title.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase().slice(0, 60)}-report.md`, markdown };
}

export type { Submission };
