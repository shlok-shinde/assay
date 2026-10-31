"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import type { Fact, Owner } from "@/lib/types";
import { formatDate } from "@/engine/claims";
import { ALERT_THRESHOLDS } from "@/engine/health";
import { markNotificationRead, saveOwner, syncFactAlerts } from "@/store/actions";
import { todayIso } from "@/store/db";
import { useKit, useRole } from "@/store/hooks";
import { alertMailto, stripGeometry, useAlertModel, whenWords, type AlertItem, type OwnerGroup } from "./alerts";
import { TitleRow } from "./AppShell";
import { useBrand } from "./BrandSwitcher";
import { useDealIn } from "./motion";
import { Field, useAction } from "./primitives";
import { Code, Empty, Notice, PageLoading } from "./ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What the screen is for, in one sentence: the facts that need someone's attention, soonest first. */
function finding(groups: OwnerGroup[], next?: { fact: Fact; daysLeft: number }): string {
  const items = groups.flatMap((g) => g.items).sort((a, b) => a.daysLeft - b.daysLeft);
  if (!items.length) return next ? `No fact is inside its notice window. The next to expire is ${next.fact.id}, ${whenWords(next.daysLeft)}, owned by ${next.fact.owner}.` : "No fact has an expiry date inside a notice window, and none is waiting on a date.";
  const named = items.slice(0, 2).map((i) => `${i.fact.id} ${whenWords(i.daysLeft)} (${i.fact.owner})`);
  return `${items.length} fact${items.length === 1 ? " needs" : "s need"} attention: ${named.join("; ")}${items.length > 2 ? `; ${items.length - 2} more` : ""}.`;
}

export function InboxView() {
  const brand = useBrand();
  const kit = useKit();
  const role = useRole();
  const today = todayIso();
  const model = useAlertModel(today);
  const [mail, setMail] = useState<boolean | undefined>();
  const screen = useRef<HTMLDivElement>(null);
  useDealIn(screen, "[data-deal]", [!!model], "rise", 70);
  useDealIn(screen, "[data-bar]", [!!model], "grow", 60);

  // Raise anything due today (safe beside the app shell doing the same).
  useEffect(() => {
    void syncFactAlerts().catch((e) => console.warn("Could not raise fact alerts.", e));
  }, []);

  // Only the demo can send a real email, and only when this deployment has a mail account set up.
  const demo = brand?.demo;
  useEffect(() => {
    if (!demo) return;
    let live = true;
    fetch("/api/demo/fact-alert", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ enabled?: boolean }>) : { enabled: false }))
      .then((j) => live && setMail(!!j.enabled))
      .catch(() => live && setMail(false));
    return () => {
      live = false;
    };
  }, [demo]);

  const readAll = useAction(
    async () => {
      for (const g of model?.groups ?? []) for (const i of g.items) for (const n of i.unread) await markNotificationRead(n.id);
    },
    { errorPrefix: "Could not mark them read" },
  );

  if (!model || !kit || !brand) return <PageLoading label="Reading the alerts…" />;
  const { groups, unread, resolved, next } = model;

  return (
    <div ref={screen} className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        title="What expires, and who owns it?"
        sub={finding(groups, next)}
        actions={
          unread > 0 && (
            <button className="btn btn-secondary" disabled={readAll.busy} onClick={() => readAll.run()}>
              Mark all read
            </button>
          )
        }
      />

      {brand.demo && mail === false && (
        <div className="mt-5">
          <Notice tone="info">Email isn&apos;t set up on this deployment, so this demo can&apos;t send an alert to your inbox. The alerts below are what would be sent.</Notice>
        </div>
      )}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {groups.length === 0 ? (
            <section aria-label="No alerts" className="card p-5">
              <Empty title="No alert has been raised.">
                Alerts appear here when a fact is {ALERT_THRESHOLDS[0]} days or less from the date in its Valid to field.{" "}
                <Link href="/app/kit?tab=facts" className="font-medium text-ink underline">
                  Open the Claim Ledger
                </Link>{" "}
                to set an owner and a date.
              </Empty>
            </section>
          ) : (
            groups.map((g) => (
              <OwnerSection key={g.owner.id} group={g} today={today} brandName={kit.name} demo={!!brand.demo} mail={mail} admin={role === "admin"} />
            ))
          )}
          {resolved > 0 && (
            <p className="text-[13px] leading-5 text-muted">
              {resolved} earlier alert{resolved === 1 ? " is" : "s are"} not shown: the fact was renewed or removed after {resolved === 1 ? "it was" : "they were"} raised.
            </p>
          )}
        </div>

        <aside aria-labelledby="how-h" className="rounded-[20px] bg-raised p-5">
          <h2 id="how-h" className="text-[15px] font-semibold">
            How an alert is raised
          </h2>
          <p className="mt-2 text-[13.5px] leading-[21px] text-muted">
            Each fact with a Valid to date raises an alert {ALERT_THRESHOLDS.slice(0, -2).join(", ")} and {ALERT_THRESHOLDS[ALERT_THRESHOLDS.length - 2]} days before it expires, and on the day. It is raised once, when someone opens Assay, and a day nobody opened it is caught up the next time.
          </p>
          <p className="mt-3 text-[13.5px] leading-[21px] text-muted">
            {brand.demo
              ? "The people in this demo are made up and their addresses receive no mail. If email is set up here, you can send yourself one real alert."
              : "Assay keeps this inbox in your browser and sends nothing by itself. To tell an owner, use the link on an alert: it opens your mail app with the message written."}
          </p>
        </aside>
      </div>
    </div>
  );
}

