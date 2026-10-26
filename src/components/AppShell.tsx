"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Activity, BookOpen, Check, ClipboardCheck, FilePlus2, Inbox, Menu, RotateCcw, ShieldCheck, Stamp, X } from "lucide-react";
import type { Role } from "@/lib/types";
import { db } from "@/store/db";
import { resetDemo, setRole } from "@/store/actions";
import { useAiStatus, useJudgePath, useRole, useWorkspace } from "@/store/hooks";
import { Mark, ROLE_LABEL } from "./ui";

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
        active ? "bg-active text-ink font-medium" : "text-muted hover:text-ink hover:bg-[#efebe0]"
      }`}
    >
      <span className="text-[#6b665a]" aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count ? <span className="num rounded-full bg-ink px-1.5 text-[11px] font-semibold leading-[18px] text-white">{count}</span> : null}
    </Link>
  );
}

function JudgePath({ onNavigate }: { onNavigate?: () => void }) {
  const steps = useJudgePath();
  if (!steps) return null;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <div className="rounded-[14px] bg-sheet border border-line p-3.5">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-semibold">Judge path</p>
        <p className="num text-[12px] text-muted">
          {done} of {steps.length}
        </p>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-rule" aria-hidden="true">
        <div className="h-1.5 rounded-full bg-gold-mark transition-[width] duration-300" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 space-y-1.5">
        {steps.map((s) => (
          <li key={s.id}>
            <Link href={s.href} onClick={onNavigate} className={`flex items-start gap-2 text-[12.5px] leading-[18px] ${s.done ? "text-muted" : s === next ? "text-ink font-medium" : "text-muted"} hover:text-ink`}>
              <span
                className={`mt-[1px] flex h-4 w-4 flex-none items-center justify-center rounded-full ${s.done ? "bg-positive text-white" : s === next ? "border-2 border-gold-mark" : "border border-control"}`}
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

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const role = useRole();
  const counts = useQueueCounts(role);
  const rb = useLiveQuery(() => db.rulebooks.orderBy("publishedAt").last(), []);
  const router = useRouter();
  const [resetting, setResetting] = useState(false);
  const reviewCount = role === "compliance" ? counts?.compliance : role === "reviewer" ? counts?.review : undefined;
  return (
    <div className="flex h-full flex-col gap-5 px-3 pb-4">
      <div className="px-1 pt-3">
        <Link href="/" className="flex items-center gap-2.5" onClick={onNavigate}>
          <Mark size={28} />
          <span className="text-[17px] font-semibold tracking-[-0.01em]">Assay</span>
        </Link>
        <div className="mt-3 rounded-[12px] bg-sheet border border-line px-3 py-2">
          <p className="text-[13px] font-medium">Velvra workspace</p>
          <p className="text-[12px] text-muted">
            Rulebook v{rb?.version ?? "3.2"} · demo data in this browser
          </p>
        </div>
      </div>
      <nav aria-label="Main" className="space-y-0.5">
        <NavItem href="/app" icon={<Inbox size={16} />} label="Drafts" count={role === "creator" ? counts?.drafts : undefined} onNavigate={onNavigate} />
        <NavItem href="/app/new" icon={<FilePlus2 size={16} />} label="New draft" onNavigate={onNavigate} />
        <NavItem href="/app/review" icon={<ClipboardCheck size={16} />} label="Review queue" count={reviewCount} onNavigate={onNavigate} />
        <NavItem href="/app/kit" icon={<BookOpen size={16} />} label="Brand Kit" onNavigate={onNavigate} />
        <NavItem href="/app/health" icon={<Activity size={16} />} label="Guideline Health" onNavigate={onNavigate} />
        <NavItem href="/app/hallmarks" icon={<Stamp size={16} />} label="Hallmarks" onNavigate={onNavigate} />
        <NavItem href="/about" icon={<ShieldCheck size={16} />} label="About and trust" onNavigate={onNavigate} />
      </nav>
      <div className="mt-auto space-y-3">
        <JudgePath onNavigate={onNavigate} />
        <button
          className="btn btn-ghost btn-sm w-full justify-start text-muted"
          disabled={resetting}
          onClick={async () => {
            if (!confirm("Reset the demo? This deletes every draft, decision and Hallmark in this browser and restores the Velvra seed.")) return;
            setResetting(true);
            await resetDemo();
            setResetting(false);
            onNavigate?.();
            router.push("/app");
          }}
        >
          <RotateCcw size={14} /> {resetting ? "Resetting…" : "Reset demo"}
        </button>
      </div>
    </div>
  );
}

function RoleSwitcher() {
  const role = useRole();
  return (
    <div role="radiogroup" aria-label="Viewing as" className="flex items-center gap-1 rounded-full bg-[#ece7db] p-1">
      <span className="hidden pl-2 pr-1 text-[12px] text-muted lg:inline">Viewing as</span>
      {ROLES.map((r) => (
        <button
          key={r}
          role="radio"
          aria-checked={role === r}
          onClick={() => setRole(r)}
          className={`h-7 rounded-full px-3 text-[13px] transition-colors ${role === r ? "bg-sheet text-ink font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-muted hover:text-ink"}`}
        >
          {ROLE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

function AiBadge() {
  const s = useAiStatus();
  const kit = useLiveQuery(() => db.kits.get("velvra"), []);
  const label =
    s === undefined ? "Checking AI…" : kit?.confidential ? "Confidential mode: rule checks only" : s?.aiConfigured ? `AI judgment on · ${s.keysAvailable}/${s.keyCount} keys ready` : "Rule checks only (no AI key)";
  const on = !!s?.aiConfigured && !kit?.confidential;
  return (
    <Link href="/about#ai" className="hidden items-center gap-2 rounded-full px-3 py-1 text-[12.5px] text-muted hover:text-ink md:flex">
      <span className={`h-2 w-2 rounded-full ${on ? "bg-positive" : "bg-faint"}`} aria-hidden="true" />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  // The phone menu closes through each link's onNavigate.
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-chrome lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen lg:block">
        <Sidebar />
      </aside>
      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-3 bg-chrome px-4 lg:static lg:px-2 lg:pr-3">
          <button className="btn btn-ghost btn-sm -ml-2 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <Link href="/app" className="flex items-center gap-2 lg:hidden">
            <Mark size={22} />
            <span className="font-semibold">Assay</span>
          </Link>
          <div className="hidden flex-1 justify-center lg:flex">
            <RoleSwitcher />
          </div>
          <div className="ml-auto lg:ml-0">
            <AiBadge />
          </div>
        </header>
        <div className="border-b border-line bg-chrome px-4 pb-2 lg:hidden">
          <div className="overflow-x-auto">
            <RoleSwitcher />
          </div>
        </div>
        <main id="main" className="min-w-0 flex-1 bg-sheet lg:mb-2 lg:mr-2 lg:rounded-[20px] lg:border lg:border-line">
          {ws.error ? (
            <div className="p-6">
              <p className="text-sm text-neg-ink">Assay could not open its local workspace: {ws.error}</p>
            </div>
          ) : ws.ready ? (
            children
          ) : (
            <div className="p-6 text-sm text-muted" role="status">
              Opening the Velvra demo workspace…
            </div>
          )}
        </main>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 bg-chrome lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex h-12 items-center justify-end px-4">
            <button className="btn btn-ghost btn-sm" aria-label="Close menu" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <div className="h-[calc(100vh-48px)] overflow-y-auto">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

/** The title row every app screen starts with: one h1, an optional finding, actions on the right. */
export function TitleRow({ title, sub, actions, crumb }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {crumb && <div className="mb-1 text-[13px] text-muted">{crumb}</div>}
        <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.01em]">{title}</h1>
        {sub && <div className="mt-1 max-w-[720px] text-[14px] leading-[22px] text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
