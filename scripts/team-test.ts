// pnpm test:team, with DATABASE_URL pointing at a throwaway Postgres: the team server's guarantees, against a real
// database with real concurrency. It drops its own tables first, so never point it at anything you want to keep.
import assert from "node:assert/strict";
import { GENESIS } from "../src/engine/hallmark";
import { hashJson } from "../src/engine/hash";
import type { HallmarkBody } from "../src/lib/types";
import { database } from "../src/server/db";
import { consumeLink, createLink, createSession, memberships, revokeSession, sessionEmail, underLimit, sessionCookie } from "../src/server/team/auth";
import { ensureTeamSchema } from "../src/server/team/schema";
import { getChunk, hasBlob, issueHallmark, pull, push, putChunk } from "../src/server/team/sync";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("Set DATABASE_URL to a throwaway local Postgres. This test drops tables.");
  process.exit(1);
}

let passed = 0;
async function test(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log(`  ok  ${name}`);
}

const creator = { role: "creator" as const, name: "Cara Creator" };
const reviewer = { role: "reviewer" as const, name: "Rao Reviewer" };
const admin = { role: "admin" as const, name: "Ada Admin" };

const sub = (id: string, status = "draft") => ({ id, title: "T", status, creator: "someone else", intent: {}, channel: "email" });
const one = async (ws: string, actor: typeof creator | typeof reviewer | typeof admin, tbl: string, rowId: string, base: number, data: Record<string, unknown> | null) => (await push(ws, actor as never, [{ tbl, rowId, base, data }]))[0];

async function workspace(id: string) {
  await database()!.query("INSERT INTO team_workspaces (id, name) VALUES ($1, $1)", [id]);
}

const hallmarkBody = (submissionId: string, prevHash: string): HallmarkBody => ({
  submissionId,
  title: "T",
  versionId: "v1",
  versionN: 1,
  contentHash: "c",
  rulebookVersion: "1.0",
  rulebookHash: "r",
  findings: [],
  approvals: [],
  ai: { models: [], calls: 0, redactions: 0, mode: "rules-only" },
  prevHash,
  issuedAt: new Date().toISOString(),
});

