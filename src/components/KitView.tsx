"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Upload } from "lucide-react";
import type { BrandKit, Category, Channel, Fact, Rule, Severity } from "@/lib/types";
import { db, todayIso } from "@/store/db";
import { deleteRule, publishRulebook, unpublishedChanges, updateKit, upsertRule } from "@/store/actions";
import { useAiStatus, useKit, useRole } from "@/store/hooks";
import { CHANNELS } from "@/seed/velvra";
import { formatDate, isExpired } from "@/engine/claims";
import { candidateToRule, heuristicCandidates, type Candidate } from "@/lib/import";
import { aiTask } from "@/lib/ai-client";
import { docxText, fetchAsFile, pdfText } from "@/lib/parse";
import { INPUT_CAP } from "@/lib/ai-tasks";
import { TitleRow } from "./AppShell";
import { CATEGORY_LABEL, Code, Empty, fmtTime, Notice, PageLoading, SeverityPill, Spinner, Tabs } from "./ui";

type Tab = "rules" | "facts" | "terms" | "assets" | "import" | "versions";
const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function KitView() {
  const role = useRole();
  const kit = useKit();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "rules");
  const latest = useLiveQuery(() => db.rulebooks.orderBy("publishedAt").last(), []);
  const dirty = useLiveQuery(() => unpublishedChanges(), [kit?.updatedAt, latest?.id]);
  const [notes, setNotes] = useState("");
  const [published, setPublished] = useState<string | null>(null);
  const admin = role === "admin";
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
            {kit.brandBook}. Checks use the published rulebook v{latest.version}; edits here stay in a draft until you publish.
            {dirty ? <span className="text-ink"> The draft has unpublished changes.</span> : " The draft matches the published rulebook."}
          </>
        }
        actions={
          admin ? (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="pub-notes" className="sr-only">
                What changed
              </label>
              <input id="pub-notes" className="field !h-[34px] w-56" placeholder="What changed in this version" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!dirty} />
              <button
                className="btn btn-primary"
                disabled={!dirty || pending.length > 0}
                title={pending.length ? "Approve or reject imported rules first" : undefined}
                onClick={async () => {
                  const v = await publishRulebook(notes || "Updated rules");
                  setPublished(v);
                  setNotes("");
                }}
              >
                Publish v{next}
              </button>
            </div>
          ) : undefined
        }
      />
      {!admin && <p className="mt-3 text-[13px] text-muted">Read-only. Switch to Brand Admin in the top bar to edit rules, facts and assets.</p>}
      {published && (
        <div className="mt-3">
          <Notice tone="info">
            Published rulebook v{published}. New drafts are checked against it; existing drafts and their Hallmarks keep the version they were checked against.
          </Notice>
        </div>
      )}
      <div className="mt-5">
        <Tabs
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
      <div className="mt-5">
        {tab === "rules" && <RulesTab kit={kit} admin={admin} />}
        {tab === "facts" && <FactsTab kit={kit} admin={admin} />}
        {tab === "terms" && <TermsTab kit={kit} admin={admin} />}
        {tab === "assets" && <AssetsTab kit={kit} admin={admin} />}
        {tab === "import" && <ImportTab kit={kit} admin={admin} />}
        {tab === "versions" && <VersionsTab />}
      </div>
    </div>
  );
}

function RulesTab({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  const rules = kit.rules.filter((r) => !r.pending);
  const [sel, setSel] = useState<string | null>(rules[0]?.id ?? null);
  const rule = kit.rules.find((r) => r.id === sel);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="pb-2 font-normal">Rule</th>
              <th className="pb-2 font-normal">Category</th>
              <th className="pb-2 font-normal">Severity</th>
              <th className="pb-2 font-normal">Checked by</th>
              <th className="pb-2 text-right font-normal">Source</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} onClick={() => setSel(r.id)} className={`cursor-pointer border-t border-rule ${sel === r.id ? "bg-raised" : "hover:bg-raised"} ${r.active ? "" : "text-muted"}`}>
                <td className="py-2.5 pr-2 pl-1">
                  <button className="text-left" onClick={() => setSel(r.id)}>
                    <Code>{r.id}</Code> {r.title}
                    {!r.active && <span className="pill ml-2 bg-neutral-bg text-neutral-ink">Off</span>}
                  </button>
                </td>
                <td className="py-2.5 pr-2">{CATEGORY_LABEL[r.category]}</td>
                <td className="py-2.5 pr-2">
                  <SeverityPill severity={r.severity} />
                </td>
                <td className="py-2.5 pr-2 text-[13px] text-muted">{r.modes.map((m) => (m === "judgment" ? "AI judgment" : m === "manual" ? "manual" : "code")).filter((v, i, a) => a.indexOf(v) === i).join(" + ")}</td>
                <td className="num py-2.5 pr-1 text-right text-[13px] text-muted">
                  p.{r.source.page} {r.source.section}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {admin && (
          <button
            className="btn btn-secondary btn-sm mt-3"
            onClick={async () => {
              const n = kit.rules.filter((r) => r.id.startsWith("CUSTOM-")).length + 1;
              const id = `CUSTOM-${String(n).padStart(2, "0")}`;
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
            }}
          >
            <Plus size={14} /> Add rule
          </button>
        )}
      </div>
      {rule && <RuleEditor key={`${rule.id}-${kit.updatedAt}`} rule={rule} admin={admin} />}
    </div>
  );
}

