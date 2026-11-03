"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { motionAllowed, useDealIn, useGlide } from "./motion";
import { useLiveQuery } from "dexie-react-hooks";
import { Activity, BookOpen, CalendarClock, Check, ClipboardCheck, FilePlus2, Inbox, ListChecks, Menu, RotateCcw, ShieldCheck, Stamp, Users, X } from "lucide-react";
import type { Role } from "@/lib/types";
import type { Brand } from "@/store/brands";
import { DB_STALE_EVENT, db } from "@/store/db";
import { KIT_ID, resetDemo, setRole, syncFactAlerts } from "@/store/actions";
import { useAiStatus, useJudgePath, useKit, useRole, useWorkspace } from "@/store/hooks";
import { useUnreadAlerts } from "./alerts";
import { BookProvider } from "./BookDrawer";
import { BrandSwitcher, useBrand } from "./BrandSwitcher";
import { ConfirmProvider, ToastProvider, useAction, useConfirm, useModal, useToast } from "./primitives";
import { Mark, ROLE_LABEL, StatusPanel } from "./ui";

const ROLES: Role[] = ["creator", "reviewer", "compliance", "admin"];

function useQueueCounts(role: Role) {
  return useLiveQuery(async () => {
    const review = await db.submissions.filter((s) => !s.seeded && s.status === "in_review").toArray();
    const compliance = await db.findings.where("status").equals("sent_to_compliance").count();
    const drafts = await db.submissions.filter((s) => !s.seeded && (s.status === "checked" || s.status === "changes_requested" || s.status === "draft")).count();
    return { review: review.length, compliance, drafts };
  }, [role]);
}

