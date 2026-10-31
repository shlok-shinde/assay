"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import type { BrandKit, Category, Channel, Rule, RuleMode, RulebookVersion, Severity } from "@/lib/types";
import { db } from "@/store/db";
import { deleteRule, importBrandBook, publishRulebook, rollbackRulebook, unpublishedChanges, updateKit, upsertRule, type BookImportResult } from "@/store/actions";
import { useKit, useRole } from "@/store/hooks";
import { CHANNELS } from "@/seed/velvra";
import { fetchAsFile } from "@/lib/parse";
import { TitleRow } from "./AppShell";
import { CATEGORY_LABEL, Code, Empty, fmtTime, Notice, PageLoading, SeverityPill, Spinner, TabPanel, Tabs, useTabParam } from "./ui";
import { FactsTab, PaletteSection, TermsTab } from "./KitEditors";
import { nextRuleId } from "./kit-helpers";
import { useBrand } from "./BrandSwitcher";
import { Field, Select, Table, Term, useAction, useConfirm } from "./primitives";
import { DiffView } from "./DiffView";
import { AcceptanceNote, useAcceptance } from "./RuleSignals";
import { CitationButton, ruleTarget } from "./Citation";

type Tab = "rules" | "facts" | "terms" | "assets" | "import" | "versions";
const TABS: readonly Tab[] = ["rules", "facts", "terms", "assets", "import", "versions"];
const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function KitView() {
  const role = useRole();
  const kit = useKit();
  const [tab, setTab] = useTabParam<Tab>(TABS, "rules");
  const latest = useLiveQuery(() => db.rulebooks.orderBy("publishedAt").last(), []);
  const dirty = useLiveQuery(() => unpublishedChanges(), [kit?.updatedAt, latest?.id]);
  const [notes, setNotes] = useState("");
  const [published, setPublished] = useState<string | null>(null);
  const admin = role === "admin";
  // The store's own sentence ("Nothing has changed since version 3.2.") shows beside the button, not only in a toast.
  const publish = useAction(
    async () => {
      const v = await publishRulebook(notes.trim() || "Updated rules");
      setPublished(v);
      setNotes("");
    },
    { toastError: false },
  );
  if (!kit || !latest) return <PageLoading label="Opening the Brand Kit…" />;
  const pending = kit.rules.filter((r) => r.pending);
  const next = (() => {
    const [a, b] = latest.version.split(".").map(Number);
    return `${a}.${b + 1}`;
  })();

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        title="Brand Kit"
        sub={
          <>
            {kit.brandBook}. Checks use the published rulebook v{latest.version}; edits here stay in a draft until you publish. Facts here form the <Term id="claim-ledger">Claim Ledger</Term>.
            {dirty ? <span className="text-ink"> The draft has unpublished changes.</span> : " The draft matches the published rulebook."}
          </>
        }
        actions={
          admin ? (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="pub-notes" className="sr-only">
                What changed
              </label>
              <input id="pub-notes" className="field !h-[34px] w-56" placeholder="What changed in this version" value={notes} onChange={(e) => (setNotes(e.target.value), publish.clearError())} />
              <button
                className="btn btn-inverse"
                disabled={publish.busy || pending.length > 0}
                title={pending.length ? "Approve or reject imported rules first" : undefined}
                onClick={() => {
                  setPublished(null);
                  void publish.run();
                }}
              >
                Publish v{next}
              </button>
            </div>
          ) : undefined
        }
      />
      {!admin && <p className="mt-3 text-[13px] text-muted">Read-only. Switch to Brand Admin in the top bar to edit rules, facts and assets.</p>}
      {publish.error && (
        <div className="mt-3 max-w-[760px]">
          <Notice tone="error" role="alert">
            {publish.error}
          </Notice>
        </div>
      )}
      {published && (
        <div className="mt-3">
          <Notice tone="info">
            Published rulebook v{published}. New drafts are checked against it; existing drafts and their Hallmarks keep the version they were checked against.
          </Notice>
        </div>
      )}
      <div className="mt-5">
        <Tabs
          idBase="kit"
          label="Brand Kit sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "rules", label: `Rules ${kit.rules.filter((r) => !r.pending).length}` },
            { id: "facts", label: `Claim Ledger ${kit.facts.length}` },
            { id: "terms", label: `Terms ${kit.terms.length}` },
            { id: "assets", label: "Palette and limits" },
            { id: "import", label: pending.length ? `Import · ${pending.length} to review` : "Import" },
            { id: "versions", label: "Versions" },
          ]}
        />
      </div>
      <TabPanel idBase="kit" id={tab} className="mt-5">
        {tab === "rules" && <RulesTab kit={kit} admin={admin} />}
        {tab === "facts" && <FactsTab kit={kit} admin={admin} />}
        {tab === "terms" && <TermsTab kit={kit} admin={admin} />}
        {tab === "assets" && <AssetsTab kit={kit} admin={admin} />}
        {tab === "import" && <ImportTab kit={kit} admin={admin} />}
        {tab === "versions" && <VersionsTab admin={admin} />}
      </TabPanel>
    </div>
  );
}

