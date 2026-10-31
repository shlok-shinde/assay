"use client";

// Applying accepted fixes when some of them want the same words. Where two fixes overlap only one can
// stand, so before anything is applied each such place is shown as the sentence, what each fix would make
// of it side by side, the code's own merge when it found a safe one, and two more ways out: ask the AI for
// a merge (checked by the same validation as the code's), or write the words yourself. The more serious
// rule's fix is chosen until the creator says otherwise. The store does the applying; this only decides.
import { useId, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import type { Finding } from "@/lib/types";
import { applyFixPlan, type ConflictChoice, type FixConflict as Conflict, type FixPlan } from "@/engine/fix";
import { sentences } from "@/engine/text";
import { aiMergeFixes } from "@/store/actions";
import { useAiStatus } from "@/store/hooks";
import { diff_match_patch, DIFF_DELETE, DIFF_INSERT } from "diff-match-patch";
import { Dialog, Field, useAction } from "./primitives";
import { Notice, Spinner } from "./ui";

/** How one place of conflict will be settled: a fix, the merge the code found, the AI's merge, or the creator's own words. */
type Pick = { kind: "fix"; id: string } | { kind: "merged" } | { kind: "ai" } | { kind: "own" };
interface Settled {
  pick: Pick;
  own: string;
  ai?: { text: string; explanation: string; model: string };
}

const sameWords = (a: Pick, b: Pick) => a.kind === b.kind && (a.kind !== "fix" || a.id === (b as { id: string }).id);

/** The sentence or sentences the conflicting words sit in, so each result reads as a whole. */
function regionOf(text: string, c: Conflict) {
  const all = sentences(text);
  const first = all.find((s) => c.start >= s.start && c.start < s.end);
  const last = all.find((s) => c.end - 1 >= s.start && c.end - 1 < s.end);
  const start = Math.min(first?.start ?? c.start, c.start);
  const end = Math.max(last?.end ?? c.end, c.end);
  return end - start > 900 ? { start: c.start, end: c.end } : { start, end };
}

/** The words as they would stand after a choice, worked out by the same code that applies it (on this region alone). */
function resultOf(text: string, c: Conflict, region: { start: number; end: number }, fixes: Finding[], choice: ConflictChoice): string {
  const shift = region.start;
  const inputs = fixes
    .filter((f) => c.ids.includes(f.id) && f.fix)
    .map((f) => ({
      id: f.id,
      start: f.start - shift,
      end: f.end - shift,
      // The footnote goes at the foot of the text, outside any one sentence, so it is left out of this view.
      fix: { ...f.fix!, footnote: undefined, range: f.fix!.range ? { start: f.fix!.range.start - shift, end: f.fix!.range.end - shift } : undefined },
      editedText: f.status === "edited" ? f.resolution?.editedText : undefined,
      ruleId: f.ruleId,
      quote: f.quote,
      severity: f.severity,
      category: f.category,
      origin: f.origin,
    }));
  const plan: FixPlan = { conflicts: [{ ...c, start: c.start - shift, end: c.end - shift }], composed: [] };
  return applyFixPlan(text.slice(region.start, region.end), inputs, plan, { [c.id]: choice }).text;
}

/** A diff by whole words, so "our" becoming "Our" reads as one word changing, not as letters peeled off. */
function wordDiff(a: string, b: string): [number, string][] {
  const vocab: string[] = [];
  const seen = new Map<string, number>();
  const encode = (s: string) =>
    (s.match(/\s+|\S+/gu) ?? [])
      .map((token) => {
        let at = seen.get(token);
        if (at === undefined) {
          at = vocab.push(token) - 1;
          seen.set(token, at);
        }
        return String.fromCharCode(0x100 + at);
      })
      .join("");
  return new diff_match_patch().diff_main(encode(a), encode(b), false).map(([op, chars]) => [op, [...chars].map((c) => vocab[c.charCodeAt(0) - 0x100]).join("")]);
}

/** The result with what it adds marked, and what it removes listed under it: a before and after in one place. */
function Result({ id, before, after }: { id: string; before: string; after: string }) {
  const parts = wordDiff(before, after);
  const removed = parts.filter(([op]) => op === DIFF_DELETE).map(([, s]) => s.trim()).filter(Boolean);
  return (
    <>
      <p id={id} className="mt-2 text-[14.5px] leading-6">
        {parts
          .filter(([op]) => op !== DIFF_DELETE)
          .map(([op, s], i) =>
            op === DIFF_INSERT ? (
              <ins key={i} className="diff-ins">
                {s}
              </ins>
            ) : (
              <span key={i}>{s}</span>
            ),
          )}
        {!after.trim() && <span className="text-muted">(nothing is left)</span>}
      </p>
      {removed.length > 0 && (
        <p className="mt-1.5 text-[12.5px] leading-5 text-muted">
          Removes{" "}
          {removed.map((s, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <del className="diff-del">{s}</del>
            </span>
          ))}
        </p>
      )}
    </>
  );
}

/**
 * One way to settle a place: a radio (read as its heading, with the result as its description) inside a
 * card that selects when pressed anywhere. The card is not a <label>, so a field can sit inside it.
 */
function Choice({ id, name, checked, onSelect, head, describedBy, children }: { id: string; name: string; checked: boolean; onSelect: () => void; head: ReactNode; describedBy?: string; children?: ReactNode }) {
  return (
    <div
      onClick={onSelect}
      className="group relative flex cursor-pointer gap-3 rounded-[20px] bg-sheet p-4 transition-colors hover:bg-active has-[:checked]:bg-active has-[:checked]:ring-2 has-[:checked]:ring-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink"
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} aria-labelledby={`${id}-head`} aria-describedby={describedBy} className="peer sr-only" />
      <span aria-hidden="true" className="mt-[3px] grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-2 border-control transition-colors peer-checked:border-gold-mark">
        <span className="h-2 w-2 scale-95 rounded-full bg-gold-mark opacity-0 transition-[opacity,transform] duration-200 group-has-[:checked]:scale-100 group-has-[:checked]:opacity-100" />
      </span>
      <div className="min-w-0 flex-1">
        <p id={`${id}-head`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
          {head}
        </p>
        {children}
      </div>
    </div>
  );
}

function Place({
  n,
  of,
  c,
  text,
  fixes,
  submissionId,
  settled,
  onChange,
}: {
  n: number;
  of: number;
  c: Conflict;
  text: string;
  fixes: Finding[];
  submissionId: string;
  settled: Settled;
  onChange: (next: Settled) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const ai = useAiStatus();
  const region = regionOf(text, c);
  const sentence = text.slice(region.start, region.end);
  const at = c.start - region.start;
  const rest = fixes.filter((f) => c.ids.includes(f.id));
  const asking = useAction(async () => aiMergeFixes(submissionId, c.id), { toastError: false });
  const [problem, setProblem] = useState<string | null>(null);

  const ask = async () => {
    setProblem(null);
    const r = await asking.run();
    if (!r) return;
    if ("problem" in r) setProblem(r.problem);
    else onChange({ ...settled, ai: r, pick: { kind: "ai" } });
  };

  const pick = (next: Pick) => onChange({ ...settled, pick: next });
  const show = (choice: ConflictChoice) => resultOf(text, c, region, fixes, choice);
  const head = (label: ReactNode) => <span className="font-medium">{label}</span>;

  return (
    <fieldset className="rounded-[24px] bg-raised p-0">
      <legend className="sr-only">
        Conflict {n} of {of}: {c.before.trim() || "these words"}
      </legend>
      <div className="mb-3 px-1">
        <p className="text-[13px] font-medium text-muted">
          {of > 1 ? `Place ${n} of ${of} · ` : ""}
          {c.ids.length} fixes want the same words
        </p>
        <p className="mt-1 text-[14.5px] leading-6">
          {sentence.slice(0, at)}
          <span className="rounded-[4px] bg-warn-bg px-0.5 text-warn-ink">{sentence.slice(at, at + (c.end - c.start))}</span>
          {sentence.slice(at + (c.end - c.start))}
        </p>
      </div>

      <div className={`grid gap-3 ${rest.length > 2 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
        {c.options.map((o) => {
          const f = rest.find((x) => x.id === o.id);
          const picked = settled.pick.kind === "fix" && settled.pick.id === o.id;
          const result = show({ kind: "fix", id: o.id });
          return (
            <Choice
              key={o.id}
              id={`${uid}-${o.id}`}
              name={`${uid}-pick`}
              describedBy={`${uid}-${o.id}-result`}
              checked={picked}
              onSelect={() => pick({ kind: "fix", id: o.id })}
              head={
                <>
                  <span className="slip-tag">{o.ruleId}</span>
                  {head(f?.title ?? o.ruleId)}
                  {o.id === c.defaultId && <span className="pill bg-neutral-bg text-neutral-ink">More serious rule</span>}
                </>
              }
            >
              <Result id={`${uid}-${o.id}-result`} before={sentence} after={result} />
              {f?.fix?.label && <p className="mt-1.5 text-[12.5px] text-muted">{f.fix.label}</p>}
            </Choice>
          );
        })}
      </div>

      <div className="mt-3 space-y-3">
        {c.merged !== undefined && (
          <Choice
            id={`${uid}-merged`}
            name={`${uid}-pick`}
            describedBy={`${uid}-merged-result`}
            checked={sameWords(settled.pick, { kind: "merged" })}
            onSelect={() => pick({ kind: "merged" })}
            head={
              <>
                {head("Both fixes together")}
                <span className="text-muted">Checked: it adds no new problem and keeps approved wording.</span>
              </>
            }
          >
            <Result id={`${uid}-merged-result`} before={sentence} after={show({ kind: "text", text: c.merged })} />
          </Choice>
        )}

        {settled.ai && (
          <Choice
            id={`${uid}-ai`}
            name={`${uid}-pick`}
            describedBy={`${uid}-ai-result`}
            checked={sameWords(settled.pick, { kind: "ai" })}
            onSelect={() => pick({ kind: "ai" })}
            head={
              <>
                {head("The AI's merge")}
                <span className="text-muted">{settled.ai.model} · passed the same checks</span>
              </>
            }
          >
            <Result id={`${uid}-ai-result`} before={sentence} after={show({ kind: "text", text: settled.ai.text })} />
            {settled.ai.explanation && <p className="mt-1.5 text-[12.5px] leading-5 text-muted">{settled.ai.explanation}</p>}
          </Choice>
        )}

        <Choice
          id={`${uid}-own`}
          name={`${uid}-pick`}
          checked={sameWords(settled.pick, { kind: "own" })}
          onSelect={() => pick({ kind: "own" })}
          head={head("Write my own")}
        >
          {settled.pick.kind === "own" ? (
            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
              <Field
                multiline
                rows={2}
                label="Words to put where both fixes were looking"
                hint={
                  <>
                    These replace <span className="whitespace-pre-wrap">“{c.before}”</span>. The result is checked again when the draft is re-checked.
                  </>
                }
                value={settled.own}
                onChange={(e) => onChange({ ...settled, own: e.target.value })}
                autoFocus
              />
              {settled.own.trim() && <Result id={`${uid}-own-result`} before={sentence} after={show({ kind: "text", text: settled.own })} />}
            </div>
          ) : (
            <p className="mt-1 text-[13px] text-muted">Type the words that should stand there instead.</p>
          )}
        </Choice>

        <div className="flex flex-wrap items-center gap-3 px-1">
          <button type="button" className="btn btn-secondary btn-sm" disabled={asking.busy || ai === null || (!!ai && !ai.aiConfigured)} onClick={ask}>
            <Sparkles size={14} aria-hidden="true" /> Ask the AI to merge
          </button>
          {asking.busy && <Spinner label="Asking for a merge…" />}
          {!asking.busy && ai !== undefined && (ai === null || !ai.aiConfigured) && <span className="text-[13px] text-muted">The AI isn&apos;t switched on here, so the choices above are the ones to pick from.</span>}
        </div>
        {problem && (
          <div role="alert">
            <Notice tone="warn">{problem}</Notice>
          </div>
        )}
      </div>
    </fieldset>
  );
}

/**
 * The resolver. Open while `plan` is set. `findings` are the staged ones (accepted or edited), `text` is the
 * version they were made on. `onApply` gets one choice per place of conflict and does the applying.
 */
export function FixConflict({
  plan,
  findings,
  text,
  submissionId,
  onClose,
  onApply,
}: {
  plan: FixPlan | null;
  findings: Finding[];
  text: string;
  submissionId: string;
  onClose: () => void;
  onApply: (choices: Record<string, ConflictChoice>) => Promise<unknown>;
}) {
  const [settled, setSettled] = useState<Record<string, Settled>>({});
  // The error stays in this dialog, beside the choices, so the creator can pick again without losing them.
  const applying = useAction(
    async (choices: Record<string, ConflictChoice>) => {
      await onApply(choices);
      return true as const;
    },
    { toastError: false },
  );
  const conflicts = plan?.conflicts ?? [];

  // Untouched places stand on the more serious rule's fix.
  const stateOf = (c: Conflict): Settled => settled[c.id] ?? { pick: { kind: "fix", id: c.defaultId }, own: "" };
  const choiceOf = (c: Conflict): ConflictChoice | null => {
    const s = stateOf(c);
    if (s.pick.kind === "fix") return { kind: "fix", id: s.pick.id };
    if (s.pick.kind === "merged") return c.merged === undefined ? null : { kind: "text", text: c.merged };
    if (s.pick.kind === "ai") return s.ai ? { kind: "text", text: s.ai.text } : null;
    return s.own.trim() ? { kind: "text", text: s.own } : null;
  };
  const ready = conflicts.length > 0 && conflicts.every((c) => choiceOf(c) !== null);
  const composed = plan?.composed ?? [];

  const close = () => {
    if (applying.busy) return;
    setSettled({});
    onClose();
  };

  return (
    <Dialog
      size="lg"
      open={!!plan && conflicts.length > 0}
      onClose={close}
      title={conflicts.length === 1 ? "Two accepted fixes want the same words" : "Some accepted fixes want the same words"}
      actions={
        <>
          <button type="button" className="btn btn-ghost btn-lg" onClick={close} disabled={applying.busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-inverse btn-lg"
            disabled={!ready || applying.busy}
            onClick={async () => {
              const choices = Object.fromEntries(conflicts.flatMap((c) => [[c.id, choiceOf(c)!] as const]));
              if (await applying.run(choices)) {
                setSettled({});
                onClose();
              }
            }}
          >
            {applying.busy ? "Applying…" : "Apply with these choices"}
          </button>
        </>
      }
    >
      <p className="text-muted">
        Only one change can stand where two fixes overlap. The fix from the more serious rule is chosen for you. Pick another, use a merge, or write the words yourself; everything else you accepted applies as it is.
      </p>
      {composed.length > 0 && (
        <p className="mt-2 text-[13.5px] text-muted">
          {composed.length === 1 ? "Another sentence has" : `${composed.length} other sentences have`} several fixes that do not overlap. They are applied together and read together as one result.
        </p>
      )}
      <div className="mt-5 space-y-5">
        {conflicts.map((c, i) => (
          <Place key={c.id} n={i + 1} of={conflicts.length} c={c} text={text} fixes={findings} submissionId={submissionId} settled={stateOf(c)} onChange={(next) => setSettled((all) => ({ ...all, [c.id]: next }))} />
        ))}
      </div>
      {applying.error && (
        <div className="mt-4" role="alert">
          <Notice tone="error">{applying.error}</Notice>
        </div>
      )}
    </Dialog>
  );
}
