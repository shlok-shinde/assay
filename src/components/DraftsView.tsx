"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { FilePlus2 } from "lucide-react";
import { db } from "@/store/db";
import { CHANNELS } from "@/seed/velvra";
import { SAMPLES } from "@/seed/samples";
import { useRole } from "@/store/hooks";
import { TitleRow } from "./AppShell";
import { JUST_ADDED, useBrand } from "./BrandSwitcher";
import { loadDraftRows, type DraftRow } from "./draft-state";
import { useDealIn } from "./motion";
import { nextStep } from "./next-step";
import { MarkStrip, Term } from "./primitives";
import { Thumb } from "./Thumb";
import { AssayLoader, ago, Empty, ROLE_LABEL, StatusPill } from "./ui";

const channelOf = (id: string) => CHANNELS.find((c) => c.id === id)?.label ?? id;
const initials = (label: string) => label.slice(0, 2).toUpperCase();

/**
 * The register answers one question: what needs me now? The drafts whose next move belongs to the role on
 * screen come first, as raised rows that say what the move is; what waits on someone else follows, and what
 * is finished comes last. Every figure is read from what is stored.
 */
export function DraftsView() {
  const role = useRole();
  const brand = useBrand();
  const router = useRouter();
  const demo = !brand || brand.demo;
  // A brand that has just been added opens on its set-up checklist, once.
  useEffect(() => {
    if (!brand || brand.demo) return;
    try {
      if (window.sessionStorage.getItem(JUST_ADDED) !== brand.id) return;
      window.sessionStorage.removeItem(JUST_ADDED);
    } catch {
      return;
    }
    router.replace("/app/setup");
  }, [brand, router]);
  const raw = useLiveQuery(() => loadDraftRows(), []);
  const seeded = useLiveQuery(() => db.submissions.filter((s) => !!s.seeded).count(), []);

  const rows = useMemo(
    () => raw?.map((r) => ({ ...r, move: nextStep({ ...r.step, role }) })),
    [raw, role],
  );
  const needsYou = rows?.filter((r) => r.s.status !== "approved" && r.move.yours) ?? [];
  const others = rows?.filter((r) => r.s.status !== "approved" && !r.move.yours) ?? [];
  const done = rows?.filter((r) => r.s.status === "approved") ?? [];

  const lists = useRef<HTMLDivElement>(null);
  useDealIn(lists, "li[data-row]", [!!rows, role], "rise", 40);

  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const sub = !rows
    ? "Reading your drafts…"
    : rows.length === 0
      ? demo
        ? (
            <>
              No drafts yet. Start with a sample: it takes about a minute to go from draft to <Term id="hallmark">Hallmark</Term>.
            </>
          )
        : "No drafts yet. Paste your first draft on the New draft screen."
      : needsYou.length
        ? `${plural(needsYou.length, "draft")} need${needsYou.length === 1 ? "s" : ""} you as ${ROLE_LABEL[role]}, starting with “${needsYou[0].s.title}”. ${others.length ? `${others.length} more wait${others.length === 1 ? "s" : ""} on someone else.` : ""}`
        : `Nothing waits on you as ${ROLE_LABEL[role]}. ${others.length ? `${plural(others.length, "draft")} wait${others.length === 1 ? "s" : ""} on someone else.` : "Every draft is done."}`;

  return (
    <div className="px-4 py-5 md:px-8 md:py-8">
      <TitleRow
        title="Drafts"
        sub={sub}
        actions={
          <Link href="/app/new" className="btn btn-primary btn-lg">
            <FilePlus2 size={15} aria-hidden="true" /> New draft
          </Link>
        }
      />
      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="list-h" className="min-w-0">
          <h2 id="list-h" className="sr-only">
            Your drafts
          </h2>
          {rows === undefined ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted">
              <AssayLoader size={18} /> Loading your drafts…
            </p>
          ) : rows.length === 0 ? (
            <div className="space-y-4">
              <Empty title="Nothing here yet">{demo ? "Pick a sample below, or paste your own copy on the New draft screen." : "Paste your own copy on the New draft screen, or finish setting up the brand first."}</Empty>
              {!demo && (
                <Link href="/app/setup" className="btn btn-secondary btn-sm">
                  Open the set-up checklist
                </Link>
              )}
              <ul className="grid gap-3 md:grid-cols-3">
                {(demo ? SAMPLES.slice(0, 3) : []).map((s) => (
                  <li key={s.id}>
                    <Link href={`/app/new?sample=${s.id}`} className="block h-full rounded-[24px] bg-raised p-5 transition-colors hover:bg-active">
                      <span className="text-[15px] font-semibold">{s.title}</span>
                      <span className="mt-1.5 block text-[13.5px] leading-5 text-muted">{s.shows}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div ref={lists} className="space-y-9">
              <Lane id="mine-h" title={`Needs you now`} count={needsYou.length} note={`The next move is ${role === "admin" ? "a Brand Admin's" : `${ROLE_LABEL[role]}'s`}.`} empty={`Nothing waits on you as ${ROLE_LABEL[role]}.`} rows={needsYou} mine />
              {others.length > 0 && <Lane id="others-h" title="With someone else" count={others.length} note="Waiting on another role, or on Assay." rows={others} />}
              {done.length > 0 && <Lane id="done-h" title="Approved and hallmarked" count={done.length} note="Nothing more is needed." rows={done} />}
            </div>
          )}
        </section>
        <aside aria-labelledby="you-h" className="space-y-4">
          <section className="rounded-[28px] bg-raised p-6">
            <h2 id="you-h" className="text-[15px] font-semibold">
              What each role does here
            </h2>
            <dl className="mt-4 space-y-3.5 text-[13.5px] leading-5">
              {[
                ["Creator", "Checks drafts, accepts or edits fixes, dismisses with a reason, submits for review."],
                ["Compliance", "Decides every claim routed from a draft: approve the claim or send it back."],
                ["Reviewer", "Sees dismissals and their reasons, the diff and comments; approves or requests changes."],
                ["Brand Admin", "Edits rules and facts, imports a brand book, publishes rulebook versions."],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className={`font-medium ${k.toLowerCase().startsWith(role === "admin" ? "brand" : role) ? "text-ink" : "text-muted"}`}>{k}</dt>
                  <dd className="text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          {demo && (
            <section className="rounded-[28px] bg-raised p-6">
              <h2 className="text-[15px] font-semibold">Seeded demo history</h2>
              <p className="mt-2 text-[13.5px] leading-5 text-muted">
                <span className="num text-ink">{seeded ?? 0}</span> past reviews, generated from a fixed seed and labelled as demo data, feed Guideline Health. They are not shown here as your drafts.
              </p>
              <Link href="/app/health" className="btn btn-secondary btn-sm mt-4">
                Open Guideline Health
              </Link>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

type Row = DraftRow & { move: ReturnType<typeof nextStep> };

function Lane({ id, title, count, note, rows, mine, empty }: { id: string; title: string; count: number; note: string; rows: Row[]; mine?: boolean; empty?: string }) {
  return (
    <section aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={id} className="text-[17px] font-semibold tracking-[-0.01em]">
          {title} <span className="num font-normal text-muted">{count}</span>
        </h3>
        <p className="text-[13px] text-muted">{note}</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-[24px] bg-raised px-5 py-4 text-[14px] text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <DraftLine key={r.s.id} r={r} mine={!!mine} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DraftLine({ r, mine }: { r: Row; mine: boolean }) {
  const { s, n, open, high } = r;
  const label = channelOf(s.channel);
  return (
    <li
      data-row
      className={`relative flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[28px] p-3.5 pr-5 transition-colors ${mine ? "bg-raised hover:bg-active" : "hover:bg-raised"}`}
    >
      <Thumb image={r.image} fallback={initials(label)} size={64} />
      <div className="min-w-0 flex-1 basis-[190px]">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link href={`/app/s/${s.id}`} className="text-[15px] font-semibold after:absolute after:inset-0 after:rounded-[28px] after:content-[''] hover:underline">
            {s.title}
          </Link>
          <StatusPill status={s.status} />
        </p>
        <p className="mt-0.5 truncate text-[13px] text-muted">
          {label} · {s.campaign || "No campaign"} · {s.creator}
        </p>
        {mine && <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-5 text-ink">{r.move.text}</p>}
      </div>
      <div className="max-w-full sm:ml-auto">
        <MarkStrip {...r.marks} />
      </div>
      <div className="num flex w-full flex-none flex-row gap-x-3 text-[13px] leading-5 text-muted sm:w-auto sm:basis-[116px] sm:flex-col sm:items-end sm:text-right">
        <span>
          <span className="text-ink">{open}</span> open{high ? <span className="font-semibold text-neg-ink"> · {high} high</span> : null}
        </span>
        <span>
          v{n} · {ago(s.updatedAt)}
        </span>
      </div>
    </li>
  );
}