function OwnerSection({ group, today, brandName, demo, mail, admin }: { group: OwnerGroup; today: string; brandName: string; demo: boolean; mail?: boolean; admin: boolean }) {
  const { owner, items, unread } = group;
  const h = `owner-${owner.id}`;
  return (
    <section aria-labelledby={h} data-deal className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={h} className="font-display text-[21px] font-medium tracking-[-0.015em]">
          {owner.name}
        </h2>
        <p className="num text-[13px] text-muted">
          {items.length} fact{items.length === 1 ? "" : "s"}
          {unread > 0 ? ` · ${unread} unread` : " · all read"}
        </p>
      </div>
      <OwnerContact owner={owner} admin={admin} />
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <AlertRow key={item.fact.id} item={item} owner={owner} today={today} brandName={brandName} demo={demo} mail={mail} />
        ))}
      </ul>
    </section>
  );
}

/** How to reach the owner: a demo address says so, a missing one asks for it, a real one can be changed. */
function OwnerContact({ owner, admin }: { owner: Owner; admin: boolean }) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const save = useAction(
    async () => {
      const value = email.trim();
      if (!EMAIL.test(value)) {
        setError("Enter a full email address, with an @ and a domain.");
        return false;
      }
      setError(undefined);
      await saveOwner(owner.id, { email: value });
      setEditing(false);
      setEmail("");
      return true;
    },
    { errorPrefix: "Could not save the address", success: (ok) => (ok ? `Saved the address for ${owner.name}.` : undefined) },
  );

  if (owner.simulated) {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] leading-5 text-muted">
        <span className="pill bg-neutral-bg text-neutral-ink">Demo address</span>
        <span className="text-ink">{owner.email}</span> is a made-up demo address. It receives no mail.
      </p>
    );
  }
  if (owner.email && !editing) {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[13.5px] leading-5 text-muted">
        <span>
          Alerts go to <span className="text-ink">{owner.email}</span>
        </span>
        {admin && (
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Change address
          </button>
        )}
      </p>
    );
  }
  return (
    <form
      noValidate
      className="mt-3 max-w-[460px]"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <Field
        label={`Email address for ${owner.name}`}
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(undefined);
        }}
        disabled={!admin}
        error={error}
        hint={admin ? `${owner.name} has no address yet. Add one so an alert can be sent to them.` : "Only a Brand Admin can add an address. Switch to Brand Admin in the top bar."}
      />
      <div className="mt-3 flex gap-2">
        <button className="btn btn-inverse btn-sm" type="submit" disabled={!admin || save.busy}>
          Save address
        </button>
        {editing && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => (setEditing(false), setError(undefined))}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function daysPill(daysLeft: number) {
  if (daysLeft < 0) return { cls: "bg-neg-bg text-neg-ink", text: `Expired ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago` };
  if (daysLeft === 0) return { cls: "bg-neg-bg text-neg-ink", text: "Expires today" };
  return { cls: daysLeft <= 14 ? "bg-warn-bg text-warn-ink border border-warn-line" : "bg-neutral-bg text-neutral-ink", text: `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` };
}

