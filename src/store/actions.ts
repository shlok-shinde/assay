// Every workflow step as one function: intake, check, fix, review, approve,
// Hallmark, Brand Kit editing and publishing, export, import and reset.
// Each step appends to the audit log.
import type {
  AICacheEntry,
  BrandKit,
  Channel,
  Finding,
  FindingStatus,
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
import { applyFixes, intentCheck, intentVerdict } from "@/engine/fix";
import { hashJson, sha256Hex } from "@/engine/hash";
import { GENESIS, sealHallmark, verifyHallmark } from "@/engine/hallmark";
import { pipelineAi, aiStatus, aiTask } from "@/lib/ai-client";
import { DEMO_PEOPLE, VELVRA_KIT } from "@/seed/velvra";
import { seededHistory } from "@/seed/history";
import seededCache from "@/seed/ai-cache.json";
import { db, nowIso, todayIso, uid, TABLES } from "./db";

export const KIT_ID = "velvra";

export const personFor = (role: Role) => DEMO_PEOPLE[role].name;

export async function audit(role: Role, action: string, target: string, details?: string) {
  await db.audit.add({ id: uid("a"), at: nowIso(), actor: personFor(role), role, action, target, details });
}

// ---- Seed, reset, role --------------------------------------------------

let seeding: Promise<void> | null = null;

export function ensureSeeded(): Promise<void> {
  seeding ??= (async () => {
    const done = await db.meta.get("seededAt");
    if (done) return;
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
      await db.meta.put({ key: "seededAt", value: nowIso() });
    });
  })().finally(() => {
    seeding = null;
  });
  return seeding;
}

export async function resetDemo() {
  await db.transaction("rw", TABLES.map((t) => db[t]), async () => {
    await Promise.all(TABLES.map((t) => db[t].clear()));
  });
  await ensureSeeded();
}

