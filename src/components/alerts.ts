"use client";

// Fact-expiry alerts as the inbox and the sidebar read them: each raised notification joined to its fact in
// the latest rulebook and to the fact's owner, grouped by owner, with days left worked out from today.
import { useLiveQuery } from "dexie-react-hooks";
import type { Fact, NotificationRow, Owner } from "@/lib/types";
import { ownerId } from "@/engine/health";
import { db, todayIso } from "@/store/db";

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso + "T00:00:00Z");

/** Whole days from `today` to `iso`: negative once it has passed. */
export const daysUntil = (iso: string, today: string) => Math.round((at(iso) - at(today)) / DAY);

/** "expires in 20 days", "expires today", "expired 3 days ago". */
export function whenWords(daysLeft: number): string {
  if (daysLeft < 0) return `expired ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago`;
  if (daysLeft === 0) return "expires today";
  return `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

export interface AlertItem {
  fact: Fact;
  daysLeft: number;
  /** Every notice raised for this fact's current expiry date, newest first. */
  notices: NotificationRow[];
  unread: NotificationRow[];
}

export interface OwnerGroup {
  owner: Owner;
  items: AlertItem[];
  unread: number;
}

export interface AlertModel {
  groups: OwnerGroup[];
  /** Facts with an unread alert, the number the sidebar shows. */
  unread: number;
  /** Notices left out because the fact was renewed or removed since they were raised. */
  resolved: number;
  /** The nearest expiry that has not raised an alert yet. */
  next?: { fact: Fact; daysLeft: number };
}

/** A notice belongs to a fact only while the fact still has the expiry date it was raised for. */
export function buildAlertModel(rows: NotificationRow[], owners: Owner[], facts: Fact[], today: string): AlertModel {
  const byFact = new Map(facts.map((f) => [f.id, f]));
  const known = new Map(owners.map((o) => [o.id, o]));
  const items = new Map<string, AlertItem>();
  let resolved = 0;
  for (const n of [...rows].sort((a, b) => b.at.localeCompare(a.at))) {
    const fact = byFact.get(n.factId);
    const raisedFor = n.key.split("|")[1];
    if (!fact?.validTo || fact.validTo !== raisedFor) {
      resolved++;
      continue;
    }
    const item = items.get(fact.id) ?? { fact, daysLeft: daysUntil(fact.validTo, today), notices: [], unread: [] };
    item.notices.push(n);
    if (!n.readAt) item.unread.push(n);
    items.set(fact.id, item);
  }
  const byOwner = new Map<string, OwnerGroup>();
  for (const item of items.values()) {
    const id = ownerId(item.fact.owner);
    const group = byOwner.get(id) ?? { owner: known.get(id) ?? { id, name: item.fact.owner, email: "" }, items: [], unread: 0 };
    group.items.push(item);
    if (item.unread.length) group.unread++;
    byOwner.set(id, group);
  }
  const groups = [...byOwner.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.daysLeft - b.daysLeft) }))
    .sort((a, b) => a.items[0].daysLeft - b.items[0].daysLeft || a.owner.name.localeCompare(b.owner.name));
  const next = facts
    .filter((f) => f.validTo && !items.has(f.id) && daysUntil(f.validTo, today) >= 0)
    .map((fact) => ({ fact, daysLeft: daysUntil(fact.validTo!, today) }))
    .sort((a, b) => a.daysLeft - b.daysLeft)[0];
  return { groups, unread: groups.reduce((n, g) => n + g.unread, 0), resolved, next };
}

/** The inbox's data, live: notifications, owners and the latest rulebook's facts. */
export function useAlertModel(today = todayIso()): AlertModel | undefined {
  return useLiveQuery(async () => {
    const [rows, owners, rb] = await Promise.all([db.notifications.toArray(), db.owners.toArray(), db.rulebooks.orderBy("publishedAt").last()]);
    return buildAlertModel(rows, owners, rb?.snapshot.facts ?? [], today);
  }, [today]);
}

/** How many facts have an alert nobody has read, for the sidebar. Undefined until the first read. */
export function useUnreadAlerts(): number | undefined {
  return useAlertModel()?.unread;
}

/** The alert as a mail to the fact's owner, for a mail app: the way to send it for a brand that has real addresses. */
export function alertMailto(fact: Fact, daysLeft: number, to: string, brandName: string): string {
  const subject = `${brandName} Claim Ledger: ${fact.id} ${whenWords(daysLeft)}`;
  const body = [
    `Hello ${fact.owner},`,
    ``,
    `${fact.id}: ${fact.statement}`,
    `Valid to ${fact.validTo}, so it ${whenWords(daysLeft)}.${fact.source ? ` Source: ${fact.source}.` : ""}`,
    ``,
    `Please renew this fact or retire it. Until then, drafts that use it get a finding in Assay.`,
  ].join("\n");
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Where a fact's validity sits on its strip, as percentages of the strip's width. The strip runs from the
 * fact's `validFrom` (or, with none, 30 days before it expires) to its expiry, and past the expiry to today
 * once it has expired, so today's marker is always on it.
 */
export function stripGeometry(from: string | undefined, to: string, today: string) {
  const end = at(to);
  const start = from ? at(from) : end - 30 * DAY;
  const now = at(today);
  const lo = Math.min(start, now);
  const span = Math.max(Math.max(end, now) - lo, DAY);
  const pos = (x: number) => ((x - lo) / span) * 100;
  return { start: pos(start), end: pos(end), now: pos(now), expired: now > end, hasFrom: !!from };
}
