"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight } from "lucide-react";
import { db, todayIso } from "@/store/db";
import type { RulebookVersion } from "@/lib/types";
import { factAlerts, MIN_FIRES, repeatPatterns, ruleHealth, UNCLEAR_AT, type FixAcceptance, type RuleHealth } from "@/engine/health";
import { rollbackRulebook } from "@/store/actions";
import { useAiStatus, useKit, useRole } from "@/store/hooks";
import { CHANNELS } from "@/seed/velvra";
import { useDealIn } from "./motion";
import { TitleRow } from "./AppShell";
import { Clarify } from "./Clarify";
import { useAction, Table } from "./primitives";
import { AcceptanceCell, AcceptanceStone, percent, Touchstone, useAcceptance } from "./RuleSignals";
import { useUnreadAlerts } from "./alerts";
import { Code, Empty, fmtTime, PageLoading } from "./ui";
import { useBrand } from "./BrandSwitcher";

const channelName = (c: string) => CHANNELS.find((x) => x.id === c)?.label ?? c;

export function HealthView() {
  const role = useRole();
  const kit = useKit();
  const ai = useAiStatus();
  const brand = useBrand();
  const acceptance = useAcceptance();
  const unread = useUnreadAlerts();
  useEffect(() => {
    void db.meta.put({ key: "visitedHealth", value: true });
  }, []);
  const data = useLiveQuery(async () => {
    const rulebooks = await db.rulebooks.orderBy("publishedAt").toArray();
    const rb = rulebooks[rulebooks.length - 1];
    const findings = await db.findings.toArray();
    const subs = await db.submissions.toArray();
    return { rb, prev: rulebooks[rulebooks.length - 2], before: rulebooks[rulebooks.length - 3], findings, subs };
  }, []);

  const health = useMemo(() => (data?.rb ? ruleHealth(data.rb.snapshot, data.findings, data.subs) : []), [data]);
  const patterns = useMemo(() => (data ? repeatPatterns(data.findings, data.subs) : []), [data]);
  const alerts = useMemo(() => (data?.rb ? factAlerts(data.rb.snapshot.facts, todayIso()) : []), [data]);
  const [open, setOpen] = useState<string | null>(null);
  // The unclear scores grow from zero in rank order, so the eye reads the ranking as it forms.
  const screen = useRef<HTMLDivElement>(null);
  useDealIn(screen, "[data-bar]", [!!data], "grow", 50);

  if (!data || !kit) return <PageLoading label="Reading the review history…" />;
  const unclear = health.filter((h) => h.unclear);
  const fired = health.filter((h) => h.fires > 0);
  const seededSubs = data.subs.filter((s) => s.seeded).length;
  const liveFindings = data.findings.filter((f) => !f.id.startsWith("seed_")).length;
  const top = unclear[0];
  const expanded = open ?? top?.rule.id ?? null;
  const current = expanded ? health.find((h) => h.rule.id === expanded) : undefined;
  const demo = brand?.demo ?? false;
  const aiOn = !!ai?.aiConfigured && !kit.confidential;
  const aiWhy = ai === undefined ? "Checking whether the AI is available." : kit.confidential ? "Confidential mode is on, so nothing is sent to an AI service and drafting is off." : "No AI key is set on this deployment, so drafting with the AI is off.";
  const expiring = alerts.filter((a) => !a.expired).length;
  const expired = alerts.length - expiring;

  const topAcceptance = top ? acceptance?.get(top.rule.id) : undefined;
  const basis = demo
    ? `Based on ${seededSubs} seeded demo reviews (labelled) and ${liveFindings} finding${liveFindings === 1 ? "" : "s"} from this browser.`
    : `Based on ${liveFindings} finding${liveFindings === 1 ? "" : "s"} from this browser.`;

  return (
    <div ref={screen} className="px-4 py-5 md:px-8 md:py-8">
      <TitleRow title="Guideline Health" sub="Which rules people keep pushing back on, read from every decision made on a finding." />

      <section aria-labelledby="first-h" className="card mt-6 p-6 md:p-8">
        <h2 id="first-h" className="sr-only">
          What to reword first
        </h2>
        {top ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,1fr)] lg:items-center">
            <div>
              <p className="font-display text-[26px] font-medium leading-[34px] tracking-[-0.02em] md:text-[32px] md:leading-[42px]">Reword {top.rule.id} first: it looks unclear.</p>
              <p className="mt-3 text-[17px] leading-[26px]">
                {top.contested > top.dismissed ? `${top.contested} of its ${top.fires} findings were contested` : `${top.dismissed} of its ${top.fires} findings were dismissed`}
                {top.topAudience && top.topAudience.share >= 0.6 ? `, mostly on “${top.topAudience.audience}” campaigns` : ""}.
              </p>
              <p className="mt-4 text-[14px] leading-[22px] text-muted">
                {top.rule.title}. {basis}
              </p>
            </div>
            <dl className="space-y-6 rounded-[24px] bg-field p-6">
              <div>
                <dt className="flex items-baseline justify-between gap-3 text-[13.5px] text-muted">
                  <span>Unclear score</span>
                  <span className="num text-[22px] font-medium text-ink">
                    {top.score} <span className="text-[13px] font-normal text-muted">of 100</span>
                  </span>
                </dt>
                <dd className="mt-2">
                  <Touchstone score={top.score} size="lg" />
                </dd>
              </div>
              <div>
                <dt className="flex items-baseline justify-between gap-3 text-[13.5px] text-muted">
                  <span>Fixes accepted</span>
                  <span className="num text-[22px] font-medium text-ink">
                    {topAcceptance && topAcceptance.rate !== null ? (
                      <>
                        {percent(topAcceptance.rate)} <span className="text-[13px] font-normal text-muted">n {topAcceptance.decided}</span>
                      </>
                    ) : (
                      <span className="text-faint" aria-hidden="true">
                        —
                      </span>
                    )}
                  </span>
                </dt>
                <dd className="mt-2">
                  {topAcceptance && topAcceptance.rate !== null ? <AcceptanceStone a={topAcceptance} size="lg" /> : <span className="text-[13px] text-muted">No fixes decided on this rule yet.</span>}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="max-w-[760px] font-display text-[24px] font-medium leading-[32px] tracking-[-0.02em] md:text-[28px] md:leading-[38px]">
            No rule needs rewording yet: none has {MIN_FIRES} or more findings with enough pushback.{" "}
            <span className="text-muted">{liveFindings === 0 && !seededSubs ? "Findings from checked drafts will appear here." : basis}</span>
          </p>
        )}
      </section>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="unclear-h" className="card min-w-0 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="unclear-h" className="text-[16px] font-semibold">
              Rules ranked by how unclear they look
            </h2>
            <p className="text-[12px] text-muted">
              Score = 35% dismissals + 35% contests + 15% reopened + 15% approved despite a flag. Flagged at {UNCLEAR_AT} with {MIN_FIRES}+ findings.
            </p>
          </div>
          <Table label="Rules ranked by unclear score" minWidth={0} className="mt-3">
            <thead>
              <tr>
                <th className="w-[44%] sm:w-[34%]">Rule</th>
                <th className="num">Findings</th>
                <th className="num hidden sm:table-cell">Dismissed</th>
                <th className="num hidden sm:table-cell">Contested</th>
                <th className="num hidden sm:table-cell">Fixes accepted</th>
                <th className="w-[40%] !pl-4 sm:w-[30%]">Unclear score</th>
              </tr>
            </thead>
            <tbody>
              {fired.slice(0, 10).map((h) => (
                <RuleRow
                  key={h.rule.id}
                  h={h}
                  acceptance={acceptance?.get(h.rule.id)}
                  expanded={expanded === h.rule.id}
                  onToggle={() => setOpen(expanded === h.rule.id ? "" : h.rule.id)}
                  note={<RowNote ruleId={h.rule.id} data={data} />}
                />
              ))}
            </tbody>
          </Table>
          <p className="mt-3 text-[12px] leading-5 text-muted">
            The streak on each stone is the score, 0 to 100; the tick marks {UNCLEAR_AT}. A dash under Fixes accepted means no fixes decided yet. Automated test runs are left out of the acceptance rate.
          </p>
          {current && (
            <Clarify
              key={current.rule.id}
              h={current}
              canPublish={role === "admin"}
              ai={{ on: aiOn, why: aiWhy }}
              acceptance={acceptance?.get(current.rule.id)}
              latestVersion={data.rb.version}
              revision={data.rb.id}
            />
          )}
        </section>

        <div className="space-y-6">
          <section aria-labelledby="facts-h" className="card p-6">
            <h2 id="facts-h" className="text-[16px] font-semibold">
              Facts about to expire
            </h2>
            {alerts.length === 0 ? (
              <div className="mt-2">
                <Empty title="No fact expires in the next 30 days." />
              </div>
            ) : (
              <p className="mt-2 text-[14px] leading-[22px]">
                {alerts.length} fact{alerts.length === 1 ? "" : "s"} need{alerts.length === 1 ? "s" : ""} attention: {alerts.slice(0, 3).map((a) => a.fact.id).join(", ")}
                {alerts.length > 3 ? ` and ${alerts.length - 3} more` : ""} ({expired} expired, {expiring} within 30 days).
              </p>
            )}
            <p className="mt-1 text-[13px] text-muted">
              {unread === undefined ? "Reading the inbox…" : unread === 0 ? "Every alert has been read." : `${unread} unread alert${unread === 1 ? "" : "s"} in the inbox.`}
            </p>
            <Link href="/app/inbox" className="btn btn-secondary btn-sm mt-3">
              Open the expiry inbox <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </section>
          <section aria-labelledby="repeat-h" className="card p-6">
            <h2 id="repeat-h" className="text-[16px] font-semibold">
              Repeated mistakes
            </h2>
            <p className="text-[13px] text-muted">The same rule, three or more times, by channel or by who wrote it.</p>
            <ul className="mt-2">
              {patterns.length === 0 && (
                <li>
                  <Empty title="Nothing repeats three times yet." />
                </li>
              )}
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
      {demo && (
        <p className="mt-6 text-[12px] text-muted">
          Seeded demo history is generated from a fixed seed so every judge sees the same numbers; it is not real usage. Live findings from this browser are added on top.
        </p>
      )}
    </div>
  );
}

