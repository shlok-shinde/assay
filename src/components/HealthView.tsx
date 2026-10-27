"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, todayIso } from "@/store/db";
import { factAlerts, MIN_FIRES, repeatPatterns, ruleHealth, UNCLEAR_AT, type RuleHealth } from "@/engine/health";
import { formatDate } from "@/engine/claims";
import { aiTask } from "@/lib/ai-client";
import { getKit, upsertRule } from "@/store/actions";
import { useAiStatus, useKit, useRole } from "@/store/hooks";
import { TitleRow } from "./AppShell";
import { Code, Empty, Notice, PageLoading } from "./ui";
import { CHANNELS } from "@/seed/velvra";

const channelName = (c: string) => CHANNELS.find((x) => x.id === c)?.label ?? c;

export function HealthView() {
  const role = useRole();
  const kit = useKit();
  const ai = useAiStatus();
  useEffect(() => {
    void db.meta.put({ key: "visitedHealth", value: true });
  }, []);
  const data = useLiveQuery(async () => {
    const rb = await db.rulebooks.orderBy("publishedAt").last();
    const findings = await db.findings.toArray();
    const subs = await db.submissions.toArray();
    return { rb, findings, subs };
  }, []);

  const health = useMemo(() => (data?.rb ? ruleHealth(data.rb.snapshot, data.findings, data.subs) : []), [data]);
  const patterns = useMemo(() => (data ? repeatPatterns(data.findings, data.subs) : []), [data]);
  const alerts = useMemo(() => (data?.rb ? factAlerts(data.rb.snapshot.facts, todayIso()) : []), [data]);
  const [open, setOpen] = useState<string | null>(null);

  if (!data || !kit) return <PageLoading label="Reading the review history…" />;
  const unclear = health.filter((h) => h.unclear);
  const fired = health.filter((h) => h.fires > 0);
  const seededSubs = data.subs.filter((s) => s.seeded).length;
  const liveFindings = data.findings.filter((f) => !f.id.startsWith("seed_")).length;
  const top = unclear[0];
  const expanded = open ?? top?.rule.id ?? null;
  const maxScore = Math.max(1, ...fired.map((h) => h.score));

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        title="Guideline Health"
        sub={
          top ? (
            <>
              <span className="text-ink">
                {top.rule.id} looks unclear: {top.contested > top.dismissed ? `${top.contested} of its ${top.fires} findings were contested` : `${top.dismissed} of its ${top.fires} findings were dismissed`}
                {top.topAudience && top.topAudience.share >= 0.6 ? `, mostly on “${top.topAudience.audience}” campaigns` : ""}.
              </span>{" "}
              Based on {seededSubs} seeded demo reviews (labelled) and {liveFindings} finding{liveFindings === 1 ? "" : "s"} from this browser.
            </>
          ) : (
            "No rule has enough pushback to look unclear yet."
          )
        }
      />

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="unclear-h" className="card min-w-0 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="unclear-h" className="text-[16px] font-semibold">
              Rules ranked by how unclear they look
            </h2>
            <p className="text-[12px] text-muted">
              Score = 35% dismissals + 35% contests + 15% reopened + 15% approved despite a flag. Flagged at {UNCLEAR_AT} with {MIN_FIRES}+ findings.
            </p>
          </div>
          <table className="mt-3 w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="pb-2 font-normal">Rule</th>
                <th className="pb-2 pl-3 text-right font-normal">Findings</th>
                <th className="hidden pb-2 pl-3 text-right font-normal sm:table-cell">Dismissed</th>
                <th className="hidden pb-2 pl-3 text-right font-normal sm:table-cell">Contested</th>
                <th className="w-[34%] pb-2 pl-4 font-normal">Unclear score</th>
              </tr>
            </thead>
            <tbody>
              {fired.slice(0, 10).map((h) => (
                <RuleRow key={h.rule.id} h={h} max={maxScore} expanded={expanded === h.rule.id} onToggle={() => setOpen(expanded === h.rule.id ? "" : h.rule.id)} />
              ))}
            </tbody>
          </table>
          {expanded && health.find((h) => h.rule.id === expanded) && (
            <Clarify h={health.find((h) => h.rule.id === expanded)!} canEdit={role === "admin"} aiOn={!!ai?.aiConfigured && !kit.confidential} />
          )}
        </section>

        <div className="space-y-6">
          <section aria-labelledby="facts-h" className="card p-5">
            <h2 id="facts-h" className="text-[16px] font-semibold">
              Facts expiring within 30 days
            </h2>
            <ul className="mt-2">
              {alerts.length === 0 && <li><Empty title="No fact expires in the next 30 days." /></li>}
              {alerts.map((a) => (
                <li key={a.fact.id} className="flex items-start justify-between gap-3 border-t border-rule py-2.5 first:border-t-0">
                  <div className="min-w-0 text-[14px]">
                    <Code>{a.fact.id}</Code> {a.fact.statement}
                    <p className="text-[12px] text-muted">
                      Owner {a.fact.owner} · {a.expired ? "expired" : "valid to"} {formatDate(a.fact.validTo!)}
                    </p>
                  </div>
                  <span className={`pill num ${a.expired ? "bg-neg-bg text-neg-ink" : "bg-warn-bg text-warn-ink border border-warn-line"}`}>
                    {a.expired ? `${-a.daysLeft} days ago` : `${a.daysLeft} days left`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="repeat-h" className="card p-5">
            <h2 id="repeat-h" className="text-[16px] font-semibold">
              Repeated mistakes
            </h2>
            <p className="text-[13px] text-muted">The same rule, three or more times, by channel or by who wrote it.</p>
            <ul className="mt-2">
              {patterns.length === 0 && <li><Empty title="Nothing repeats three times yet." /></li>}
              {patterns.slice(0, 7).map((p) => (
                <li key={`${p.ruleId}${p.kind}${p.by}`} className="flex items-center justify-between gap-3 border-t border-rule py-2 text-[14px] first:border-t-0">
                  <span>
                    <Code>{p.ruleId}</Code> <span className="text-muted">{p.kind === "channel" ? "on" : "by"}</span> {p.kind === "channel" ? channelName(p.by) : p.by}
                  </span>
                  <span className="num">{p.count}×</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <p className="mt-6 text-[12px] text-muted">
        Seeded demo history is generated from a fixed seed so every judge sees the same numbers; it is not real usage. Live findings from this browser are added on top.
      </p>
    </div>
  );
}

function RuleRow({ h, max, expanded, onToggle }: { h: RuleHealth; max: number; expanded: boolean; onToggle: () => void }) {
  return (
    <tr className={`cursor-pointer border-t border-rule ${expanded ? "bg-raised" : "hover:bg-raised"}`} onClick={onToggle}>
      <td className="py-2.5 pr-2 pl-1">
        <button className="text-left" aria-expanded={expanded} onClick={(e) => (e.stopPropagation(), onToggle())}>
          <Code>{h.rule.id}</Code> <span>{h.rule.title}</span>
          {h.unclear && <span className="pill ml-2 bg-gold-soft text-gold-ink">Unclear</span>}
        </button>
      </td>
      <td className="num py-2.5 text-right">{h.fires}</td>
      <td className="num hidden py-2.5 text-right sm:table-cell">{h.dismissed}</td>
      <td className="num hidden py-2.5 text-right sm:table-cell">{h.contested}</td>
      <td className="py-2.5 pl-4 pr-1">
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-rule">
            <div className={`h-2 rounded-full ${h.unclear ? "bg-gold-mark" : "bg-bar"}`} style={{ width: `${(h.score / max) * 100}%` }} />
          </div>
          <span className="num w-7 text-right text-[13px]">{h.score}</span>
        </div>
      </td>
    </tr>
  );
}

function Clarify({ h, canEdit, aiOn }: { h: RuleHealth; canEdit: boolean; aiOn: boolean }) {
  const [draft, setDraft] = useState<{ text: string; dos: string[]; donts: string[]; rationale: string; by: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askAi = async () => {
    setBusy(true);
    setError(null);
    const r = await aiTask("clarifyRule", {
      rule: { id: h.rule.id, title: h.rule.title, text: h.rule.text, dos: h.rule.dos.slice(0, 6), donts: h.rule.donts.slice(0, 6) },
      examples: h.examples.map((e) => ({ quote: e.quote.slice(0, 400), reason: e.reason?.slice(0, 300), status: e.status, audience: e.audience, channel: e.channel })),
    });
    setBusy(false);
    if (r.ok) setDraft({ ...r.data, by: `AI draft (${r.model})` });
    else setError("The AI could not draft a clarification right now; the template suggestion above still applies.");
  };

  const apply = async () => {
    if (!draft) return;
    const kit = await getKit();
    const rule = kit.rules.find((r) => r.id === h.rule.id);
    if (!rule) return;
    await upsertRule({ ...rule, text: draft.text, dos: [...rule.dos, ...draft.dos], donts: [...rule.donts, ...draft.donts] });
    setSaved(true);
  };

  return (
    <div className="mt-4 rounded-[14px] bg-raised p-4">
      <h3 className="text-[14px] font-semibold">
        {h.rule.id}: what people pushed back on
      </h3>
      <p className="mt-1 text-[13px] text-muted">Current text: “{h.rule.text}”</p>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {h.examples.length === 0 && <li className="text-[13px] text-muted">No dismissed or contested findings for this rule.</li>}
        {h.examples.map((e, i) => (
          <li key={i} className="rounded-[10px] bg-sheet px-3 py-2 text-[13px] leading-5">
            <p>“{e.quote}”</p>
            <p className="text-muted">
              {e.status === "contested" ? "Contested" : "Dismissed"}
              {e.reason ? `: ${e.reason}` : ""} · {channelName(e.channel)} · {e.audience}
              {e.seeded ? " · seeded" : ""}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <p className="text-[13px] font-medium">Suggested clarification (template)</p>
        <p className="mt-1 text-[14px] leading-[22px]">{h.suggestion}</p>
      </div>
      {draft && (
        <div className="mt-4 rounded-[12px] border border-line bg-sheet p-3">
          <p className="text-[12px] text-muted">{draft.by}</p>
          <p className="mt-1 text-[14px] leading-[22px]">{draft.text}</p>
          {draft.dos.length > 0 && <p className="mt-1 text-[13px]">Do: {draft.dos.join(" · ")}</p>}
          {draft.donts.length > 0 && <p className="text-[13px]">Don&apos;t: {draft.donts.join(" · ")}</p>}
          <p className="mt-1 text-[13px] text-muted">{draft.rationale}</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {aiOn && (
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={askAi}>
            {busy ? "Drafting…" : "Draft a clarification with AI"}
          </button>
        )}
        {!draft && (
          <button className="btn btn-secondary btn-sm" onClick={() => setDraft({ text: `${h.rule.text} ${h.suggestion}`, dos: [], donts: [], rationale: "From the template suggestion.", by: "Template" })}>
            Use the template as a draft
          </button>
        )}
        {draft && canEdit && (
          <button className="btn btn-primary btn-sm" disabled={saved} onClick={apply}>
            {saved ? "Saved to the Brand Kit draft" : "Save to the Brand Kit draft"}
          </button>
        )}
        {saved && (
          <Link href="/app/kit?tab=versions" className="btn btn-ghost btn-sm">
            Publish it as a new rulebook version
          </Link>
        )}
      </div>
      {draft && !canEdit && <p className="mt-2 text-[13px] text-muted">Switch to Brand Admin to save this to the rulebook.</p>}
      {error && (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}
