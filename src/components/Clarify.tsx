"use client";

// One rule that people push back on, and the one-click way to reword it: what they pushed back on, a
// draft of the clarification (by the AI when a key is set, or from the template), then exactly what
// publishing does, in place, before the button. Mount it with `key={rule.id}` so a draft can never
// carry over onto another rule.
import { useEffect, useState } from "react";
import { aiTask } from "@/lib/ai-client";
import type { Rule } from "@/lib/types";
import type { FixAcceptance, RuleHealth } from "@/engine/health";
import { clarificationPreview, publishClarification, type ClarificationDraft } from "@/store/actions";
import { CHANNELS } from "@/seed/velvra";
import { useAction, Field } from "./primitives";
import { AcceptanceNote, Touchstone } from "./RuleSignals";
import { Code, Notice, Spinner } from "./ui";

const channelName = (c: string) => CHANNELS.find((x) => x.id === c)?.label ?? c;

type Preview = Awaited<ReturnType<typeof clarificationPreview>>;

interface Draft {
  text: string;
  dos: string[];
  donts: string[];
  rationale: string;
  source: { kind: "ai"; model: string; original: string } | { kind: "template" };
}

const draftedBy = (d: Draft) =>
  d.source.kind === "ai" ? (d.text === d.source.original ? `AI (${d.source.model})` : `AI (${d.source.model}), then edited`) : "Template, then edited";

const asDraft = (d: Draft): ClarificationDraft => ({ text: d.text.trim(), dos: d.dos, donts: d.donts, rationale: d.rationale, draftedBy: draftedBy(d) });

export interface AiAvailability {
  /** True once a key is set and the kit is not confidential. */
  on: boolean;
  /** Why drafting is off, in a sentence. */
  why?: string;
}

