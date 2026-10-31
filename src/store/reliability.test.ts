// The ways a person actually breaks things: double clicks, a second tab, Reset mid-check, damaged files.
import { beforeEach, describe, expect, it } from "vitest";
import type { Finding } from "@/lib/types";
import { draftRulesInput, judgeInput, INPUT_CAP, textLength } from "@/lib/ai-tasks";
import { draftBookRules, pageBatches, type BookPage } from "@/lib/import";
import { IntakeError, parseFile, MAX_IMAGE_PIXELS } from "@/lib/parse";
import { decodeImage } from "@/engine/visual";
import { runCheck, type AiClient, type CheckInput, type JudgeRequest } from "@/engine/pipeline";
import { redact, redactDeep } from "@/engine/redact";
import { looksNonEnglish } from "@/engine/text";
import { VELVRA_KIT } from "@/seed/velvra";
import { SAMPLES } from "@/seed/samples";
import { GOLDEN } from "../../golden/drafts";
import { db } from "./db";
import {
  addComment,
  applyStagedFixes,
  bookFile,
  checkVersion,
  createSubmission,
  deleteSubmission,
  draftReport,
  exportWorkspace,
  importBrandBook,
  importWorkspace,
  publishRulebook,
  resetDemo,
  resolveFinding,
  reviewerDecision,
  runMissingCheck,
  saveEditedVersion,
  submitForReview,
  updateKit,
  getKit,
  KIT_ID,
} from "./actions";

const INTENT = { goal: "Launch", keyMessage: "Daily Shield is here", cta: "Shop now", confirmed: true, draftedBy: "creator" as const };

async function draft(text: string) {
  return createSubmission({ title: "T", channel: "instagram", audience: "A", campaign: "C", intent: INTENT, text, source: { kind: "paste" } });
}

const latest = async (id: string) => (await db.versions.where("submissionId").equals(id).sortBy("n")).pop()!;
const check = async (id: string) => {
  const v = await latest(id);
  await checkVersion(id, v.id);
  return v;
};

beforeEach(async () => {
  await resetDemo();
});