function AlertRow({ item, owner, today, brandName, demo, mail }: { item: AlertItem; owner: Owner; today: string; brandName: string; demo: boolean; mail?: boolean }) {
  const { fact, daysLeft, unread, notices } = item;
  const pill = daysPill(daysLeft);
  const markRead = useAction(async () => {
    for (const n of unread) await markNotificationRead(n.id);
  });
  const sendable = !owner.simulated && !!owner.email;
  const first = notices[notices.length - 1];
  return (
    <li className="rounded-[18px] bg-raised p-4" data-fact={fact.id} data-unread={unread.length ? "" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className={`min-w-0 flex-1 text-[14.5px] leading-[22px] ${unread.length ? "font-semibold" : ""}`}>
          {unread.length > 0 && (
            <>
              <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-gold-mark align-middle" />
              <span className="sr-only">Unread. </span>
            </>
          )}
          <Code>{fact.id}</Code> {fact.statement}
        </p>
        <span className={`pill num ${pill.cls}`}>{pill.text}</span>
      </div>

      <div className="mt-3">
        <ValidityStrip fact={fact} today={today} daysLeft={daysLeft} />
      </div>

      <p className="mt-3 text-[13px] leading-5 text-muted">
        Owner {fact.owner}
        {fact.source ? ` · source ${fact.source}` : ""} · raised for {notices.map((n) => (n.threshold === 0 ? "expiry" : `${n.threshold} day${n.threshold === 1 ? "" : "s"} before`)).reverse().join(", ")}
        {first ? `, first on ${formatDate(first.at.slice(0, 10))}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {unread.length > 0 && (
          <button className="btn btn-secondary btn-sm" disabled={markRead.busy} onClick={() => markRead.run()}>
            Mark read
          </button>
        )}
        {sendable && (
          <a className="btn btn-secondary btn-sm" href={alertMailto(fact, daysLeft, owner.email, brandName)}>
            <Mail size={14} aria-hidden="true" /> Send to {owner.name} from your mail app
          </a>
        )}
      </div>

      {demo && mail && <SendToYourself fact={fact} />}
    </li>
  );
}

/** A bar for the fact's validity with today marked on it: gold for the time used, grey for what is left, red past the expiry. */
function ValidityStrip({ fact, today, daysLeft }: { fact: Fact; today: string; daysLeft: number }) {
  const to = fact.validTo!;
  const g = stripGeometry(fact.validFrom, to, today);
  const used = Math.max(0, Math.min(g.now, g.end) - g.start);
  const left = Math.max(0, g.end - Math.max(g.now, g.start));
  const label = `${fact.validFrom ? `Valid from ${formatDate(fact.validFrom)}` : "No start date set"}, valid to ${formatDate(to)}. Today is ${formatDate(today)}: it ${whenWords(daysLeft)}.`;
  return (
    <div>
      <div role="img" aria-label={label} className="relative h-3 rounded-full bg-field">
        {used > 0 && <span data-bar aria-hidden="true" className="absolute inset-y-[3px] block rounded-full bg-gold-mark" style={{ left: `${g.start}%`, width: `${used}%` }} />}
        {left > 0 && <span aria-hidden="true" className="absolute inset-y-[4px] block rounded-full bg-bar" style={{ left: `${Math.max(g.now, g.start)}%`, width: `${left}%` }} />}
        {g.expired && <span aria-hidden="true" className="absolute inset-y-[3px] block rounded-full bg-negative" style={{ left: `${g.end}%`, width: `${g.now - g.end}%` }} />}
        <span aria-hidden="true" className="absolute -inset-y-[3px] block w-1 rounded-full bg-ink" style={{ left: `calc(${g.now}% - 2px)` }} />
      </div>
      <div aria-hidden="true" className="mt-2 flex justify-between gap-3 text-[12px] text-muted">
        <span>{fact.validFrom ? `Valid from ${formatDate(fact.validFrom)}` : "No start date; bar shows the 30 days before expiry"}</span>
        <span className="flex-none">{g.expired ? `Expired ${formatDate(to)}` : `Valid to ${formatDate(to)}`}</span>
      </div>
    </div>
  );
}

type Sent = { ok: true; subject: string } | { ok: false; message: string };

/** The demo's one real email: this fixed alert, once, to an address the visitor types. */
function SendToYourself({ fact }: { fact: Fact }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<Sent | null>(null);
  const send = useAction(
    async () => {
      const value = email.trim();
      if (!EMAIL.test(value)) {
        setError("Enter a valid email address.");
        return;
      }
      setError(undefined);
      setResult(null);
      try {
        const r = await fetch("/api/demo/fact-alert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ factId: fact.id, email: value }) });
        const j = (await r.json()) as { ok: boolean; subject?: string; message?: string };
        setResult(j.ok ? { ok: true, subject: j.subject ?? "" } : { ok: false, message: j.message ?? "The email was not sent." });
      } catch {
        setResult({ ok: false, message: "Could not reach the server. Nothing was sent." });
      }
    },
    { toastError: false },
  );
  const id = `send-${fact.id}`;
  return (
    <div className="mt-3">
      <button className="btn btn-ghost btn-sm -ml-2.5" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        Send this alert to yourself
      </button>
      {open && (
        <form
          id={id}
          noValidate
          className="mt-2 max-w-[460px] rounded-[16px] bg-sheet p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send.run();
          }}
        >
          <Field label={`Your email address, for ${fact.id}`} type="email" autoComplete="email" value={email} onChange={(e) => (setEmail(e.target.value), setError(undefined))} error={error} />
          <p className="mt-2 text-[13px] leading-5 text-muted">Only this fixed message is sent, once, to that address. Nothing you type goes into it. Only a one-way hash of the address is kept, to hold the daily limit.</p>
          <button className="btn btn-inverse btn-sm mt-3" type="submit" disabled={send.busy}>
            {send.busy ? "Sending…" : "Send email"}
          </button>
          {result && (
            <p role={result.ok ? "status" : "alert"} className={`mt-3 text-[13.5px] leading-5 ${result.ok ? "text-pos-ink" : "text-neg-ink"}`}>
              {result.ok ? `Sent: “${result.subject}”. It should arrive shortly.` : result.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