export function Clarify({
  h,
  canPublish,
  ai,
  acceptance,
  latestVersion,
  revision,
}: {
  h: RuleHealth;
  canPublish: boolean;
  ai: AiAvailability;
  acceptance?: FixAcceptance;
  latestVersion: string;
  /** Changes whenever a rulebook version is published, so the preview reads the new latest. */
  revision: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const ruleId = h.rule.id;
  const dosKey = draft?.dos.join("\n");
  const dontsKey = draft?.donts.join("\n");
  useEffect(() => {
    if (!draft) return;
    let live = true;
    clarificationPreview(ruleId, asDraft(draft))
      .then((p) => live && setPreview(p))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
    // The preview follows what is typed, not the draft object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleId, draft?.text, dosKey, dontsKey, draft?.rationale, draft ? draftedBy(draft) : "", revision]);

  const publish = useAction(
    async () => {
      if (!draft) throw new Error("There is no draft to publish.");
      const v = await publishClarification(ruleId, asDraft(draft));
      setDraft(null);
      setPreview(null);
      return v;
    },
    { errorPrefix: "Could not publish", success: (v) => `Published v${v}: ${ruleId} is reworded. Undo is on its row.` },
  );

  const askAi = async () => {
    setAsking(true);
    setProblem(null);
    const r = await aiTask("clarifyRule", {
      rule: { id: ruleId, title: h.rule.title, text: h.rule.text, dos: h.rule.dos.slice(0, 6), donts: h.rule.donts.slice(0, 6) },
      examples: h.examples.map((e) => ({ quote: e.quote.slice(0, 400), reason: e.reason?.slice(0, 300), status: e.status, audience: e.audience, channel: e.channel })),
    });
    setAsking(false);
    if (r.ok) setDraft({ text: r.data.text, dos: r.data.dos, donts: r.data.donts, rationale: r.data.rationale, source: { kind: "ai", model: r.model, original: r.data.text } });
    else setProblem("The AI could not draft a clarification right now. The template suggestion above still works.");
  };

  const changed = !!preview && JSON.stringify([preview.before.text, preview.before.dos, preview.before.donts]) !== JSON.stringify([preview.after.text, preview.after.dos, preview.after.donts]);
  const pinned = preview?.pinned ?? [];

  return (
    <div className="mt-5 rounded-[20px] bg-raised p-4 md:p-5" data-clarify={ruleId}>
      <h3 className="text-[15px] font-semibold">
        <Code>{ruleId}</Code> {h.rule.title}: what people pushed back on
      </h3>
      <p className="mt-1 text-[13.5px] leading-[21px] text-muted">Wording now: “{h.rule.text}”</p>

      <div className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
        <div>
          <p className="text-[13px] text-muted">
            Unclear score <span className="num text-ink">{h.score}</span> of 100
          </p>
          <Touchstone score={h.score} className="mt-1.5" />
        </div>
        <AcceptanceNote ruleId={ruleId} a={acceptance} />
      </div>

      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {h.examples.length === 0 && <li className="text-[13px] text-muted">No dismissed or contested findings for this rule.</li>}
        {h.examples.map((e, i) => (
          <li key={i} className="rounded-[14px] bg-sheet px-3.5 py-2.5 text-[13px] leading-5">
            <p>“{e.quote}”</p>
            <p className="text-muted">
              {e.status === "contested" ? "Contested" : "Dismissed"}
              {e.reason ? `: ${e.reason}` : ""} · {channelName(e.channel)} · {e.audience}
              {e.seeded ? " · seeded" : ""}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-5">
        <p className="text-[13px] font-medium">Suggested clarification (template)</p>
        <p className="mt-1 text-[14px] leading-[22px]">{h.suggestion}</p>
      </div>

      {!draft && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn btn-secondary btn-sm" disabled={!ai.on || asking} aria-describedby={ai.on ? undefined : `ai-why-${ruleId}`} onClick={askAi}>
            {asking ? "Drafting…" : "Draft a clarification with AI"}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setDraft({ text: h.rule.text, dos: [], donts: [], rationale: `Reworded from the pushback on ${ruleId}.`, source: { kind: "template" } })}
          >
            Use the template as a draft
          </button>
          {asking && <Spinner label="Asking the AI…" />}
        </div>
      )}
      {!ai.on && (
        <p id={`ai-why-${ruleId}`} className="mt-2 text-[13px] leading-5 text-muted">
          {ai.why} The template suggestion still works: start from it and write the new wording yourself.
        </p>
      )}
      {problem && (
        <div className="mt-3">
          <Notice tone="error">{problem}</Notice>
        </div>
      )}

      {draft && (
        <section aria-label={`Clarification for ${ruleId}`} className="mt-5 space-y-4 border-t border-line pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-[15px] font-semibold">Your draft</h4>
            <p className="text-[13px] text-muted">Drafted by {draftedBy(draft)}</p>
          </div>
          <Field
            label="Clarified rule text"
            multiline
            rows={4}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            hint={draft.source.kind === "template" ? "The template starts from the current wording. Write what passes and what does not." : "Edit it if the AI got something wrong."}
          />
          <p className="text-[13.5px] leading-[21px] text-muted">
            <span className="text-ink">Why:</span> {draft.rationale}
          </p>

          {preview ? (
            <div className="space-y-4">
              <p className="text-[14px] leading-[22px]">
                Publishing makes a new rulebook version, <strong className="num font-semibold">v{preview.version}</strong>, that differs from v{latestVersion} by this one rule.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <RuleSide heading={`Now, in v${latestVersion}`} rule={preview.before} />
                <RuleSide heading={`After, in v${preview.version}`} rule={preview.after} base={preview.before} />
              </div>

              <div className="rounded-[16px] bg-sheet px-4 py-3.5">
                <p className="text-[13px] font-medium">Drafts already in progress</p>
                {pinned.length === 0 ? (
                  <p className="mt-1 text-[13.5px] leading-5 text-muted">No draft is in progress in this browser, so none stays on an old version. Approved drafts keep the version in their Hallmark.</p>
                ) : (
                  <>
                    <p className="mt-1 text-[13.5px] leading-5 text-muted">
                      These keep the rulebook they started on. New drafts use v{preview.version}; approved drafts keep the version in their Hallmark.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {pinned.map((p) => (
                        <li key={p.id} className="flex items-baseline justify-between gap-3 text-[13.5px]">
                          <span className="min-w-0 truncate">{p.title}</span>
                          <span className="num flex-none text-muted">stays on v{p.rulebookVersion}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {preview.codeUnchanged && (
                <Notice tone="info">
                  This rule&apos;s code patterns won&apos;t change, so its word-matching findings keep firing.
                  {preview.before.patterns.length > 0 && (
                    <>
                      {" "}
                      Code still looks for: {preview.before.patterns.slice(0, 6).map((p, i) => (
                        <span key={p}>
                          {i > 0 ? ", " : ""}“{p}”
                        </span>
                      ))}
                      {preview.before.patterns.length > 6 ? ` and ${preview.before.patterns.length - 6} more` : ""}.
                    </>
                  )}{" "}
                  Rewording changes what reviewers and the AI read. To change what code matches, edit the phrases in the Brand Kit.
                </Notice>
              )}
            </div>
          ) : (
            <Spinner label="Working out what this changes…" />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn btn-inverse btn-lg"
              disabled={!canPublish || !preview || !changed || publish.busy}
              aria-describedby={`publish-why-${ruleId}`}
              onClick={() => publish.run()}
            >
              {publish.busy ? "Publishing…" : `Publish as v${preview?.version ?? "…"}`}
            </button>
            <button className="btn btn-ghost btn-lg" disabled={publish.busy} onClick={() => (setDraft(null), setPreview(null))}>
              Discard draft
            </button>
          </div>
          <p id={`publish-why-${ruleId}`} className="text-[13px] leading-5 text-muted">
            {!canPublish
              ? "Only a Brand Admin can publish. Switch to Brand Admin in the top bar to publish this."
              : preview && !changed
                ? "Nothing would change yet: edit the wording above first."
                : "One click publishes it. You can undo it from this rule's row."}
          </p>
        </section>
      )}
    </div>
  );
}

function RuleSide({ heading, rule, base }: { heading: string; rule: Rule; base?: Rule }) {
  const fresh = (list: string[], was: string[]) => (base ? list.filter((x) => !was.includes(x)) : []);
  const newDos = fresh(rule.dos, base?.dos ?? []);
  const newDonts = fresh(rule.donts, base?.donts ?? []);
  return (
    <div className="rounded-[16px] bg-sheet px-4 py-3.5">
      <p className="text-[12px] text-muted">{heading}</p>
      <p className="mt-1 text-[14px] leading-[22px]">{rule.text}</p>
      <Examples label="Do" items={rule.dos} fresh={newDos} />
      <Examples label="Don't" items={rule.donts} fresh={newDonts} />
    </div>
  );
}

function Examples({ label, items, fresh }: { label: string; items: string[]; fresh: string[] }) {
  return (
    <div className="mt-2.5">
      <p className="text-[12px] text-muted">{label}</p>
      {items.length === 0 ? (
        <p className="text-[13px] text-faint">No examples yet.</p>
      ) : (
        <ul className="mt-0.5 space-y-0.5 text-[13.5px] leading-5">
          {items.map((x) => (
            <li key={x}>
              {x}
              {fresh.includes(x) && <span className="pill ml-2 h-[18px] bg-gold-soft px-2 text-[11px] text-gold-ink">new</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