function RulesTab({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  const rules = kit.rules.filter((r) => !r.pending);
  const [sel, setSel] = useState<string | null>(rules[0]?.id ?? null);
  const rule = kit.rules.find((r) => r.id === sel);
  const add = useAction(
    async () => {
      const id = nextRuleId(kit.rules, "CUSTOM");
      await upsertRule({
        id,
        title: "New rule",
        text: "Describe what is allowed and what is not.",
        category: "tone",
        severity: "low",
        modes: ["judgment"],
        channels: [],
        dos: [],
        donts: [],
        patterns: [],
        replacements: {},
        source: { doc: kit.brandBook, page: 1, section: "added in Assay" },
        active: true,
      });
      setSel(id);
    },
    { errorPrefix: "Could not add the rule" },
  );
  const live = rules.filter((r) => r.active).length;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="min-w-0">
        <p className="mb-3 text-[14px] leading-[22px] text-muted">
          <span className="num text-ink">{rules.length}</span> rules, <span className="num text-ink">{live}</span> active. Choose one to read how it is checked and to edit it.
        </p>
        <div className="card p-3">
          <Table label="Brand rules" minWidth={560} className="tbl-pick">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Checked by</th>
                <th className="num">Source</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} data-selected={sel === r.id ? "" : undefined} onClick={() => setSel(r.id)} className={`align-middle ${r.active ? "" : "text-muted"}`}>
                  <td className="pr-2">
                    <button className="text-left" aria-current={sel === r.id ? "true" : undefined} onClick={(e) => (e.stopPropagation(), setSel(r.id))}>
                      <Code>{r.id}</Code> {r.title}
                      {!r.active && <span className="pill ml-2 bg-neutral-bg text-neutral-ink">Off</span>}
                    </button>
                  </td>
                  <td className="pr-2">{CATEGORY_LABEL[r.category]}</td>
                  <td className="pr-2">
                    <SeverityPill severity={r.severity} />
                  </td>
                  <td className="pr-2 text-[13px] text-muted">{r.modes.map((m) => (m === "judgment" ? "AI judgment" : m === "manual" ? "manual" : "code")).filter((v, i, a) => a.indexOf(v) === i).join(" + ")}</td>
                  <td className="num whitespace-nowrap text-[13px] text-muted">
                    p.{r.source.page} {r.source.section}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        {admin && (
          <button className="btn btn-secondary btn-sm mt-3" disabled={add.busy} onClick={() => add.run()}>
            <Plus size={14} /> Add rule
          </button>
        )}
      </div>
      {rule && <RuleEditor key={`${rule.id}-${kit.updatedAt}`} rule={rule} admin={admin} />}
    </div>
  );
}

const MODE_TEXT: Record<RuleMode, string> = {
  judgment: "AI judgment",
  lexical: "phrases checked in code",
  structural: "structure checked in code",
  claim: "claims compared with the Claim Ledger",
  visual: "the creative checked in code",
  manual: "reviewers apply it by eye",
};