function RuleRow({ h, acceptance, expanded, onToggle, note }: { h: RuleHealth; acceptance?: FixAcceptance; expanded: boolean; onToggle: () => void; note: ReactNode }) {
  return (
    <>
      <tr className={`cursor-pointer ${expanded ? "bg-raised" : "hover:bg-raised"}`} onClick={onToggle}>
        <td>
          <button className="text-left" aria-expanded={expanded} onClick={(e) => (e.stopPropagation(), onToggle())}>
            <Code>{h.rule.id}</Code> <span>{h.rule.title}</span>
            {h.unclear && <span className="pill ml-2 bg-gold-soft text-gold-ink">Unclear</span>}
          </button>
        </td>
        <td className="num">{h.fires}</td>
        <td className="num hidden sm:table-cell">{h.dismissed}</td>
        <td className="num hidden sm:table-cell">{h.contested}</td>
        <td className="num hidden sm:table-cell">
          <AcceptanceCell a={acceptance} />
        </td>
        <td className="!pl-3 sm:!pl-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <Touchstone score={h.score} className="flex-1" />
            <span className="num w-7 text-right text-[13px]">{h.score}</span>
          </div>
        </td>
      </tr>
      {note}
    </>
  );
}

type HealthData = { rb: RulebookVersion; prev?: RulebookVersion; before?: RulebookVersion };

