import { Check, CircleDashed, OctagonX, TriangleAlert } from "lucide-react";
import type { IntentCheckResult } from "@/lib/types";

export type IntentVerdict = NonNullable<IntentCheckResult["verdict"]>;

/** What a check says, for places that hold only the term check's own result (a preview, before anything was stored). */
export function previewIntent(r: { checked: boolean; kept: boolean; summary: string }): IntentCheckResult {
  return { kept: r.kept, verdict: !r.checked ? "unchecked" : r.kept ? "kept" : "review", summary: r.summary };
}

// Each verdict has its own shape and colour, so none is told apart by colour alone. A check that could not
// run is neutral and never reads as a pass: "kept" is only said when something was compared.
// Every summary names its own verdict ("Intent kept…", "Check intent…", "Intent may be lost…", "Intent not
// checked…"), so the icon is only a second signal and is hidden from assistive tech.
const LOOK: Record<IntentVerdict, { Icon: typeof Check; cls: string }> = {
  kept: { Icon: Check, cls: "text-positive" },
  review: { Icon: TriangleAlert, cls: "text-warn-ink" },
  lost: { Icon: OctagonX, cls: "text-neg-ink" },
  unchecked: { Icon: CircleDashed, cls: "text-muted" },
};

/** The intent check's verdict and its sentence, as stored on a finding or a version. */
export function IntentLine({ check, className = "" }: { check: IntentCheckResult; className?: string }) {
  const verdict: IntentVerdict = check.verdict ?? (check.kept ? "kept" : "review");
  const { Icon, cls } = LOOK[verdict];
  return (
    <p data-intent={verdict} className={`flex items-start gap-1.5 text-[13px] leading-5 ${cls} ${className}`}>
      <Icon size={14} strokeWidth={verdict === "kept" ? 2.4 : 2} aria-hidden="true" className="mt-[3px] flex-none" />
      <span>
        {check.summary}
        {check.ai && <span className="text-muted"> · {check.ai.model}</span>}
      </span>
    </p>
  );
}