export async function setRole(role: Role) {
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
  const versionId = uid("v");
  await db.versions.add({
    id: versionId,
    submissionId: id,
    n: 1,
    text: input.text,
    source: input.source,
    pages: input.pages,
    image: input.image,
    createdAt: at,
    author: creator,
    note: input.source.fileName ? `Uploaded ${input.source.fileName}` : "Draft pasted",
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
    visualMemo.set(
      key,
      import("@/engine/visual").then((m) => m.analyzeImage(image, kit)),
    );
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
    image: version.image,
    ai: kit.confidential ? null : await pipelineAi(),
    cache: cacheStore,
    visual: visualCheck,
  };
}

/** Gives a raw finding its id; a decision already made on an earlier version carries over to the same issue. */
function stamp(f: RawFinding, previous: Finding[], ids: { checkId: string; submissionId: string; versionId: string }): Finding {
  const prior = previous.find((p) => p.ruleId === f.ruleId && p.quote.toLowerCase() === f.quote.toLowerCase() && CARRY.includes(p.status));
  return { ...f, id: uid("f"), ...ids, status: prior?.status ?? "open", resolution: prior?.resolution };
}

const sameIssue = (a: RawFinding, b: RawFinding) => a.ruleId === b.ruleId && a.start === b.start && a.end === b.end && a.quote.toLowerCase() === b.quote.toLowerCase();

/**
 * Stores the rule checks (and any cached AI results) at once, then runs the AI for the paragraphs that
 * changed in the background (resumeAi), so nobody waits on a slow model to see the rule findings.
 */
export async function checkVersion(submissionId: string, versionId: string): Promise<string> {
  const sub = (await db.submissions.get(submissionId))!;
  const input = await checkInput(submissionId, versionId);
  const startedAt = nowIso();
  const out = await runCheck({ ...input, deferAi: true });

  const previous = await db.findings.where("submissionId").equals(submissionId).filter((f) => f.versionId !== versionId).toArray();
  const checkId = uid("chk");
  const findings = out.findings.map((f) => stamp(f, previous, { checkId, submissionId, versionId }));
  await db.transaction("rw", [db.checks, db.findings, db.submissions], async () => {
    // Open findings on older versions are replaced by this check.
    await db.findings
      .where("submissionId")
      .equals(submissionId)
      .filter((f) => f.versionId !== versionId && (f.status === "open" || f.status === "reopened"))
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
  await audit("creator", "ran check", submissionId, `${findings.length} findings, ${out.mode}, ${out.ms} ms${out.aiPending ? ", AI judgment running" : ""}`);
  if (out.aiPending) void resumeAi(checkId);
  return checkId;
}

const inflight = new Map<string, Promise<void>>();

/** Runs (or joins) the AI pass of a check whose rule checks are already stored. */
export function resumeAi(checkId: string): Promise<void> {
  let p = inflight.get(checkId);
  if (!p) {
    p = completeAi(checkId)
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
  const out = await runCheck(await checkInput(submissionId, versionId));
  const aiMs = Math.round(performance.now() - t0);

  let added = 0;
  await db.transaction("rw", [db.checks, db.findings, db.versions], async () => {
    // A newer version or check replaced this one while the AI ran: its findings no longer count.
    const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
    const newest = (await db.checks.where("versionId").equals(versionId).toArray()).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop();
    if (versions[versions.length - 1]?.id !== versionId || newest?.id !== checkId) {
      await db.checks.update(checkId, { aiPending: false });
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
        const nf = stamp(f, previous, { checkId, submissionId, versionId });
        fresh.push(nf);
        order.push(nf.id);
        continue;
      }
      used.add(match.id);
      order.push(match.id);
      if (match.status === "open") await db.findings.put({ ...f, id: match.id, checkId, submissionId, versionId, status: "open" });
    }
    for (const s of stored) {
      if (used.has(s.id)) continue;
      if (s.status === "open") await db.findings.delete(s.id);
      else order.push(s.id);
    }
    if (fresh.length) await db.findings.bulkAdd(fresh);
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
  await audit("creator", "AI judgment finished", submissionId, `${out.mode === "rules+ai" ? `${added} new finding${added === 1 ? "" : "s"}` : out.banner ?? out.mode}, ${aiMs} ms`);
}

// ---- Findings -----------------------------------------------------------

export async function resolveFinding(findingId: string, status: FindingStatus, role: Role, opts: { reason?: string; editedText?: string } = {}) {
  const f = (await db.findings.get(findingId))!;
  if (status === "dismissed" && f.severity === "high" && role === "creator") {
    throw new Error("High-severity findings need a reviewer or Compliance to dismiss them.");
  }
  await db.findings.update(findingId, {
    status,
    resolution: { by: personFor(role), role, reason: opts.reason, at: nowIso(), editedText: opts.editedText },
  });
  await audit(role, `finding ${status.replace(/_/g, " ")}`, f.submissionId, `${f.ruleId}${opts.reason ? `: ${opts.reason}` : ""}`);
}

export async function reopenFinding(findingId: string, role: Role, reason: string) {
  const f = (await db.findings.get(findingId))!;
  await db.findings.update(findingId, { status: "reopened", resolution: { by: personFor(role), role, reason, at: nowIso() } });
  await db.submissions.update(f.submissionId, { status: "changes_requested", updatedAt: nowIso() });
  await audit(role, "reopened finding", f.submissionId, `${f.ruleId}: ${reason}`);
}

/** Findings accepted or edited on the current version but not yet applied. */
export const isStaged = (f: Finding) => (f.status === "accepted" || f.status === "edited") && !!f.fix && f.fix.kind !== "manual" && f.start >= 0;

export function blockers(findings: Finding[]) {
  const openHigh = findings.filter((f) => f.severity === "high" && (f.status === "open" || f.status === "reopened"));
  const staged = findings.filter(isStaged);
  return { openHigh, staged, canSubmit: openHigh.length === 0 && staged.length === 0 };
}

export async function applyStagedFixes(submissionId: string): Promise<string> {
  const sub = (await db.submissions.get(submissionId))!;
  const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
  const current = versions[versions.length - 1];
  const staged = (await db.findings.where("versionId").equals(current.id).toArray()).filter(isStaged);
  if (!staged.length) throw new Error("No accepted fixes to apply.");
  const result = applyFixes(
    current.text,
    staged.map((f) => ({ id: f.id, start: f.start, end: f.end, fix: f.fix, editedText: f.status === "edited" ? f.resolution?.editedText : undefined })),
  );
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
    note: `Applied ${result.applied.length} fix${result.applied.length === 1 ? "" : "es"}${result.conflicts.length ? `; ${result.conflicts.length} skipped (overlapping)` : ""}`,
    intentCheck: intentVerdict(heuristic),
    appliedFindingIds: result.applied,
  });
  for (const fid of result.conflicts) await db.findings.update(fid, { status: "open" });
  await audit("creator", "applied fixes", submissionId, `v${current.n + 1}: ${heuristic.summary}`);
  await Promise.all([
    checkVersion(submissionId, id),
    aiIntent?.then((r) => (r.ok ? db.versions.update(id, { intentCheck: intentVerdict(heuristic, { ...r.data, model: r.model }) }) : undefined)),
  ]);
  return id;
}

export async function saveEditedVersion(submissionId: string, text: string, image?: ImageAsset) {
  const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
  const current = versions[versions.length - 1];
  const id = uid("v");
  await db.versions.add({
    id,
    submissionId,
    n: current.n + 1,
    text,
    source: { kind: "edit" },
    image: image ?? current.image,
    createdAt: nowIso(),
    author: personFor("creator"),
    note: image && image !== current.image ? "Updated the creative" : "Edited the draft",
  });
  await audit("creator", "edited draft", submissionId, `v${current.n + 1}`);
  await checkVersion(submissionId, id);
  return id;
}

// ---- Review -------------------------------------------------------------

export async function submitForReview(submissionId: string) {
  const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
  const current = versions[versions.length - 1];
  const findings = await db.findings.where("versionId").equals(current.id).toArray();
  const check = (await db.checks.where("versionId").equals(current.id).toArray()).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop();
  if (!check || check.aiPending) throw new Error("The check on this version is still running; submit when it finishes.");
  if (!blockers(findings).canSubmit) throw new Error("Resolve or route every high-severity finding first.");
  await db.submissions.update(submissionId, { status: "in_review", updatedAt: nowIso() });
  // Claim findings always go to Compliance, including claims the creator already fixed in an earlier version.
  const all = await db.findings.where("submissionId").equals(submissionId).toArray();
  const claims = all.filter(
    (x) => x.category === "claim" && ((x.versionId === current.id && x.status === "open") || (x.versionId !== current.id && (x.status === "accepted" || x.status === "edited"))),
  );
  for (const f of claims) await db.findings.update(f.id, { status: "sent_to_compliance" });
  await audit("creator", "submitted for review", submissionId, `v${current.n}`);
}

export async function complianceDecision(findingId: string, approve: boolean, note: string) {
  if (approve) await resolveFinding(findingId, "compliance_approved", "compliance", { reason: note || "Claim approved" });
  else await reopenFinding(findingId, "compliance", note || "Claim not approved");
}

export async function addComment(submissionId: string, role: Role, text: string, findingId?: string) {
  await db.comments.add({ id: uid("c"), submissionId, findingId, author: personFor(role), role, text, at: nowIso() });
  await audit(role, "commented", submissionId, findingId ? `on a finding` : undefined);
}

export async function hallmarkContent(v: Version): Promise<string> {
  return v.image ? `${v.text}\n\n[image ${v.image.fileName} sha256:${await sha256Hex(v.image.dataUrl)} alt:${JSON.stringify(v.image.alt)}]` : v.text;
}

/** Findings on the current version that nobody has fixed, decided or routed. */
export const stillOpen = (findings: Finding[]) => findings.filter((f) => f.status === "open" || f.status === "reopened");

/**
 * Approving writes a Hallmark, so it never passes over an open finding silently: each one needs the
 * reviewer's reason (`waiveReason`), which is stored on the finding and sealed into the Hallmark.
 */
export async function reviewerDecision(submissionId: string, approve: boolean, note: string, waiveReason?: string): Promise<string | null> {
  const sub = (await db.submissions.get(submissionId))!;
  const versions = await db.versions.where("submissionId").equals(submissionId).sortBy("n");
  const current = versions[versions.length - 1];
  let findings = (await db.findings.where("submissionId").equals(submissionId).toArray()).filter((f) => f.status !== "superseded");
  if (approve) {
    if (findings.some((f) => f.status === "sent_to_compliance")) throw new Error("Compliance still has claims to decide.");
    const open = stillOpen(findings);
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
  const all = await db.hallmarks.orderBy("seq").toArray();
  const prev = all[all.length - 1];
  const content = await hallmarkContent(current);
  const issuedAt = nowIso();
  const hallmark = await sealHallmark(
    {
      submissionId,
      title: sub.title,
      versionId: current.id,
      versionN: current.n,
      contentHash: await sha256Hex(content),
      rulebookVersion: rb.version,
      rulebookHash: rb.hash,
      findings: findings
        .filter((f) => f.status !== "superseded")
        .map((f) => ({ id: f.id, ruleId: f.ruleId, severity: f.severity, status: f.status, reason: f.resolution?.reason, by: f.resolution?.by })),
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
    uid("hm"),
    (prev?.seq ?? 0) + 1,
  );
  await db.hallmarks.add(hallmark);
  await db.submissions.update(submissionId, { status: "approved", updatedAt: issuedAt });
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

export async function publishRulebook(notes: string): Promise<string> {
  const kit = await getKit();
  const rb = await latestRulebook();
  const [major, minor] = rb.version.split(".").map(Number);
  const version = `${major}.${minor + 1}`;
  const snapshot = kitContent(kit);
  snapshot.rules = snapshot.rules.filter((r) => !r.pending);
  await db.rulebooks.add({
    id: `rb_${version}`,
    kitId: KIT_ID,
    version,
    publishedAt: nowIso(),
    publishedBy: personFor("admin"),
    notes,
    hash: await hashJson(snapshot),
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
  let parsed: { app?: string; format?: number; data?: Record<string, unknown[]> };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (parsed.app !== "assay" || parsed.format !== 1 || !parsed.data) throw new Error("That file is not an Assay workspace export.");
  await db.transaction("rw", TABLES.map((t) => db[t]), async () => {
    for (const t of TABLES) {
      await db[t].clear();
      const rows = parsed.data![t];
      if (Array.isArray(rows)) await (db[t] as unknown as { bulkPut: (r: unknown[]) => Promise<unknown> }).bulkPut(rows);
    }
  });
}

export type { Submission };