/**
 * The row's own confirmation after a publish, with Undo. It is read from the rulebook history, so it
 * is there after a reload too: the latest version is this rule's clarification, or a rollback of it.
 */
function RowNote({ ruleId, data }: { ruleId: string; data: HealthData }) {
  const { rb, prev, before } = data;
  const undo = useAction((to: string) => rollbackRulebook(to), { errorPrefix: "Could not undo", success: (v) => `Undone: v${v} restores the wording from before.` });
  const published = rb.clarification?.ruleId === ruleId && prev;
  const undone = !!rb.rolledBackTo && prev?.clarification?.ruleId === ruleId && before && rb.rolledBackTo === before.version;
  if (!published && !undone) return null;
  return (
    <tr>
      <td colSpan={6} className="!border-b-0 !pb-3 !pt-0">
        <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] bg-pos-bg px-3.5 py-2 text-[13.5px] leading-5 text-pos-ink">
          {published ? (
            <>
              <span>
                Reworded in v{rb.version}
                {rb.clarification ? ` · ${fmtTime(rb.clarification.at)}` : ""}. Drafts started earlier keep their version.
              </span>
              <button className="btn btn-inverse btn-sm ml-auto" disabled={undo.busy} onClick={() => undo.run(prev!.version)}>
                {undo.busy ? "Undoing…" : `Undo (restore v${prev!.version})`}
              </button>
            </>
          ) : (
            <span>
              Undone: v{rb.version} restores v{rb.rolledBackTo}. The earlier wording is back in use.
            </span>
          )}
        </p>
      </td>
    </tr>
  );
}