function RuleEditor({ rule, admin }: { rule: Rule; admin: boolean }) {
  const confirm = useConfirm();
  const acceptance = useAcceptance();
  const [r, setR] = useState(rule);
  const [patterns, setPatterns] = useState(rule.patterns.join("\n"));
  const [error, setError] = useState<string | undefined>();
  const set = (patch: Partial<Rule>) => setR((x) => ({ ...x, ...patch }));
  const lexical = r.modes.includes("lexical");
  // Only these two are switched here; any other way the rule is checked is kept as it is.
  const other = r.modes.filter((m) => m !== "lexical" && m !== "judgment");
  const toggle = (mode: "lexical" | "judgment", on: boolean) => {
    const rest = r.modes.filter((m) => m !== mode);
    const modes: RuleMode[] = on ? [...rest, mode] : rest;
    set({ modes: modes.length ? modes : ["manual"] });
    setError(undefined);
  };
  const save = useAction(
    async () => {
      const list = [...new Set(patterns.split("\n").map((x) => x.trim()).filter(Boolean))];
      if (lexical && !list.length) {
        setError("Add at least one phrase, or untick “Phrases checked in code”.");
        return false;
      }
      setError(undefined);
      const keep = list.map((p) => p.toLowerCase());
      const replacements = Object.fromEntries(Object.entries(r.replacements).filter(([k]) => keep.includes(k.toLowerCase())));
      await upsertRule({ ...r, patterns: lexical ? list : [], replacements: lexical ? replacements : {}, fixTemplate: r.fixTemplate?.trim() || undefined });
      return true;
    },
    { errorPrefix: "Could not save the rule", success: (ok) => (ok ? `Saved ${r.id} to the draft.` : undefined) },
  );
  const remove = useAction(
    async () => {
      if (!(await confirm({ title: `Delete ${r.id}?`, body: "It is removed from the draft rulebook. Published versions keep it.", confirmLabel: "Delete rule", danger: true }))) return false;
      await deleteRule(r.id);
      return true;
    },
    { errorPrefix: "Could not delete the rule", success: (done) => (done ? `Deleted ${r.id} from the draft.` : undefined) },
  );
  const dis = !admin;
  return (
    <form
      aria-label={`Rule ${r.id}`}
      noValidate
      className="min-w-0 space-y-4 rounded-[28px] bg-raised p-5 md:p-6 xl:sticky xl:top-3 xl:self-start"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <div>
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <Code>{rule.id}</Code>
          <SeverityPill severity={rule.severity} />
          <span>{CATEGORY_LABEL[rule.category]}</span>
        </p>
        <h2 className="mt-2 font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">{rule.title}</h2>
        <p className="mt-2 text-[14.5px] leading-6">{rule.text}</p>
        <p className="mt-3 text-[13px] leading-5 text-muted">
          Checked by {rule.modes.map((m) => MODE_TEXT[m]).join("; ")}.
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 pt-2">
        <h3 className="text-[15px] font-semibold">{admin ? "Edit rule" : "Rule settings"}</h3>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="h-4 w-4 accent-[#f4efe4]" checked={r.active} disabled={dis} onChange={(e) => set({ active: e.target.checked })} /> Active
        </label>
      </div>
      <AcceptanceNote ruleId={r.id} a={acceptance?.get(r.id)} className="rounded-[20px] bg-field px-4 py-3.5" />
      <Field id="r-title" label="Title" value={r.title} disabled={dis} onChange={(e) => set({ title: e.target.value })} />
      <Field id="r-text" label="Rule text" multiline rows={3} value={r.text} disabled={dis} onChange={(e) => set({ text: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <Select id="r-cat" label="Category" value={r.category} disabled={dis} onChange={(e) => set({ category: e.target.value as Category })}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select id="r-sev" label="Severity" value={r.severity} disabled={dis} onChange={(e) => set({ severity: e.target.value as Severity })}>
          {(["high", "medium", "low"] as const).map((sv) => (
            <option key={sv} value={sv}>
              {sv[0].toUpperCase() + sv.slice(1)}
            </option>
          ))}
        </Select>
      </div>
      <fieldset>
        <legend className="text-[14px] font-medium">Channels (none ticked means every channel)</legend>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {CHANNELS.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#f4efe4]"
                disabled={dis}
                checked={r.channels.includes(c.id)}
                onChange={(e) => set({ channels: e.target.checked ? [...r.channels, c.id] : r.channels.filter((x: Channel) => x !== c.id) })}
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-[14px] font-medium">How it is checked</legend>
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" className="h-4 w-4 accent-[#f4efe4]" disabled={dis} checked={r.modes.includes("judgment")} onChange={(e) => toggle("judgment", e.target.checked)} /> AI judgment
          </label>
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" className="h-4 w-4 accent-[#f4efe4]" disabled={dis} checked={lexical} onChange={(e) => toggle("lexical", e.target.checked)} /> Phrases checked in code
          </label>
        </div>
        {other.length > 0 && <p className="mt-2 text-[12.5px] text-muted">Also: {other.map((m) => MODE_TEXT[m]).join("; ")}.</p>}
        {r.modes.length === 1 && r.modes[0] === "manual" && <p className="mt-2 text-[12.5px] text-muted">Nothing checks this rule by itself: {MODE_TEXT.manual}.</p>}
      </fieldset>
      {lexical && (
        <>
          <Field
            id="r-pat"
            label="Phrases checked in code (one per line)"
            multiline
            rows={4}
            value={patterns}
            disabled={dis}
            onChange={(e) => (setPatterns(e.target.value), setError(undefined))}
            error={error}
            hint="A finding fires when a draft contains one of these as whole words, in any capitals, on the channels ticked above."
          />
          <Field id="r-fix" label="What to suggest instead (optional)" value={r.fixTemplate ?? ""} disabled={dis} onChange={(e) => set({ fixTemplate: e.target.value })} hint="Shown with each finding as a rewrite for the writer to make by hand." />
        </>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field id="r-dos" label="Do examples" multiline rows={3} value={r.dos.join("\n")} disabled={dis} onChange={(e) => set({ dos: lines(e.target.value) })} />
        <Field id="r-donts" label="Don't examples" multiline rows={3} value={r.donts.join("\n")} disabled={dis} onChange={(e) => set({ donts: lines(e.target.value) })} />
      </div>
      <p className="text-[12px] text-muted">
        Source: {r.source.doc}, page {r.source.page}, {r.source.section}
      </p>
      {r.source.bookId && r.source.page > 0 && (
        <p className="text-[13px]">
          <CitationButton target={ruleTarget(r)}>Open page {r.source.page} of {r.source.doc}</CitationButton>
        </p>
      )}
      {admin && (
        <div className="flex items-center gap-2">
          <button className="btn btn-inverse btn-sm" type="submit" disabled={save.busy}>
            Save to draft
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-neg-ink"
            disabled={remove.busy}
            onClick={() => remove.run()}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </form>
  );
}

function AssetsTab({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  // A number saved on leaving its box; a failure says so instead of vanishing.
  const save = useAction((patch: Partial<BrandKit>, what: string) => updateKit(patch, what), { errorPrefix: "Could not save the change" });
  return (
    <div className="space-y-8">
      <PaletteSection kit={kit} admin={admin} />
      <section className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div>
          <h2 className="text-[16px] font-semibold">Logo</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">Checked against the logo box a creator marks on a creative (VIS-03). Assay does not find logos by itself yet.</p>
        </div>
        <div className="max-w-[320px]">
          <label htmlFor="logo-min" className="text-[13px] font-medium">
            Minimum width (px)
          </label>
          <input
            id="logo-min"
            type="number"
            className="field mt-1.5"
            defaultValue={kit.logo.minWidthPx}
            disabled={!admin}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v > 0 && v !== kit.logo.minWidthPx) void save.run({ logo: { ...kit.logo, minWidthPx: v } }, "logo minimum width");
            }}
          />
        </div>
      </section>
      <section className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div>
          <h2 className="text-[16px] font-semibold">Channel limits</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">
            Used by VOICE-02 (exclamation marks), A11Y-05 (emoji and capitals) and A11Y-03 (readability, scored as <Term id="flesch">Flesch reading ease</Term>).
          </p>
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[520px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="pb-2 font-normal">Channel</th>
                <th className="pb-2 text-right font-normal">Emoji</th>
                <th className="pb-2 text-right font-normal">Exclamation marks</th>
                <th className="pb-2 text-right font-normal">ALL-CAPS words</th>
                <th className="pb-2 text-right font-normal">Min. reading ease</th>
              </tr>
            </thead>
            <tbody>
              {CHANNELS.map((c) => {
                const l = kit.channelLimits[c.id];
                return (
                  <tr key={c.id} className="border-t border-rule">
                    <td className="py-2">{c.label}</td>
                    {(["maxEmoji", "maxExclamation", "maxCapsWords", "readabilityMin"] as const).map((k) => (
                      <td key={k} className="py-1.5 text-right">
                        <label className="sr-only" htmlFor={`${c.id}-${k}`}>
                          {c.label} {k}
                        </label>
                        <input
                          id={`${c.id}-${k}`}
                          type="number"
                          className="field num !h-8 !w-20 text-right"
                          defaultValue={l[k]}
                          disabled={!admin}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v !== l[k]) void save.run({ channelLimits: { ...kit.channelLimits, [c.id]: { ...l, [k]: v } } }, `${c.label} ${k}`);
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <ConfidentialRow kit={kit} admin={admin} />
    </div>
  );
}

export function ConfidentialRow({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div>
        <h2 className="text-[16px] font-semibold">Confidential mode</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted">When on, nothing from this Brand Kit&apos;s drafts is sent to any AI service. Checks run as rule checks only.</p>
      </div>
      <label className="flex max-w-[560px] items-center justify-between gap-4 rounded-[22px] bg-field p-5 text-[14px]">
        <span>
          <span className="font-medium">Send nothing to AI services</span>
          <span className="block text-[13px] text-muted">{kit.confidential ? "On: rule checks only." : "Off: redacted paragraphs may go to Gemini for tone and messaging judgment."}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="h-5 w-9 accent-[#17140f]"
          checked={kit.confidential}
          disabled={!admin}
          onChange={(e) => updateKit({ confidential: e.target.checked }, `Confidential mode ${e.target.checked ? "on" : "off"}`)}
        />
      </label>
    </section>
  );
}

/** What an import did, said plainly: what was found, who read which pages, what was thrown away, and what is still the admin's to enter. */
function importSummary(r: BookImportResult, file: string): string[] {
  const pages = `${r.pagesTotal} page${r.pagesTotal === 1 ? "" : "s"}`;
  const heuristic = "the must, never, always, avoid and don't heuristic";
  const lines = [`${r.rules} candidate rule${r.rules === 1 ? "" : "s"} from ${pages} of ${file}. None is active until you approve it.`];
  if (r.pagesByAi === 0) lines.push(`The AI read none of the pages, so all ${pages} went through ${heuristic}.`);
  else if (r.pagesByAi < r.pagesTotal) lines.push(`The AI (${r.model}) read ${r.pagesByAi} of ${pages}. The other ${r.pagesTotal - r.pagesByAi} went through ${heuristic}.`);
  else lines.push(`The AI (${r.model}) read all ${pages}.`);
  if (r.rejected > 0) lines.push(`${r.rejected} AI candidate${r.rejected === 1 ? " was" : "s were"} dropped because ${r.rejected === 1 ? "its" : "their"} quote wasn't on the page it cited.`);
  if (file.toLowerCase().endsWith(".docx")) lines.push("A Word file has no pages, so these rules cite page 1 and there is no file to open.");
  lines.push("Facts and terms aren't imported. Enter them by hand in the Claim Ledger and Terms tabs.");
  return lines;
}

function ImportTab({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  const brand = useBrand();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [note, setNote] = useState<string[] | null>(null);
  const pending = kit.rules.filter((r) => r.pending);
  const decide = useAction((rule: Rule, approve: boolean) => (approve ? upsertRule({ ...rule, pending: false, active: true }) : deleteRule(rule.id)), { errorPrefix: "Could not save the decision" });

  // One import at a time. The book is read in batches: the one being read is said, and what happened is said when it is done.
  const importing = useAction(
    async (file: File) => {
      setNote(null);
      setProgress(`Reading ${file.name}…`);
      try {
        const result = await importBrandBook(file, (i, total) => setProgress(`Reading batch ${i + 1} of ${total}`));
        setNote(importSummary(result, file.name));
      } finally {
        setProgress(null);
      }
    },
    { toastError: false },
  );
  const busy = progress;
  const sample = useAction(async () => importing.run(await fetchAsFile("/samples/velvra-brand-book-update.pdf", "velvra-brand-book-update.pdf")), { toastError: false });
  const failure = importing.error ?? sample.error;

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-3">
        <h2 className="text-[16px] font-semibold">Import a brand book</h2>
        <p className="text-[13px] leading-5 text-muted">
          Upload a PDF or Word brand book. Assay drafts candidate rules with the page each came from. Each one waits here, inactive, until a Brand Admin approves it.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx"
          className="sr-only"
          aria-label="Brand book file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importing.run(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary btn-sm" disabled={!admin || !!busy} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Upload brand book
          </button>
          {brand?.demo && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={!admin || !!busy}
              onClick={() => void sample.run()}
            >
              Try the sample update pages
            </button>
          )}
        </div>
        {!admin && <p className="text-[13px] text-muted">Switch to Brand Admin to import.</p>}
        {busy && <Spinner label={busy} />}
        {failure && (
          <Notice tone="error" role="alert">
            {failure}
          </Notice>
        )}
        {note && (
          <Notice tone="info" role="status">
            {note.map((line, i) => (
              <p key={i} className={i ? "mt-1.5" : ""}>
                {line}
              </p>
            ))}
          </Notice>
        )}
      </div>
      <div>
        <h2 className="text-[16px] font-semibold">Waiting for approval</h2>
        <ul className="mt-3 space-y-3">
          {pending.length === 0 && <li><Empty title="No imported rules are waiting." /></li>}
          {pending.map((r) => (
            <li key={r.id} className="rounded-[24px] bg-raised p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Code>{r.id}</Code>
                <span className="text-[13px] font-medium">{CATEGORY_LABEL[r.category]}</span>
                <SeverityPill severity={r.severity} />
                <span className="ml-auto text-[12px] text-muted">
                  {r.source.doc} · page {r.source.page} · {r.source.section}
                </span>
              </div>
              <p className="mt-2 text-[14px] leading-[22px]">{r.text}</p>
              {r.source.bookId && r.source.page > 0 && (
                <p className="mt-2 text-[13px]">
                  <CitationButton target={ruleTarget(r)}>Open page {r.source.page} of {r.source.doc}</CitationButton>
                </p>
              )}
              {admin && (
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-primary btn-sm" disabled={decide.busy} onClick={() => decide.run(r, true)}>
                    Approve
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={decide.busy} onClick={() => decide.run(r, false)}>
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function VersionsTab({ admin }: { admin: boolean }) {
  const confirm = useConfirm();
  const versions = useLiveQuery(() => db.rulebooks.orderBy("publishedAt").reverse().toArray(), []);
  const back = useAction(
    async (v: RulebookVersion, current: string) => {
      const yes = await confirm({
        title: `Roll back to v${v.version}?`,
        body: (
          <>
            <p>
              Assay publishes a new version with exactly the rules, facts, terms and palette that v{v.version} had. Nothing is deleted: v{current} stays in this list, and every Hallmark keeps the version it was sealed with.
            </p>
            <p className="mt-2">The Brand Kit draft moves back only what differs between v{current} and v{v.version}, so edits you have not published yet stay as they are.</p>
          </>
        ),
        confirmLabel: `Roll back to v${v.version}`,
      });
      return yes ? await rollbackRulebook(v.version) : undefined;
    },
    { errorPrefix: "Could not roll back", success: (n) => (n ? `Rolled back: v${n} is published with the earlier content.` : undefined) },
  );
  if (!versions) return null;
  return (
    <ol className="max-w-[960px] space-y-4">
      {versions.map((v, i) => {
        const prev = versions[i + 1];
        const ids = new Set(v.snapshot.rules.map((r) => r.id));
        const prevIds = new Set(prev?.snapshot.rules.map((r) => r.id) ?? []);
        const added = [...ids].filter((x) => !prevIds.has(x));
        const removed = [...prevIds].filter((x) => !ids.has(x));
        const changed = prev ? v.snapshot.rules.filter((r) => prevIds.has(r.id) && JSON.stringify(r) !== JSON.stringify(prev.snapshot.rules.find((p) => p.id === r.id))).map((r) => r.id) : [];
        const c = v.clarification;
        return (
          <li key={v.id} className="rounded-[28px] bg-raised p-5 md:p-6" data-version={v.version}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">
                Rulebook v{v.version} {i === 0 && <span className="pill ml-1 bg-pos-bg text-pos-ink">In use</span>}
                {v.rolledBackTo && <span className="pill ml-1 bg-neutral-bg text-neutral-ink">Rolled back to v{v.rolledBackTo}</span>}
                {c && <span className="pill ml-1 bg-gold-soft text-gold-ink">Clarification</span>}
              </h2>
              <span className="text-[12px] text-muted">
                {v.publishedBy} · {fmtTime(v.publishedAt)}
              </span>
            </div>
            <p className="mt-1 text-[14px]">{v.notes}</p>
            {c && (
              <dl className="mt-3 grid gap-x-4 gap-y-1.5 rounded-[20px] bg-field px-5 py-4 text-[13.5px] leading-5 sm:grid-cols-[110px_minmax(0,1fr)]">
                <dt className="text-muted">Rule reworded</dt>
                <dd>
                  <Code>{c.ruleId}</Code>
                </dd>
                <dt className="text-muted">Why</dt>
                <dd>{c.rationale}</dd>
                <dt className="text-muted">Drafted by</dt>
                <dd>{c.draftedBy}</dd>
                <dt className="text-muted">Published</dt>
                <dd>{fmtTime(c.at)}</dd>
                <dt className="text-muted">Wording before</dt>
                <dd className="text-muted">“{c.before.text}”</dd>
              </dl>
            )}
            {v.rolledBackTo && <p className="mt-2 text-[13px] text-muted">Restores the content of v{v.rolledBackTo}. Nothing was deleted.</p>}
            {prev && (
              <p className="mt-1 text-[13px] text-muted">
                {added.length ? `Added ${added.join(", ")}. ` : ""}
                {removed.length ? `Removed ${removed.join(", ")}. ` : ""}
                {changed.length ? `Changed ${changed.join(", ")}.` : ""}
                {!added.length && !removed.length && !changed.length ? "Facts, terms or assets changed." : ""}
              </p>
            )}
            {prev && <VersionDiffs v={v} prev={prev} added={added} changed={changed} />}
            <p className="mt-3 text-[12px] text-muted">
              SHA-256 <Code title={v.hash}>{v.hash.slice(0, 16)}…</Code> · {v.snapshot.rules.length} rules · {v.snapshot.facts.length} facts
            </p>
            {i > 0 && (
              <div className="mt-3">
                <button className="btn btn-secondary btn-sm" disabled={!admin || back.busy} aria-describedby={admin ? undefined : `roll-why-${v.id}`} onClick={() => back.run(v, versions[0].version)}>
                  <RotateCcw size={14} aria-hidden="true" /> Roll back to v{v.version}
                </button>
                {!admin && (
                  <p id={`roll-why-${v.id}`} className="mt-1.5 text-[12.5px] text-muted">
                    Only a Brand Admin can roll back.
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** What a version changed, word by word: the rules whose text moved, the rules it added, and the facts whose approved wording moved. */
function VersionDiffs({ v, prev, added, changed }: { v: RulebookVersion; prev: RulebookVersion; added: string[]; changed: string[] }) {
  const LIMIT = 4;
  const rows: { key: string; code: string; title: string; before?: string; after: string; note?: string }[] = [];
  for (const id of added) {
    const r = v.snapshot.rules.find((x) => x.id === id)!;
    rows.push({ key: `a-${id}`, code: id, title: r.title, after: r.text, note: "Added" });
  }
  for (const id of changed) {
    const r = v.snapshot.rules.find((x) => x.id === id)!;
    const was = prev.snapshot.rules.find((x) => x.id === id)!;
    rows.push({ key: `c-${id}`, code: id, title: r.title, before: was.text, after: r.text, note: was.text === r.text ? "Settings changed, the wording did not" : undefined });
  }
  for (const f of v.snapshot.facts) {
    const was = prev.snapshot.facts.find((x) => x.id === f.id);
    if (was && JSON.stringify(was) !== JSON.stringify(f)) rows.push({ key: `f-${f.id}`, code: f.id, title: "Claim Ledger fact", before: was.approvedWording, after: f.approvedWording, note: was.approvedWording === f.approvedWording ? "Dates, owner or figures changed, the wording did not" : undefined });
  }
  if (!rows.length) return null;
  return (
    <ul className="mt-3 space-y-2" aria-label={`What v${v.version} changed`}>
      {rows.slice(0, LIMIT).map((r) => (
        <li key={r.key} className="rounded-[20px] bg-field px-4 py-3 text-[13.5px] leading-5">
          <p className="flex flex-wrap items-center gap-2">
            <Code>{r.code}</Code>
            <span className="font-medium">{r.title}</span>
          </p>
          <div className="mt-1.5 text-[14px]">{r.note && r.before === r.after ? <span className="text-muted">{r.note}.</span> : r.before !== undefined ? <DiffView before={r.before} after={r.after} /> : <span className="text-muted">{r.note}: </span>}{r.before === undefined ? r.after : null}</div>
        </li>
      ))}
      {rows.length > LIMIT && <li className="px-1 text-[13px] text-muted">and {rows.length - LIMIT} more change{rows.length - LIMIT === 1 ? "" : "s"}.</li>}
    </ul>
  );
}