function RuleEditor({ rule, admin }: { rule: Rule; admin: boolean }) {
  const [r, setR] = useState(rule);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Rule>) => {
    setR((x) => ({ ...x, ...patch }));
    setSaved(false);
  };
  return (
    <form
      className="space-y-4 rounded-[16px] bg-raised p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        await upsertRule(r);
        setSaved(true);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">
          <Code>{r.id}</Code> {admin ? "Edit rule" : "Rule"}
        </h2>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="h-4 w-4 accent-[#17140f]" checked={r.active} disabled={!admin} onChange={(e) => set({ active: e.target.checked })} /> Active
        </label>
      </div>
      <div>
        <label htmlFor="r-title" className="text-[13px] font-medium">
          Title
        </label>
        <input id="r-title" className="field mt-1.5" value={r.title} disabled={!admin} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div>
        <label htmlFor="r-text" className="text-[13px] font-medium">
          Rule text
        </label>
        <textarea id="r-text" className="field mt-1.5" rows={3} value={r.text} disabled={!admin} onChange={(e) => set({ text: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="r-cat" className="text-[13px] font-medium">
            Category
          </label>
          <select id="r-cat" className="field mt-1.5" value={r.category} disabled={!admin} onChange={(e) => set({ category: e.target.value as Category })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="r-sev" className="text-[13px] font-medium">
            Severity
          </label>
          <select id="r-sev" className="field mt-1.5" value={r.severity} disabled={!admin} onChange={(e) => set({ severity: e.target.value as Severity })}>
            {(["high", "medium", "low"] as const).map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="text-[13px] font-medium">Channels (none ticked means every channel)</legend>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {CHANNELS.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#17140f]"
                disabled={!admin}
                checked={r.channels.includes(c.id)}
                onChange={(e) => set({ channels: e.target.checked ? [...r.channels, c.id] : r.channels.filter((x: Channel) => x !== c.id) })}
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      {r.modes.includes("lexical") && (
        <div>
          <label htmlFor="r-pat" className="text-[13px] font-medium">
            Phrases checked in code (one per line)
          </label>
          <textarea id="r-pat" className="field mt-1.5" rows={3} value={r.patterns.join("\n")} disabled={!admin} onChange={(e) => set({ patterns: lines(e.target.value) })} />
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="r-dos" className="text-[13px] font-medium">
            Do examples
          </label>
          <textarea id="r-dos" className="field mt-1.5" rows={3} value={r.dos.join("\n")} disabled={!admin} onChange={(e) => set({ dos: lines(e.target.value) })} />
        </div>
        <div>
          <label htmlFor="r-donts" className="text-[13px] font-medium">
            Don&apos;t examples
          </label>
          <textarea id="r-donts" className="field mt-1.5" rows={3} value={r.donts.join("\n")} disabled={!admin} onChange={(e) => set({ donts: lines(e.target.value) })} />
        </div>
      </div>
      <p className="text-[12px] text-muted">
        Source: {r.source.doc}, page {r.source.page}, {r.source.section}
      </p>
      {admin && (
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm" type="submit">
            Save to draft
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-neg-ink"
            onClick={async () => {
              if (confirm(`Delete ${r.id} from the draft? Published versions keep it.`)) await deleteRule(r.id);
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
          {saved && <span className="text-[13px] text-positive">Saved to the draft</span>}
        </div>
      )}
    </form>
  );
}

function FactsTab({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  const [sel, setSel] = useState<string | null>(kit.facts[0]?.id ?? null);
  const fact = kit.facts.find((f) => f.id === sel);
  const today = todayIso();
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="pb-2 font-normal">Fact</th>
              <th className="pb-2 font-normal">Owner</th>
              <th className="pb-2 text-right font-normal">Valid to</th>
            </tr>
          </thead>
          <tbody>
            {kit.facts.map((f) => (
              <tr key={f.id} onClick={() => setSel(f.id)} className={`cursor-pointer border-t border-rule align-top ${sel === f.id ? "bg-raised" : "hover:bg-raised"}`}>
                <td className="py-2.5 pr-2 pl-1">
                  <button className="text-left" onClick={() => setSel(f.id)}>
                    <Code>{f.id}</Code> {f.statement}
                  </button>
                </td>
                <td className="py-2.5 pr-2 text-muted">{f.owner}</td>
                <td className="num py-2.5 pr-1 text-right">
                  {f.validTo ? (
                    <span className={isExpired(f, today) ? "pill bg-neg-bg text-neg-ink" : ""}>{isExpired(f, today) ? `Expired ${formatDate(f.validTo)}` : formatDate(f.validTo)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {admin && (
          <button
            className="btn btn-secondary btn-sm mt-3"
            onClick={async () => {
              const id = `F-${200 + kit.facts.length}`;
              const f: Fact = { id, statement: "New fact", approvedWording: "New fact", inlineWording: "new fact", kind: "spec", quantities: [], keywords: [], triggers: [], owner: "Product", source: "" };
              await updateKit({ facts: [...kit.facts, f] }, `fact ${id}`);
              setSel(id);
            }}
          >
            <Plus size={14} /> Add fact
          </button>
        )}
      </div>
      {fact && <FactEditor key={`${fact.id}-${kit.updatedAt}`} fact={fact} kit={kit} admin={admin} />}
    </div>
  );
}

function FactEditor({ fact, kit, admin }: { fact: Fact; kit: BrandKit; admin: boolean }) {
  const [f, setF] = useState(fact);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Fact>) => {
    setF((x) => ({ ...x, ...patch }));
    setSaved(false);
  };
  const field = (id: keyof Fact, label: string, rows = 1) => (
    <div>
      <label htmlFor={`f-${id}`} className="text-[13px] font-medium">
        {label}
      </label>
      {rows > 1 ? (
        <textarea id={`f-${id}`} className="field mt-1.5" rows={rows} value={String(f[id] ?? "")} disabled={!admin} onChange={(e) => set({ [id]: e.target.value } as Partial<Fact>)} />
      ) : (
        <input id={`f-${id}`} className="field mt-1.5" value={String(f[id] ?? "")} disabled={!admin} onChange={(e) => set({ [id]: e.target.value } as Partial<Fact>)} />
      )}
    </div>
  );
  return (
    <form
      className="space-y-4 rounded-[16px] bg-raised p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        await updateKit({ facts: kit.facts.map((x) => (x.id === f.id ? f : x)) }, `fact ${f.id}`);
        setSaved(true);
      }}
    >
      <h2 className="text-[16px] font-semibold">
        <Code>{f.id}</Code> {admin ? "Edit fact" : "Fact"}
      </h2>
      {field("statement", "Statement", 2)}
      {field("approvedWording", "Approved wording", 2)}
      {field("footnote", "Footnote")}
      <div className="grid grid-cols-2 gap-3">
        {field("owner", "Owner")}
        <div>
          <label htmlFor="f-validTo" className="text-[13px] font-medium">
            Valid to
          </label>
          <input id="f-validTo" type="date" className="field mt-1.5" value={f.validTo ?? ""} disabled={!admin} onChange={(e) => set({ validTo: e.target.value || undefined })} />
        </div>
      </div>
      <div>
        <label htmlFor="f-trig" className="text-[13px] font-medium">
          Phrases that make this claim (one per line)
        </label>
        <textarea id="f-trig" className="field mt-1.5" rows={3} value={f.triggers.join("\n")} disabled={!admin} onChange={(e) => set({ triggers: lines(e.target.value) })} />
      </div>
      <p className="text-[12px] text-muted">
        Figures compared in code: {f.quantities.length ? f.quantities.map((q) => `${q.value} ${q.unit}`).join(", ") : "none"} · source {f.source || "—"}
      </p>
      {admin && (
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm" type="submit">
            Save to draft
          </button>
          {saved && <span className="text-[13px] text-positive">Saved to the draft</span>}
        </div>
      )}
    </form>
  );
}

function TermsTab({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  return (
    <div className="max-w-[860px] space-y-3">
      {kit.terms.map((t) => (
        <form
          key={`${t.id}-${kit.updatedAt}`}
          className="grid items-end gap-3 rounded-[14px] border border-line p-4 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const banned = String(fd.get("banned")).split(",").map((s) => s.trim()).filter(Boolean);
            const preferred = String(fd.get("preferred")).trim();
            await updateKit({ terms: kit.terms.map((x) => (x.id === t.id ? { ...x, banned, preferred } : x)) }, `term ${t.ruleId}`);
          }}
        >
          <div>
            <label htmlFor={`b-${t.id}`} className="text-[13px] font-medium">
              <Code>{t.ruleId}</Code> Not this (comma-separated)
            </label>
            <input id={`b-${t.id}`} name="banned" className="field mt-1.5" defaultValue={t.banned.join(", ")} disabled={!admin} />
          </div>
          <div>
            <label htmlFor={`p-${t.id}`} className="text-[13px] font-medium">
              Say this
            </label>
            <input id={`p-${t.id}`} name="preferred" className="field mt-1.5" defaultValue={t.preferred} disabled={!admin} />
          </div>
          <div className="flex items-center gap-2">
            <SeverityPill severity={t.severity} />
            {admin && (
              <button className="btn btn-secondary btn-sm" type="submit">
                Save
              </button>
            )}
          </div>
        </form>
      ))}
    </div>
  );
}

function AssetsTab({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  return (
    <div className="space-y-8">
      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div>
          <h2 className="text-[16px] font-semibold">Palette</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">Creatives are flagged when a dominant colour is more than ΔE2000 10 from every colour here (VIS-01).</p>
        </div>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {kit.palette.map((p, i) => (
            <li key={p.name} className="rounded-[14px] border border-line p-3">
              <div className="h-14 rounded-[10px]" style={{ background: p.hex }} aria-hidden="true" />
              <p className="mt-2 text-[13px] font-medium">{p.name}</p>
              <label htmlFor={`hex-${i}`} className="sr-only">
                {p.name} hex
              </label>
              <input
                id={`hex-${i}`}
                className="field mt-1 !h-8 font-mono text-[12.5px]"
                defaultValue={p.hex}
                disabled={!admin}
                onBlur={(e) => {
                  const hex = e.target.value.trim().toUpperCase();
                  if (/^#[0-9A-F]{6}$/.test(hex) && hex !== p.hex) void updateKit({ palette: kit.palette.map((x, j) => (j === i ? { ...x, hex } : x)) }, `palette ${p.name}`);
                }}
              />
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div>
          <h2 className="text-[16px] font-semibold">Logo</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">Checked against the logo box a creator marks on a creative (VIS-03). Automatic logo detection is Round 3.</p>
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
              if (v > 0 && v !== kit.logo.minWidthPx) void updateKit({ logo: { ...kit.logo, minWidthPx: v } }, "logo minimum width");
            }}
          />
        </div>
      </section>
      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div>
          <h2 className="text-[16px] font-semibold">Channel limits</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">Used by VOICE-02 (exclamation marks), A11Y-05 (emoji and capitals) and A11Y-03 (readability).</p>
        </div>
        <div className="overflow-x-auto">
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
                            if (Number.isFinite(v) && v !== l[k]) void updateKit({ channelLimits: { ...kit.channelLimits, [c.id]: { ...l, [k]: v } } }, `${c.label} ${k}`);
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
    <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div>
        <h2 className="text-[16px] font-semibold">Confidential mode</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted">When on, nothing from this Brand Kit&apos;s drafts is sent to any AI service. Checks run as rule checks only.</p>
      </div>
      <label className="flex max-w-[560px] items-center justify-between gap-4 rounded-[14px] bg-raised p-4 text-[14px]">
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

function ImportTab({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  const ai = useAiStatus();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pending = kit.rules.filter((r) => r.pending);

  const run = async (file: File) => {
    setBusy(`Reading ${file.name}…`);
    setNote(null);
    try {
      const buf = await file.arrayBuffer();
      let pages: { page: number; text: string }[];
      if (file.name.toLowerCase().endsWith(".pdf")) {
        const r = await pdfText(buf);
        pages = r.pages.map((p) => ({ page: p.page, text: r.text.slice(p.start, p.end) }));
      } else if (file.name.toLowerCase().endsWith(".docx")) {
        pages = [{ page: 1, text: await docxText(buf) }];
      } else throw new Error("Import a PDF or DOCX brand book.");
      let candidates: Candidate[] = [];
      let by = "heuristic";
      if (ai?.aiConfigured && !kit.confidential) {
        setBusy("Asking the AI to draft candidate rules…");
        let budget = INPUT_CAP - 200;
        const sent = pages.filter((p) => (budget -= p.text.length) >= 0);
        const r = await aiTask("draftRules", { pages: sent });
        if (r.ok) {
          // Keep only AI candidates whose quote really is on the page it cites.
          candidates = r.data.rules
            .filter((c) => pages.find((p) => p.page === c.page)?.text.replace(/\s+/g, " ").includes(c.quote.replace(/\s+/g, " ").slice(0, 60)))
            .map((c) => ({ ...c, by: "ai" as const }));
          by = `AI (${r.model})`;
          const rest = pages.filter((p) => !sent.includes(p));
          if (rest.length) candidates.push(...heuristicCandidates(rest));
        }
      }
      if (!candidates.length) {
        candidates = heuristicCandidates(pages);
        by = "heuristic (must / never / always / avoid / don't)";
      }
      const base = kit.rules.filter((r) => r.id.startsWith("IMP-")).length;
      const rules = candidates.map((c, i) => candidateToRule(c, `IMP-${String(base + i + 1).padStart(2, "0")}`, file.name));
      await updateKit({ rules: [...kit.rules, ...rules] }, `imported ${rules.length} candidate rules from ${file.name}`);
      setNote(`${rules.length} candidate rule${rules.length === 1 ? "" : "s"} from ${pages.length} page${pages.length === 1 ? "" : "s"}, drafted by ${by}. None is active until you approve it.`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

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
            if (f) void run(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary btn-sm" disabled={!admin || !!busy} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Upload brand book
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!admin || !!busy}
            onClick={async () => run(await fetchAsFile("/samples/velvra-brand-book-update.pdf", "velvra-brand-book-update.pdf"))}
          >
            Try the sample update pages
          </button>
        </div>
        {!admin && <p className="text-[13px] text-muted">Switch to Brand Admin to import.</p>}
        {busy && <Spinner label={busy} />}
        {note && <Notice tone="info">{note}</Notice>}
      </div>
      <div>
        <h2 className="text-[16px] font-semibold">Waiting for approval</h2>
        <ul className="mt-3 space-y-3">
          {pending.length === 0 && <li><Empty title="No imported rules are waiting." /></li>}
          {pending.map((r) => (
            <li key={r.id} className="rounded-[14px] border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Code>{r.id}</Code>
                <span className="text-[13px] font-medium">{CATEGORY_LABEL[r.category]}</span>
                <SeverityPill severity={r.severity} />
                <span className="ml-auto text-[12px] text-muted">
                  {r.source.doc} · page {r.source.page} · {r.source.section}
                </span>
              </div>
              <p className="mt-2 text-[14px] leading-[22px]">{r.text}</p>
              {admin && (
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-primary btn-sm" onClick={() => upsertRule({ ...r, pending: false, active: true })}>
                    Approve
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteRule(r.id)}>
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

function VersionsTab() {
  const versions = useLiveQuery(() => db.rulebooks.orderBy("publishedAt").reverse().toArray(), []);
  if (!versions) return null;
  return (
    <ol className="max-w-[860px] space-y-3">
      {versions.map((v, i) => {
        const prev = versions[i + 1];
        const ids = new Set(v.snapshot.rules.map((r) => r.id));
        const prevIds = new Set(prev?.snapshot.rules.map((r) => r.id) ?? []);
        const added = [...ids].filter((x) => !prevIds.has(x));
        const removed = [...prevIds].filter((x) => !ids.has(x));
        const changed = prev ? v.snapshot.rules.filter((r) => prevIds.has(r.id) && JSON.stringify(r) !== JSON.stringify(prev.snapshot.rules.find((p) => p.id === r.id))).map((r) => r.id) : [];
        return (
          <li key={v.id} className="rounded-[14px] border border-line p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">
                Rulebook v{v.version} {i === 0 && <span className="pill ml-1 bg-pos-bg text-pos-ink">In use</span>}
              </h2>
              <span className="text-[12px] text-muted">
                {v.publishedBy} · {fmtTime(v.publishedAt)}
              </span>
            </div>
            <p className="mt-1 text-[14px]">{v.notes}</p>
            {prev && (
              <p className="mt-1 text-[13px] text-muted">
                {added.length ? `Added ${added.join(", ")}. ` : ""}
                {removed.length ? `Removed ${removed.join(", ")}. ` : ""}
                {changed.length ? `Changed ${changed.join(", ")}.` : ""}
                {!added.length && !removed.length && !changed.length ? "Facts, terms or assets changed." : ""}
              </p>
            )}
            <p className="mt-1 text-[12px] text-muted">
              SHA-256 <Code title={v.hash}>{v.hash.slice(0, 16)}…</Code> · {v.snapshot.rules.length} rules · {v.snapshot.facts.length} facts
            </p>
          </li>
        );
      })}
    </ol>
  );
}