async function main() {
  const db = database()!;
  await db.query("DROP TABLE IF EXISTS team_alerts, team_blob_chunks, team_rows, team_limits, team_sessions, team_links, team_members, team_workspaces CASCADE");
  await db.query("DROP SEQUENCE IF EXISTS team_seq");
  await Promise.all([ensureTeamSchema(), ensureTeamSchema()]);

  await test("a link works once, even when two requests race for it", async () => {
    const token = await createLink({ purpose: "signin", email: "A@Example.com" });
    const [a, b] = await Promise.all([consumeLink(token), consumeLink(token)]);
    assert.equal([a, b].filter(Boolean).length, 1);
    assert.equal((a ?? b)!.email, "a@example.com");
    assert.equal(await consumeLink("not-a-token"), null);
  });

  await test("an expired link doesn't work", async () => {
    const token = await createLink({ purpose: "signin", email: "b@example.com" });
    await db.query("UPDATE team_links SET expires_at = now() - interval '1 minute' WHERE email = 'b@example.com'");
    assert.equal(await consumeLink(token), null);
  });

  await test("links and sessions are stored only as hashes", async () => {
    const token = await createLink({ purpose: "signin", email: "c@example.com" });
    const session = await createSession("c@example.com");
    const links = await db.query("SELECT token_hash FROM team_links WHERE email = 'c@example.com'");
    const sessions = await db.query("SELECT token_hash FROM team_sessions WHERE email = 'c@example.com'");
    assert.notEqual(links.rows[0].token_hash, token);
    assert.notEqual(sessions.rows[0].token_hash, session);
  });

  await test("a revoked session stops at once", async () => {
    const token = await createSession("d@example.com");
    const request = new Request("http://x/", { headers: { cookie: sessionCookie(token, false).split(";")[0] } });
    assert.equal(await sessionEmail(request), "d@example.com");
    await revokeSession(request);
    assert.equal(await sessionEmail(request), null);
  });

  await test("a limit holds under parallel requests", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => underLimit("parallel", 5, 60)));
    assert.equal(results.filter(Boolean).length, 5);
  });

  await workspace("w1");

  await test("the server writes who did it, whatever the browser claimed", async () => {
    const created = await one("w1", creator, "submissions", "s1", 0, sub("s1"));
    assert.ok(created.ok);
    assert.equal((created.data as { creator: string }).creator, "Cara Creator");
    const comment = await one("w1", reviewer, "comments", "c1", 0, { id: "c1", submissionId: "s1", author: "Ada Admin", role: "admin", text: "hi" });
    assert.deepEqual([(comment.data as { author: string }).author, (comment.data as { role: string }).role], ["Rao Reviewer", "reviewer"]);
  });

  await test("a stale write is refused, and hands back the current row", async () => {
    const stale = await one("w1", creator, "submissions", "s1", 0, { ...sub("s1"), title: "Stale" });
    assert.equal(stale.ok, false);
    assert.equal((stale.data as { title: string }).title, "T");
    assert.ok(stale.version >= 1);
  });

  await test("two writers on one version: exactly one wins", async () => {
    await workspace("race");
    await one("race", creator, "submissions", "s", 0, sub("s"));
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => one("race", creator, "submissions", "s", 1, { ...sub("s"), title: `T${i}` })));
    assert.equal(results.filter((r) => r.ok).length, 1);
  });

  await test("a creator can't approve, and a draft can't be approved by editing it", async () => {
    await one("w1", creator, "submissions", "s2", 0, sub("s2"));
    const inReview = await one("w1", creator, "submissions", "s2", 1, sub("s2", "in_review"));
    assert.ok(inReview.ok);
    const byCreator = await one("w1", creator, "submissions", "s2", 2, sub("s2", "approved"));
    assert.equal(byCreator.ok, false);
    const byReviewer = await one("w1", reviewer, "submissions", "s2", 2, sub("s2", "approved"));
    assert.equal(byReviewer.ok, false);
    const decision = await one("w1", creator, "approvals", "a1", 0, { id: "a1", submissionId: "s2", decision: "approved" });
    assert.equal(decision.ok, false);
  });

  await test("a finding can't be downgraded past the high-severity lock, or dismissed by its creator", async () => {
    await one("w1", creator, "submissions", "s3", 0, sub("s3"));
    const f = { id: "f1", submissionId: "s3", ruleId: "CLAIM-01", severity: "high", status: "open", start: 0, end: 1 };
    await one("w1", creator, "findings", "f1", 0, f);
    assert.equal((await one("w1", creator, "findings", "f1", 1, { ...f, severity: "low" })).ok, false);
    assert.equal((await one("w1", creator, "findings", "f1", 1, { ...f, status: "dismissed" })).ok, false);
    const byReviewer = await one("w1", reviewer, "findings", "f1", 1, { ...f, status: "dismissed", resolution: { by: "Cara Creator", role: "creator", at: "x" } });
    assert.ok(byReviewer.ok);
    assert.equal((byReviewer.data as { resolution: { by: string } }).resolution.by, "Rao Reviewer");
  });

  await test("only an admin changes the kit, and a published rulebook is immutable with a hash the server computes", async () => {
    assert.equal((await one("w1", creator, "kits", "k", 0, { id: "k", rules: [] })).ok, false);
    assert.ok((await one("w1", admin, "kits", "k", 0, { id: "k", rules: [] })).ok);
    const snapshot = { rules: [] };
    const rb = await one("w1", admin, "rulebooks", "rb_1", 0, { id: "rb_1", version: "1.0", hash: "made-up", snapshot });
    assert.equal((rb.data as { hash: string }).hash, await hashJson(snapshot));
    assert.equal((await one("w1", admin, "rulebooks", "rb_1", 1, { id: "rb_1", version: "1.0", hash: "x", snapshot: { rules: [1] } })).ok, false);
  });

  await test("a Hallmark can't be pushed as a row, and an approved draft can't change or be deleted", async () => {
    assert.equal((await one("w1", admin, "hallmarks", "h", 0, { id: "h" })).ok, false);
    await one("w1", creator, "submissions", "s4", 0, sub("s4"));
    await one("w1", creator, "submissions", "s4", 1, sub("s4", "in_review"));
    const issued = await issueHallmark("w1", reviewer, hallmarkBody("s4", GENESIS), "hm_s4");
    assert.ok(issued.ok);
    assert.equal(issued.hallmark.seq, 1);
    assert.equal((await one("w1", creator, "submissions", "s4", issued.versions.submission, { ...sub("s4"), title: "changed" })).ok, false);
    assert.equal((await one("w1", creator, "submissions", "s4", issued.versions.submission, null)).ok, false);
  });

  await test("a creator can't call the Hallmark route, and a draft with Compliance waiting can't be hallmarked", async () => {
    await one("w1", creator, "submissions", "s5", 0, sub("s5"));
    await one("w1", creator, "submissions", "s5", 1, sub("s5", "in_review"));
    assert.equal((await issueHallmark("w1", creator, hallmarkBody("s5", GENESIS), "x")).ok, false);
    await one("w1", creator, "findings", "f5", 0, { id: "f5", submissionId: "s5", ruleId: "C", severity: "high", status: "sent_to_compliance" });
    const last = await db.query("SELECT data FROM team_rows WHERE workspace_id = 'w1' AND tbl = 'hallmarks'");
    const blocked = await issueHallmark("w1", reviewer, hallmarkBody("s5", last.rows[0].data.hash), "x");
    assert.equal(blocked.ok, false);
    assert.match(blocked.ok ? "" : blocked.problem, /Compliance/);
  });

  await test("eight approvals at once make one unbroken chain with no repeated numbers", async () => {
    await workspace("chain");
    for (let i = 0; i < 8; i++) {
      await one("chain", creator, "submissions", `s${i}`, 0, sub(`s${i}`));
      await one("chain", creator, "submissions", `s${i}`, 1, sub(`s${i}`, "in_review"));
    }
    // Each one retries on losing the race, as the browser does.
    await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        for (let attempt = 0; attempt < 30; attempt++) {
          const { rows } = await db.query("SELECT data FROM team_rows WHERE workspace_id = 'chain' AND tbl = 'hallmarks' ORDER BY (data->>'seq')::int DESC LIMIT 1");
          const r = await issueHallmark("chain", reviewer, hallmarkBody(`s${i}`, rows[0]?.data.hash ?? GENESIS), `hm${i}`);
          if (r.ok) return;
          assert.equal(r.status, 409);
        }
        assert.fail("never won the race");
      }),
    );
    const { rows } = await db.query("SELECT data FROM team_rows WHERE workspace_id = 'chain' AND tbl = 'hallmarks' ORDER BY (data->>'seq')::int");
    assert.deepEqual(rows.map((r) => r.data.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
    rows.forEach((r, i) => assert.equal(r.data.prevHash, i ? rows[i - 1].data.hash : GENESIS));
  });

  await test("pull pages by cursor, sees each row's newest state once, and keeps workspaces apart", async () => {
    await workspace("p1");
    await workspace("p2");
    await one("p2", creator, "submissions", "other", 0, sub("other"));
    for (let i = 0; i < 205; i++) await one("p1", creator, "audit", `a${i}`, 0, { id: `a${i}`, action: "x" });
    const first = await pull("p1", 0);
    assert.equal(first.rows.length, 200);
    assert.equal(first.more, true);
    const second = await pull("p1", first.cursor);
    assert.equal(second.rows.length, 5);
    assert.equal(second.more, false);
    assert.ok(!first.rows.concat(second.rows).some((r) => r.rowId === "other"));
    assert.equal((await pull("p1", second.cursor)).rows.length, 0);
  });

  await test("a deleted draft arrives as a tombstone, and a file comes back whole", async () => {
    await workspace("t");
    await one("t", creator, "submissions", "gone", 0, sub("gone"));
    await one("t", creator, "submissions", "gone", 1, null);
    assert.equal((await pull("t", 0)).rows.find((r) => r.rowId === "gone")!.deleted, true);
    const hash = "a".repeat(64);
    assert.equal(await hasBlob("t", hash), false);
    await putChunk("t", hash, 0, 2, "first");
    assert.equal(await hasBlob("t", hash), false);
    await putChunk("t", hash, 1, 2, "second");
    assert.equal(await hasBlob("t", hash), true);
    assert.equal((await getChunk("t", hash, 1))!.data, "second");
  });

  await test("removing a member ends their access, and deleting a workspace removes everything", async () => {
    await db.query("INSERT INTO team_members (workspace_id, email, name, role) VALUES ('t', 'e@example.com', 'E', 'creator')");
    assert.equal((await memberships("e@example.com")).length, 1);
    await db.query("DELETE FROM team_members WHERE workspace_id = 't' AND email = 'e@example.com'");
    assert.equal((await memberships("e@example.com")).length, 0);
    await db.query("DELETE FROM team_workspaces WHERE id = 't'");
    const left = await db.query("SELECT count(*)::int n FROM team_rows WHERE workspace_id = 't'");
    assert.equal(left.rows[0].n, 0);
  });

  console.log(`\n${passed} passed`);
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