function NavItem({ href, icon, label, count, onNavigate }: { href: string; icon: ReactNode; label: string; count?: number; onNavigate?: () => void }) {
  const path = usePathname();
  const active = href === "/app" ? path === "/app" : path.startsWith(href);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex h-[34px] items-center gap-2.5 rounded-[10px] px-2.5 text-sm transition-colors ${
        active ? "text-ink font-medium" : "text-muted hover:text-ink hover:translate-x-0.5"
      } relative z-10 transition-[color,transform] duration-300`}
    >
      <span className={`transition-colors duration-300 ${active ? "text-ink" : "text-faint"}`} aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count ? <span className="num rounded-full bg-ink px-1.5 text-[11px] font-semibold leading-[18px] text-sheet">{count}</span> : null}
    </Link>
  );
}

// Whether this browser has put the judge path away. Kept in localStorage, shared by the two places the
// sidebar is drawn (the desktop column and the phone menu), and null until the browser has been asked,
// so the server-built frame and the first client frame agree.
const JUDGE_KEY = "assay:judge-path-dismissed";
let judgeDismissed: boolean | null = null;
const judgeListeners = new Set<() => void>();

function readJudgeDismissed(): boolean {
  if (judgeDismissed === null) {
    try {
      judgeDismissed = window.localStorage.getItem(JUDGE_KEY) === "1";
    } catch {
      judgeDismissed = false;
    }
  }
  return judgeDismissed;
}

function setJudgeDismissed(value: boolean) {
  judgeDismissed = value;
  try {
    if (value) window.localStorage.setItem(JUDGE_KEY, "1");
    else window.localStorage.removeItem(JUDGE_KEY);
  } catch {
    // Storage is blocked: the choice lasts until the page is closed, which is all that can be kept.
  }
  judgeListeners.forEach((l) => l());
}

function subscribeJudge(listener: () => void) {
  judgeListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== JUDGE_KEY) return;
    judgeDismissed = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    judgeListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** True once the judge path has been dismissed in this browser, null while that is not yet known. */
function useJudgeDismissed(): boolean | null {
  return useSyncExternalStore(subscribeJudge, readJudgeDismissed, () => null);
}

function JudgePath({ onNavigate }: { onNavigate?: () => void }) {
  const steps = useJudgePath();
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  // A step that has just been done gets its tick struck in; steps done before this page opened stay still.
  useEffect(() => {
    if (!steps) return;
    const done = new Set(steps.filter((x) => x.done).map((x) => x.id));
    if (seen.current && motionAllowed())
      for (const id of done)
        if (!seen.current.has(id)) {
          const tick = box.current?.querySelector(`[data-tick="${id}"]`);
          if (tick) gsap.fromTo(tick, { scale: 0, rotation: -120 }, { scale: 1, rotation: 0, duration: 0.5, ease: "back.out(2.6)", overwrite: true, clearProps: "transform" });
        }
    seen.current = done;
  }, [steps]);
  if (!steps) return null;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <div ref={box} className="rounded-[18px] bg-sheet border border-line p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold">Judge path</p>
        <div className="flex items-center gap-1">
          <p className="num text-[12px] text-muted">
            {done} of {steps.length}
          </p>
          <button type="button" className="btn btn-ghost -mr-1.5 h-7 w-7 !px-0 text-muted" aria-label="Dismiss the judge path" onClick={() => setJudgeDismissed(true)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-rule" aria-hidden="true">
        <div className="h-1.5 rounded-full bg-gold-mark transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 space-y-1.5">
        {steps.map((s) => (
          <li key={s.id}>
            <Link href={s.href} onClick={onNavigate} className={`flex items-start gap-2 text-[12.5px] leading-[18px] ${s.done ? "text-muted" : s === next ? "text-ink font-medium" : "text-muted"} hover:text-ink`}>
              <span
                data-tick={s.id}
                className={`mt-[1px] flex h-4 w-4 flex-none items-center justify-center rounded-full ${s.done ? "bg-positive text-sheet" : s === next ? "border-2 border-gold-mark" : "border border-control"}`}
                aria-hidden="true"
              >
                {s.done && <Check size={10} strokeWidth={3} />}
              </span>
              <span>
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : ""}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The judge path's frame at its real size, for the moment before the workspace is open. */
function JudgePending() {
  return (
    <div className="rounded-[18px] bg-sheet border border-line p-3.5" aria-hidden="true">
      <div className="flex h-7 items-center justify-between">
        <p className="text-[13px] font-semibold">Judge path</p>
        <span className="h-3 w-9 rounded-full bg-track" />
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-rule" />
      <ul className="mt-3 space-y-1.5">
        {[78, 70, 88, 52, 84, 60].map((w, i) => (
          <li key={i} className="flex h-[18px] items-center gap-2">
            <span className="h-4 w-4 flex-none rounded-full bg-track" />
            <span className="h-3 rounded-full bg-track" style={{ width: `${w}%` }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The sidebar's frame. It reads nothing from the workspace itself: `live` is false while the
 * workspace is still opening (or this tab has lost it), so the same links and the same sizes are
 * there, with the queue counts, the rulebook version and the judge path still to come.
 */
function SidebarBody({
  live,
  role,
  counts,
  version,
  unread,
  brand,
  name,
  onNavigate,
}: {
  live: boolean;
  role: Role;
  counts?: ReturnType<typeof useQueueCounts>;
  version?: string;
  /** Facts with an alert nobody has read. */
  unread?: number;
  /** The brand this browser is on; null until the browser has said (the server-built frame). */
  brand: Brand | null;
  /** The kit's own name. */
  name?: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const dismissed = useJudgeDismissed();
  const [resetting, setResetting] = useState(false);
  const reset = useAction(
    async () => {
      const yes = await confirm({
        title: "Reset the demo?",
        body: `This deletes every draft, decision and Hallmark in this browser and restores the ${name ?? "Velvra"} seed.`,
        confirmLabel: "Delete and reset",
        danger: true,
      });
      if (!yes) return false;
      setResetting(true);
      try {
        await resetDemo();
        setJudgeDismissed(false);
      } finally {
        setResetting(false);
      }
      onNavigate?.();
      router.push("/app");
      return true;
    },
    { errorPrefix: "Could not reset the demo", success: (done) => (done ? "The demo is back to its seed." : undefined) },
  );
  const reviewCount = role === "compliance" ? counts?.compliance : role === "reviewer" ? counts?.review : undefined;
  const path = usePathname();
  const nav = useRef<HTMLElement>(null);
  const here = useRef<HTMLSpanElement>(null);
  useGlide(nav, here, '[aria-current="page"]', [path], "both");
  return (
    <div className="flex h-full flex-col gap-5 px-3 pb-4">
      <div className="px-1 pt-3">
        <Link href="/" className="flex items-center gap-2.5" onClick={onNavigate}>
          <Mark size={28} />
          <span className="font-display text-[21px] font-medium tracking-[-0.02em]">Assay</span>
        </Link>
        {live && brand && name ? (
          <BrandSwitcher brand={brand} name={name} version={version} onNavigate={onNavigate} />
        ) : (
          <div className="mt-3 rounded-[14px] border border-line bg-sheet px-3 py-2" aria-hidden="true">
            <span className="block h-[18px] py-[3px]">
              <span className="block h-3 w-28 rounded-full bg-track" />
            </span>
            <span className="block h-[18px] py-[3px]">
              <span className="block h-3 w-40 rounded-full bg-track" />
            </span>
          </div>
        )}
      </div>
      <nav ref={nav} aria-label="Main" className="relative space-y-0.5">
        <span ref={here} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 rounded-[10px] bg-active opacity-0" />
        <NavItem href="/app" icon={<Inbox size={16} />} label="Drafts" count={role === "creator" ? counts?.drafts : undefined} onNavigate={onNavigate} />
        <NavItem href="/app/new" icon={<FilePlus2 size={16} />} label="New draft" onNavigate={onNavigate} />
        <NavItem href="/app/review" icon={<ClipboardCheck size={16} />} label="Review queue" count={reviewCount} onNavigate={onNavigate} />
        <NavItem href="/app/kit" icon={<BookOpen size={16} />} label="Brand Kit" onNavigate={onNavigate} />
        <NavItem href="/app/health" icon={<Activity size={16} />} label="Guideline Health" onNavigate={onNavigate} />
        <NavItem href="/app/inbox" icon={<CalendarClock size={16} />} label="Expiry inbox" count={unread} onNavigate={onNavigate} />
        <NavItem href="/app/hallmarks" icon={<Stamp size={16} />} label="Hallmarks" onNavigate={onNavigate} />
        {brand?.team && <NavItem href="/app/team" icon={<Users size={16} />} label="Team" onNavigate={onNavigate} />}
        <NavItem href="/about" icon={<ShieldCheck size={16} />} label="About and trust" onNavigate={onNavigate} />
      </nav>
      <div className="mt-auto space-y-3">
        {(!brand || brand.demo) && dismissed !== true && (live ? <JudgePath onNavigate={onNavigate} /> : <JudgePending />)}
        {brand?.demo && dismissed === true && (
          <button type="button" className="btn btn-ghost btn-sm w-full justify-start text-muted" onClick={() => setJudgeDismissed(false)}>
            <ListChecks size={14} aria-hidden="true" /> Show the judge path
          </button>
        )}
        {(!brand || brand.demo) && (
          <button className="btn btn-ghost btn-sm w-full justify-start text-muted" disabled={!live || resetting} onClick={() => reset.run()}>
            <RotateCcw size={14} /> {resetting ? "Resetting…" : "Reset demo"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Reads the workspace, so it only mounts once the workspace is open. */
function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const role = useRole();
  const counts = useQueueCounts(role);
  const kit = useKit();
  const brand = useBrand();
  const unread = useUnreadAlerts();
  const rb = useLiveQuery(() => db.rulebooks.orderBy("publishedAt").last(), []);
  return <SidebarBody live role={role} counts={counts} version={rb?.version} unread={unread} brand={brand} name={kit?.name} onNavigate={onNavigate} />;
}

/**
 * The four roles. With no `role` (the workspace is still opening) none is selected and none can be chosen yet.
 * The cream pill glides to the chosen role; once it has arrived the chosen button takes the same fill itself,
 * so what is measured as the text's background is the pill that really sits behind it.
 */
function RoleSwitcherView({ role, onPick }: { role?: Role; onPick?: (r: Role) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useGlide(box, pill, '[aria-checked="true"]', [role], "both");
  // The role the pill has finished travelling to. It equals `role` at rest, and lags it for the length of a glide.
  const [arrived, setArrived] = useState(role);
  useEffect(() => {
    if (arrived === role) return;
    const t = window.setTimeout(() => setArrived(role), motionAllowed() ? 520 : 0);
    return () => window.clearTimeout(t);
  }, [role, arrived]);
  return (
    <div ref={box} role="radiogroup" aria-label="Viewing as" className="relative flex w-max items-center gap-1 rounded-full bg-track p-1">
      <span ref={pill} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 rounded-full bg-ink opacity-0" />
      <span className="hidden pl-2 pr-1 text-[12px] text-muted lg:inline">Viewing as</span>
      {ROLES.map((r) => {
        const chosen = role === r;
        return (
          <button
            key={r}
            role="radio"
            aria-checked={chosen}
            disabled={!onPick}
            onClick={() => onPick?.(r)}
            // Only the text colour fades: a fading fill on the role just left read as a second pill behind the glide.
            className={`relative h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[13px] transition-[color] active:scale-95 ${
              chosen ? `font-medium text-sheet delay-100 duration-200 ${arrived === r ? "bg-ink" : ""}` : "text-muted duration-300 hover:text-ink"
            }`}
          >
            {ROLE_LABEL[r]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * In a team workspace the role is set by a Brand Admin and checked on the server. An admin may still take any
 * desk, so keeps the switcher; everyone else sees who they are, read-only.
 */
function RoleSwitcher() {
  const role = useRole();
  const brand = useBrand();
  if (brand?.team && brand.team.role !== "admin") {
    return (
      <p className="flex w-max items-center gap-2 rounded-full bg-track py-1 pl-3 pr-4 text-[13px]" data-testid="role-chip">
        <span className="text-muted">You are</span>
        <span className="font-medium">{brand.team.name}</span>
        <span className="pill bg-active text-ink">{ROLE_LABEL[brand.team.role]}</span>
      </p>
    );
  }
  return <RoleSwitcherView role={role} onPick={setRole} />;
}

type SyncPhase = { phase: "synced" | "waiting" | "offline" | "signed-out"; waiting: number; refused?: string };

/**
 * A team workspace's sync, in one small chip: Synced, N waiting, Offline, or Sign in again. It loads the sync code
 * only here, so a demo visitor never downloads it. A change the server refused is said once, in its own words.
 */
function TeamSync() {
  const brand = useBrand();
  const toast = useToast();
  const [state, setState] = useState<SyncPhase | null>(null);
  const told = useRef<string | undefined>(undefined);
  const isTeam = !!brand?.team;
  useEffect(() => {
    if (!isTeam) return;
    let live = true;
    let off = () => {};
    void import("@/store/team").then((t) => {
      if (!live) return;
      setState(t.syncState());
      const on = (e: Event) => setState((e as CustomEvent<SyncPhase>).detail);
      window.addEventListener(t.SYNC_EVENT, on);
      off = () => window.removeEventListener(t.SYNC_EVENT, on);
    });
    return () => {
      live = false;
      off();
    };
  }, [isTeam]);
  const refused = state?.refused;
  useEffect(() => {
    if (!refused) {
      told.current = undefined;
      return;
    }
    if (told.current === refused) return;
    told.current = refused;
    toast(refused, { tone: "error" });
  }, [refused, toast]);
  if (!isTeam || !state) return null;
  const waiting = state.waiting;
  const label =
    state.phase === "signed-out" ? "Sign in again" : state.phase === "offline" ? (waiting ? `Offline, ${waiting} waiting` : "Offline") : waiting ? `${waiting} waiting` : state.phase === "synced" ? "Synced" : "Syncing";
  const dot = state.phase === "signed-out" ? "bg-negative" : state.phase === "offline" ? "bg-warn-mark" : state.phase === "synced" && !waiting ? "bg-positive" : "status-pulse bg-gold-mark";
  const signedOut = state.phase === "signed-out";
  return (
    <p role="status" data-testid="sync-chip" className={`flex items-center gap-2 rounded-full px-3 py-1 text-[12.5px] ${signedOut ? "bg-neg-bg text-neg-ink" : "text-muted"}`}>
      <span className={`h-2 w-2 flex-none rounded-full ${dot}`} aria-hidden="true" />
      {signedOut ? (
        <Link href="/team" className="underline">
          {label}
        </Link>
      ) : (
        label
      )}
    </p>
  );
}

function AiBadge() {
  const s = useAiStatus();
  const kit = useLiveQuery(() => db.kits.get(KIT_ID), []);
  const label =
    s === undefined ? "Checking AI…" : kit?.confidential ? "Confidential mode: rule checks only" : s?.aiConfigured ? `AI judgment on · ${s.keysAvailable}/${s.keyCount} keys ready` : "Rule checks only (no AI key)";
  const on = !!s?.aiConfigured && !kit?.confidential;
  return (
    <Link href="/about#ai" className="hidden items-center gap-2 rounded-full px-3 py-1 text-[12.5px] text-muted hover:text-ink md:flex">
      <span className={`h-2 w-2 rounded-full ${s === undefined ? "status-pulse bg-gold-mark" : on ? "bg-positive" : "bg-faint"}`} aria-hidden="true" />
      {label}
    </Link>
  );
}

/** A team workspace that won't open says why in the server's own sentence, and where to go about it. */
function TeamBlocked({ detail }: { detail: string }) {
  const unreachable = /failed to fetch|network|load failed/i.test(detail);
  return (
    <StatusPanel
      fullscreen
      title="This team workspace can't open yet"
      actions={
        <>
          <Link href="/team" className="btn btn-inverse btn-lg">
            Go to sign-in
          </Link>
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => window.location.reload()}>
            Try again
          </button>
        </>
      }
    >
      <p role="alert">{unreachable ? "Assay couldn't reach the team server, and this browser has no copy of the workspace yet. Check the connection and try again." : detail}</p>
      <p>Your demo and any brands kept only in this browser are not affected.</p>
    </StatusPanel>
  );
}

/** Why Assay can't run here, said plainly, with the one thing that usually fixes it. */
function WorkspaceBlocked({ detail }: { detail: string }) {
  return (
    <StatusPanel
      fullscreen
      title="Assay can't open its workspace"
      actions={
        <>
          <button type="button" className="btn btn-inverse btn-lg" onClick={() => window.location.reload()}>
            Try again
          </button>
          <Link href="/" className="btn btn-ghost btn-lg">
            Back to the home page
          </Link>
        </>
      }
    >
      <p>
        Assay keeps your drafts in this browser, in a storage area called IndexedDB, and the browser is not letting it. The usual cause is a private or incognito window, or a setting that blocks site data.
      </p>
      <p>Open Assay in a normal window, or allow site data for this site, then try again.</p>
      <p className="text-[13px] text-faint">
        What the browser said: <code className="font-mono text-[12.5px]">{detail}</code>
      </p>
    </StatusPanel>
  );
}

/** Another tab upgraded the database and this one closed its connection: it can only be reloaded. */
function useStaleDatabase() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const on = () => setStale(true);
    window.addEventListener(DB_STALE_EVENT, on);
    return () => window.removeEventListener(DB_STALE_EVENT, on);
  }, []);
  return stale;
}

function StaleBanner() {
  return (
    <div role="alert" className="sticky top-0 z-50 m-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[20px] bg-warn-bg px-4 py-3 text-[14px] leading-5 text-warn-ink lg:col-span-2">
      <p className="min-w-0 flex-1">Assay was updated in another tab, so this one has stopped using your drafts to keep them safe. Reload to carry on.</p>
      <button type="button" className="btn btn-inverse btn-sm" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const stale = useStaleDatabase();
  // The frame reads the workspace too (queue counts, the role, the judge path). It only does so once the
  // workspace is open and still ours: before that the same frame is drawn at full size with those parts
  // empty, so a blocked database reaches the message below and not a crash, and nothing jumps when it opens.
  const live = ws.ready && !stale;
  const brand = useBrand();
  // Raise any fact-expiry alert that is due as soon as the workspace is open.
  useEffect(() => {
    if (live) void syncFactAlerts().catch((e) => console.warn("Could not raise fact alerts.", e));
  }, [live]);
  // The phone menu is a modal dialog: Tab stays inside it, Escape and the Close button shut it, and focus
  // goes back to the button that opened it. Each link closes it through onNavigate.
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const modal = useModal(open, () => setOpen(false));
  // It opens as a circle growing from the menu button, its links following one by one.
  const menu = modal.ref;
  useGSAP(
    () => {
      if (!open || !menu.current || !motionAllowed()) return;
      // Both ends of the circle are stated: from() aimed it at "none", which can't be tweened, so the menu
      // stayed clipped to nothing (and swallowed taps, being modal) until it snapped open at the end.
      // 150% of the circle's reference radius covers the screen from the corner.
      gsap
        .timeline()
        .fromTo(menu.current, { clipPath: "circle(0% at 28px 24px)" }, { clipPath: "circle(150% at 28px 24px)", duration: 0.55, ease: "expo.out", overwrite: true, clearProps: "clipPath" })
        .fromTo(menu.current.querySelectorAll("nav a"), { x: -18, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, stagger: 0.035, ease: "power3.out", overwrite: true, clearProps: "transform,opacity" }, 0.12);
    },
    { dependencies: [open] },
  );
  // A phone menu left open while the window widens to the desktop layout would keep the page behind it inert.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const onChange = () => wide.matches && setOpen(false);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  if (ws.error) return brand?.team ? <TeamBlocked detail={ws.error} /> : <WorkspaceBlocked detail={ws.error} />;

  return (
    <div className="theme-night min-h-screen bg-chrome text-ink lg:grid lg:grid-cols-[236px_minmax(0,1fr)] print:block print:min-h-0 print:bg-white">
      <a href="#main" className="skip-link print:hidden">
        Skip to main content
      </a>
      <ToastProvider>
        <ConfirmProvider>
          <BookProvider>
          {stale && <StaleBanner />}
          <aside className="sticky top-0 hidden h-screen lg:block print:hidden">{live ? <Sidebar /> : <SidebarBody live={false} role="creator" brand={brand} />}</aside>
          <div className="flex min-h-screen min-w-0 flex-col">
            <header className="sticky top-0 z-20 flex h-12 items-center gap-3 bg-chrome px-4 lg:static lg:px-2 lg:pr-3 print:hidden">
              <button ref={menuButton} type="button" className="btn btn-ghost btn-sm -ml-2 lg:hidden" aria-label="Open menu" aria-haspopup="dialog" onClick={() => setOpen(true)}>
                <Menu size={18} />
              </button>
              <Link href="/app" className="flex items-center gap-2 lg:hidden">
                <Mark size={22} />
                <span className="font-display text-[19px] font-medium tracking-[-0.02em]">Assay</span>
              </Link>
              <div className="hidden flex-1 justify-center lg:flex">{live ? <RoleSwitcher /> : <RoleSwitcherView />}</div>
              <div className="ml-auto flex items-center gap-1 lg:ml-0">
                {live && <TeamSync />}
                {live && <AiBadge />}
              </div>
            </header>
            <div className="border-b border-line bg-chrome px-4 pb-2 lg:hidden print:hidden">
              <div className="overflow-x-auto">{live ? <RoleSwitcher /> : <RoleSwitcherView />}</div>
            </div>
            <main id="main" tabIndex={-1} className="min-w-0 flex-1 bg-sheet outline-none lg:mb-2 lg:mr-2 lg:rounded-[20px] lg:border lg:border-line print:m-0 print:rounded-none print:border-0 print:bg-white">
              {stale ? (
                <div className="p-6 text-sm text-muted" role="status">
                  This tab is out of date. Reload it to carry on.
                </div>
              ) : ws.ready ? (
                children
              ) : (
                <div className="p-6 text-sm text-muted" role="status">
                  {brand?.demo ? "Opening the Velvra demo workspace…" : brand ? `Opening the ${brand.name} workspace…` : "Opening the workspace…"}
                </div>
              )}
            </main>
          </div>
          <dialog {...modal} aria-label="Menu" className="dialog fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-chrome p-0 text-ink lg:hidden print:hidden">
            {open && (
              <>
                <div className="flex h-12 items-center justify-end px-4">
                  <button type="button" className="btn btn-ghost btn-sm" aria-label="Close menu" onClick={() => setOpen(false)}>
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
                <div className="h-[calc(100dvh-48px)] overflow-y-auto">
                  {live ? <Sidebar onNavigate={() => setOpen(false)} /> : <SidebarBody live={false} role="creator" brand={brand} onNavigate={() => setOpen(false)} />}
                </div>
              </>
            )}
          </dialog>
          </BookProvider>
        </ConfirmProvider>
      </ToastProvider>
    </div>
  );
}

/** The title row every app screen starts with: one h1, an optional finding, actions on the right. */
export function TitleRow({ title, sub, actions, crumb }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  // Each screen opens with its title rising into place, the line under it a beat later.
  useDealIn(row, "h1, [data-sub]", [typeof title === "string" ? title : ""], "rise", 80);
  return (
    <div ref={row} className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {crumb && <div className="mb-1 text-[13px] text-muted">{crumb}</div>}
        <h1 className="font-display text-[24px] font-medium leading-8 tracking-[-0.02em] md:text-[30px] md:leading-9">{title}</h1>
        {sub && (
          <div data-sub className="mt-1 max-w-[720px] text-[14px] leading-[22px] text-muted">
            {sub}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