describe("Bad input", () => {
  it("refuses empty and blank text files, so they can't wipe what was pasted", async () => {
    await expect(parseFile(new File([], "empty.txt", { type: "text/plain" }))).rejects.toBeInstanceOf(IntakeError);
    await expect(parseFile(new File(["  \n "], "blank.txt", { type: "text/plain" }))).rejects.toThrow(/no text/);
  });

  it("refuses an image past the pixel cap, and says how big it is", async () => {
    const side = Math.ceil(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
    const canvas = new OffscreenCanvas(side, side);
    canvas.getContext("2d")!.fillRect(0, 0, 1, 1);
    const file = new File([await canvas.convertToBlob({ type: "image/png" })], "huge.png", { type: "image/png" });
    await expect(parseFile(file)).rejects.toThrow(/40 megapixels/);
  });

  it("reads a transparent PNG as sitting on white, not black", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 4;
    const px = await decodeImage(canvas.toDataURL("image/png"));
    expect([...px.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  });

  it("refuses a blank edit, and saving with nothing different makes no new version", async () => {
    const id = await draft("Meet Daily Shield.");
    const v = await check(id);
    await expect(saveEditedVersion(id, "   ")).rejects.toThrow(/some text/);
    expect(await saveEditedVersion(id, v.text)).toBe(v.id);
    expect(await db.versions.where("submissionId").equals(id).count()).toBe(1);
  });

  it("notices a draft that isn't in English, without crying wolf on English ones", () => {
    expect(looksNonEnglish("यह एक नया उत्पाद है जो आपकी त्वचा की रक्षा करता है और हर दिन काम आता है")).toBe(true);
    expect(looksNonEnglish("Nuestro nuevo protector solar cuida tu piel cada día con una fórmula ligera que no deja rastro blanco en ningún tono")).toBe(true);
    const wrong = [...GOLDEN.map((d) => d.text), ...SAMPLES.map((s) => s.text ?? "")].filter(looksNonEnglish);
    expect(wrong).toEqual([]);
  });
});

describe("Workspace files", () => {
  const exported = async () => JSON.parse(await exportWorkspace());

  it("leaves the workspace alone when the file is damaged, and says where", async () => {
    const id = await draft("Meet Daily Shield.");
    const file = await exported();
    file.data.versions[0].n = "one";
    await expect(importWorkspace(JSON.stringify(file))).rejects.toThrow(/data\.versions\.0\.n/);
    expect(await db.submissions.get(id)).toBeTruthy();
  });

  it("refuses non-JSON, other files, and another brand's export", async () => {
    await expect(importWorkspace("nope")).rejects.toThrow(/not valid JSON/);
    await expect(importWorkspace('{"app":"other"}')).rejects.toThrow(/not an Assay/);
    const file = await exported();
    file.data.kits[0].id = "someone-else";
    await expect(importWorkspace(JSON.stringify(file))).rejects.toThrow(/another brand/);
    expect(await db.kits.get(KIT_ID)).toBeTruthy();
  });

  it("still takes its own export, whole", async () => {
    const id = await draft("Meet Daily Shield.");
    await importWorkspace(await exportWorkspace());
    expect(await db.submissions.get(id)).toBeTruthy();
  });
});

describe("Repeated attempts", () => {
  it("two approvals at once write one Hallmark", async () => {
    const id = await draft("Meet Daily Shield, a light gel for every day.");
    await check(id);
    await submitForReview(id);
    const results = await Promise.allSettled([reviewerDecision(id, true, "ok", "reason"), reviewerDecision(id, true, "ok", "reason")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.hallmarks.count()).toBe(1);
  });

  it("two applies at once make one version", async () => {
    const id = await draft("OMG our new Daily Shield is here!!! Shop now.");
    const v = await check(id);
    const fixable = (await db.findings.where("versionId").equals(v.id).toArray()).filter((f: Finding) => f.fix && f.fix.kind !== "manual" && f.start >= 0);
    expect(fixable.length).toBeGreaterThan(0);
    for (const f of fixable) await resolveFinding(f.id, "accepted", "creator");
    await Promise.allSettled([applyStagedFixes(id), applyStagedFixes(id)]);
    const ns = (await db.versions.where("submissionId").equals(id).toArray()).map((x) => x.n).sort();
    expect(ns).toEqual([1, 2]);
  });

  it("the same comment twice in a row posts once, and a blank one not at all", async () => {
    const id = await draft("Meet Daily Shield.");
    await addComment(id, "reviewer", "Tighten this");
    await addComment(id, "reviewer", "Tighten this");
    await expect(addComment(id, "reviewer", "  ")).rejects.toThrow();
    expect(await db.comments.where("submissionId").equals(id).count()).toBe(1);
  });

  it("publishing refuses an unchanged or empty rulebook", async () => {
    await expect(publishRulebook("again")).rejects.toThrow(/Nothing has changed/);
    await updateKit({ acronyms: [...(await getKit()).acronyms, "ZZZ"] }, "edit");
    const v = await publishRulebook("real");
    expect(v).toBe("3.3");
    await expect(publishRulebook("twice")).rejects.toThrow(/Nothing has changed/);
    await updateKit({ rules: (await getKit()).rules.map((r) => ({ ...r, active: false })) }, "edit");
    await expect(publishRulebook("empty")).rejects.toThrow(/at least one/);
  });
});

describe("Leaving part way", () => {
  it("Reset during a check leaves nothing behind", async () => {
    const id = await draft("Meet Daily Shield.");
    const v = await latest(id);
    const running = checkVersion(id, v.id).catch((e: Error) => e.message);
    await resetDemo();
    await running;
    expect(await db.checks.where("submissionId").equals(id).count()).toBe(0);
    expect(await db.findings.where("submissionId").equals(id).count()).toBe(0);
  });

  it("a draft whose check never ran can run it, and one that has a check keeps it", async () => {
    const id = await draft("OMG our new Daily Shield is here!!!");
    const first = await runMissingCheck(id);
    expect(await db.checks.get(first)).toBeTruthy();
    expect(await runMissingCheck(id)).toBe(first);
  });
});

describe("Deleting a draft", () => {
  it("removes the draft and what hangs off it, and keeps the fix events", async () => {
    const id = await draft("OMG our new Daily Shield is here!!!");
    await check(id);
    const events = await db.events.filter((e) => e.submissionId === id).count();
    expect(events).toBeGreaterThan(0);
    await deleteSubmission(id);
    expect(await db.submissions.get(id)).toBeUndefined();
    expect(await db.versions.where("submissionId").equals(id).count()).toBe(0);
    expect(await db.findings.where("submissionId").equals(id).count()).toBe(0);
    expect(await db.events.filter((e) => e.submissionId === id).count()).toBe(events);
  });

  it("a creative stays while another draft still uses it", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const image = { dataUrl, width: 1, height: 1, alt: "", fileName: "a.png" };
    const make = () => createSubmission({ title: "T", channel: "instagram", audience: "A", campaign: "C", intent: INTENT, text: "", image, source: { kind: "image" } });
    const [a, b] = [await make(), await make()];
    expect(await db.blobs.count()).toBe(1);
    await deleteSubmission(a);
    expect(await db.blobs.count()).toBe(1);
    await deleteSubmission(b);
    expect(await db.blobs.count()).toBe(0);
  });

  it("refuses a draft with reviewers on it, an approved one, and seeded history", async () => {
    const id = await draft("Meet Daily Shield, a light gel for every day.");
    await check(id);
    await submitForReview(id);
    await expect(deleteSubmission(id)).rejects.toThrow(/kept as a record/);
    await reviewerDecision(id, true, "ok", "reason");
    await expect(deleteSubmission(id)).rejects.toThrow(/kept as a record/);
    const seeded = await db.submissions.filter((s) => !!s.seeded).first();
    await expect(deleteSubmission(seeded!.id)).rejects.toThrow(/Seeded/);
  });
});

describe("What reaches the AI", () => {
  const input = (text: string, ai: AiClient, kit = VELVRA_KIT): CheckInput => ({ text, channel: "email", audience: "A", intent: INTENT, kit, rulebookVersion: "3.2", confidential: false, today: "2026-10-31", ai, cache: null });
  const client = (seen: JudgeRequest[], fail?: number): AiClient => ({
    async judge(req) {
      seen.push(req);
      if (fail !== undefined && seen.length > fail) return { ok: false, reason: "rate_limited", message: "busy" };
      return { ok: true, data: { findings: [], factChoices: [] }, model: "test", ms: 1, redactions: 0 };
    },
  });
  const para = (n: number) => `Paragraph ${n} says our daily gel suits every morning routine and sits lightly under makeup. `.repeat(12);

  it("splits a long draft into calls the route accepts, and says how far it got", async () => {
    const seen: JudgeRequest[] = [];
    const out = await runCheck(input(Array.from({ length: 40 }, (_, i) => para(i)).join("\n\n"), client(seen)));
    expect(seen.length).toBe(3);
    for (const req of seen) {
      expect(judgeInput.safeParse(req).success).toBe(true);
      expect(textLength(req)).toBeLessThanOrEqual(INPUT_CAP);
    }
    expect(out.mode).toBe("rules+ai");
    expect(out.banner).toMatch(/The AI read \d+ of 40/);
  });

  it("a service that stops part way keeps what it finished, and says so", async () => {
    const seen: JudgeRequest[] = [];
    const out = await runCheck(input(Array.from({ length: 40 }, (_, i) => para(i)).join("\n\n"), client(seen, 1)));
    expect(out.mode).toBe("rules+ai");
    expect(out.banner).toMatch(/before the service stopped answering/);
  });

  it("a short draft is still one call, with no banner", async () => {
    const seen: JudgeRequest[] = [];
    const out = await runCheck(input("Meet Daily Shield.", client(seen)));
    expect(seen.length).toBe(1);
    expect(out.banner).toBeUndefined();
  });

  it("a book's worth of judgment rules sends the 20 closest to the draft", async () => {
    const rule = VELVRA_KIT.rules.find((r) => r.modes.includes("judgment"))!;
    const extra = Array.from({ length: 40 }, (_, i) => ({ ...rule, id: `X-${i}`, title: `Filler ${i}`, text: `About packaging crates number ${i}`, channels: [] }));
    const target = { ...rule, id: "X-TIDE", title: "Tide wording", text: "Say how moonlit tidepools relate to the product", channels: [] };
    const seen: JudgeRequest[] = [];
    await runCheck(input("Our moonlit tidepools collection arrives.", client(seen), { ...VELVRA_KIT, rules: [...VELVRA_KIT.rules, ...extra, target] }));
    expect(seen[0].rules).toHaveLength(20);
    expect(seen[0].rules.map((r) => r.id)).toContain("X-TIDE");
    expect(judgeInput.safeParse(seen[0]).success).toBe(true);
  });

  it("hides known people, whole words only, and maps findings back around them", () => {
    expect(redact("Ask Meera about Meerabai.", ["Meera"]).text).toBe("Ask [NAME] about Meerabai.");
    expect(redact("mark the Mark", ["Mark"]).text).toBe("mark the [NAME]");
    expect(redactDeep({ a: ["Meera"] }, ["Meera"]).value).toEqual({ a: ["[NAME]"] });
  });
});

describe("Importing a whole brand book", () => {
  const page = (n: number, text: string): BookPage => ({ page: n, text });
  const long = (n: number) => `Always write in plain words on page ${n}. `.repeat(120);

  it("splits pages into calls the route takes, keeping page numbers and every word", () => {
    const pages = [page(1, long(1)), page(2, "Short."), page(3, "x".repeat(20000))];
    const batches = pageBatches(pages, 7800);
    for (const b of batches) {
      expect(draftRulesInput.safeParse({ pages: b }).success).toBe(true);
      expect(textLength(b.map((x) => x.text))).toBeLessThanOrEqual(7800);
    }
    const joined = (n: number) => batches.flat().filter((p) => p.page === n).map((p) => p.text).join("");
    for (const p of pages) expect(joined(p.page)).toBe(p.text);
  });

  it("keeps AI rules whose quote is on the page, drops those whose quote isn't, and removes repeats", async () => {
    const pages = [page(1, "Never promise a cure."), page(2, "Say sun care.")];
    const good = { title: "No cures", text: "Never promise a cure", category: "claim" as const, severity: "high" as const, page: 1, quote: "Never promise a cure." };
    const made = { ...good, title: "Invented", text: "Always shout", quote: "Always shout at people." };
    const out = await draftBookRules(pages, async () => ({ ok: true, rules: [good, good, made], model: "m" }), 7800);
    expect(out.candidates.map((c) => c.title)).toEqual(["No cures"]);
    expect(out.rejected).toBe(1);
    expect(out.pagesByAi).toBe(2);
  });

  it("pages the AI failed on still go through the heuristic, with nothing skipped silently", async () => {
    const pages = [page(1, "You must always use sentence case in headlines.")];
    const out = await draftBookRules(pages, async () => ({ ok: false }), 7800);
    expect(out.pagesByAi).toBe(0);
    expect(out.candidates[0].by).toBe("heuristic");
    expect((await draftBookRules(pages, null, 7800)).candidates).toHaveLength(1);
  });

  it("stores the PDF, cites its words, and waits for approval", async () => {
    const pdf = await (await fetch("/samples/velvra-brand-book-update.pdf")).blob();
    const before = (await getKit()).rules.length;
    const result = await importBrandBook(new File([pdf], "update.pdf", { type: "application/pdf" }));
    const added = (await getKit()).rules.slice(before);
    expect(result.rules).toBe(added.length);
    expect(added.length).toBeGreaterThan(0);
    for (const r of added) {
      expect(r.pending).toBe(true);
      expect(r.active).toBe(false);
      expect(r.source.quote).toBeTruthy();
    }
    expect((await bookFile(added[0].source.bookId!))?.dataUrl).toMatch(/^data:application\/pdf/);
    await importBrandBook(new File([pdf], "update.pdf", { type: "application/pdf" }));
    const ids = (await getKit()).rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("A draft's report", () => {
  it("says what was checked, found and decided, and marks what never ran", async () => {
    const id = await draft("OMG our new sunblock is clinically proven | to erase dark spots!!!");
    expect((await draftReport(id)).markdown).toContain("Checked with: not checked yet");
    await check(id);
    const { markdown, fileName } = await draftReport(id);
    expect(fileName).toBe("t-report.md");
    expect(markdown).toContain("## Findings");
    expect(markdown).toContain("Velvra Brand Book");
    expect(markdown).toContain("\\|");
    expect(markdown).toContain("## Claims checked against the Claim Ledger");
    await expect(draftReport("nope")).rejects.toThrow(/no longer exists/);
  });
});
