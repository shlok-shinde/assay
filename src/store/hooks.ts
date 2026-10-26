"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Role } from "@/lib/types";
import { aiStatus, type AiStatus } from "@/lib/ai-client";
import { db } from "./db";
import { ensureSeeded } from "./actions";

export function useWorkspace(): { ready: boolean; error?: string } {
  const [state, setState] = useState<{ ready: boolean; error?: string }>({ ready: false });
  useEffect(() => {
    ensureSeeded()
      .then(() => setState({ ready: true }))
      .catch((e: Error) => setState({ ready: false, error: e.message || "This browser blocked local storage (IndexedDB)." }));
  }, []);
  return state;
}

export function useRole(): Role {
  return (useLiveQuery(() => db.meta.get("role"), [])?.value as Role | undefined) ?? "creator";
}

export function useAiStatus(): AiStatus | null | undefined {
  const [s, setS] = useState<AiStatus | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    aiStatus().then((r) => live && setS(r));
    return () => {
      live = false;
    };
  }, []);
  return s;
}

export function useKit() {
  return useLiveQuery(() => db.kits.get("velvra"), []);
}

export interface JudgeStep {
  id: string;
  label: string;
  done: boolean;
  href: string;
}

/** The six-step judge path, derived from what has actually happened in this workspace. */
export function useJudgePath(): JudgeStep[] | undefined {
  return useLiveQuery(async () => {
    const [subs, checks, versions, audit, hallmarks, visited] = await Promise.all([
      db.submissions.filter((s) => !s.seeded).toArray(),
      db.checks.count(),
      db.versions.filter((v) => v.source.kind === "fix").count(),
      db.audit.filter((a) => a.action === "submitted for review").count(),
      db.hallmarks.count(),
      db.meta.get("visitedHealth"),
    ]);
    const first = subs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const sub = first ? `/app/s/${first.id}` : "/app/new";
    return [
      { id: "sample", label: "Open a sample draft", done: subs.length > 0, href: "/app/new" },
      { id: "findings", label: "Read the cited findings", done: checks > 0, href: sub },
      { id: "fixes", label: "Accept fixes; intent is checked", done: versions > 0, href: sub },
      { id: "submit", label: "Submit for review", done: audit > 0, href: sub },
      { id: "approve", label: "Approve as Compliance, then Reviewer", done: hallmarks > 0, href: "/app/review" },
      { id: "health", label: "See Guideline Health", done: !!visited, href: "/app/health" },
    ];
  }, []);
}
