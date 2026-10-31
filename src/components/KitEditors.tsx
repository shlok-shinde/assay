"use client";

// The Brand Kit's editors for what a brand brings itself: its words, its palette and its facts. Each one
// adds, edits and removes through updateKit, checks what it is given before saving (a colour must be a
// hex code, a date must be a date and not end before it starts) and says what is wrong beside the field.
// Everything lands in the Brand Kit draft; publishing is a separate step.
import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { BrandKit, Fact, FactKind, Quantity, Rule, Severity, Term, Unit } from "@/lib/types";
import { formatDate, isExpired } from "@/engine/claims";
import { updateKit } from "@/store/actions";
import { todayIso } from "@/store/db";
import { Field, Select, Table, Term as Gloss, useAction, useConfirm } from "./primitives";
import { ValidityBar } from "./ValidityBar";
import { nextFactId, nextRuleId, normaliseHex } from "./kit-helpers";
import { Code, Empty, SeverityPill } from "./ui";

const commas = (s: string) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];
const lines = (s: string) => [...new Set(s.split("\n").map((x) => x.trim()).filter(Boolean))];
const quote = (list: string[]) => list.map((x) => `“${x}”`).join(", ");

// ---- Terms ----------------------------------------------------------------

/** Written onto the rule a term creates, so removing the term can tell the rule is its own to remove. */
const TERM_SECTION = "Terms (added in Assay)";

const SEVERITIES: Severity[] = ["high", "medium", "low"];

function termProblems(banned: string[], preferred: string): { banned?: string; preferred?: string } {
  const out: { banned?: string; preferred?: string } = {};
  if (!banned.length) out.banned = "List at least one phrase to avoid.";
  if (!preferred.trim()) out.preferred = "Say what to write instead.";
  else if (banned.some((b) => b.toLowerCase() === preferred.trim().toLowerCase())) out.preferred = "That phrase is in the avoid list too.";
  return out;
}

export function TermsTab({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  return (
    <div className="max-w-[900px] space-y-4">
      <p className="text-[13.5px] leading-[21px] text-muted">
        A term pairs words the brand never uses with the wording to use instead. Code finds the avoided words in a draft (any capitals, whole words) and offers the replacement as a fix. Each term belongs to a rule, so its findings cite that rule.
      </p>
      {admin && <AddTerm kit={kit} />}
      {kit.terms.length === 0 && <Empty title="No terms yet.">{admin ? "Add the first one above." : "A Brand Admin can add them."}</Empty>}
      <ul className="space-y-3">
        {kit.terms.map((t) => (
          <li key={`${t.id}-${kit.updatedAt}`}>
            <TermRow term={t} kit={kit} admin={admin} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddTerm({ kit }: { kit: BrandKit }) {
  const [banned, setBanned] = useState("");
  const [preferred, setPreferred] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [errors, setErrors] = useState<ReturnType<typeof termProblems>>({});
  const add = useAction(
    async () => {
      const list = commas(banned);
      const found = termProblems(list, preferred);
      setErrors(found);
      if (found.banned || found.preferred) return false;
      const say = preferred.trim();
      const ruleId = nextRuleId(kit.rules, "TERM");
      const rule: Rule = {
        id: ruleId,
        title: `Say “${say}”`,
        text: `Write “${say}”, not ${quote(list)}.`,
        category: "term",
        severity,
        modes: ["lexical"],
        channels: [],
        dos: [say],
        donts: list.slice(0, 3),
        patterns: [],
        replacements: {},
        source: { doc: kit.brandBook, page: 0, section: TERM_SECTION },
        active: true,
      };
      const term: Term = { id: `t_${ruleId.toLowerCase()}`, ruleId, banned: list, preferred: say, note: "", severity };
      await updateKit({ rules: [...kit.rules, rule], terms: [...kit.terms, term] }, `term ${ruleId}`);
      setBanned("");
      setPreferred("");
      return ruleId;
    },
    { errorPrefix: "Could not add the term", success: (id) => (id ? `Added ${id}. It checks drafts once the rulebook is published.` : undefined) },
  );
  return (
    <form
      aria-label="Add a term"
      className="grid items-start gap-3 rounded-[24px] bg-raised p-5 md:grid-cols-[1fr_1fr_140px_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        void add.run();
      }}
    >
      <Field label="Not this (comma-separated)" value={banned} onChange={(e) => (setBanned(e.target.value), setErrors({ ...errors, banned: undefined }))} error={errors.banned} placeholder="sun cream, sunblock" />
      <Field label="Say this" value={preferred} onChange={(e) => (setPreferred(e.target.value), setErrors({ ...errors, preferred: undefined }))} error={errors.preferred} placeholder="sunscreen" />
      <Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s[0].toUpperCase() + s.slice(1)}
          </option>
        ))}
      </Select>
      <div className="md:pt-[30px]">
        <button className="btn btn-inverse" type="submit" disabled={add.busy}>
          <Plus size={14} aria-hidden="true" /> Add term
        </button>
      </div>
    </form>
  );
}

function TermRow({ term, kit, admin }: { term: Term; kit: BrandKit; admin: boolean }) {
  const confirm = useConfirm();
  const [banned, setBanned] = useState(term.banned.join(", "));
  const [preferred, setPreferred] = useState(term.preferred);
  const [severity, setSeverity] = useState<Severity>(term.severity);
  const [errors, setErrors] = useState<ReturnType<typeof termProblems>>({});
  const own = kit.rules.find((r) => r.id === term.ruleId && r.source.section === TERM_SECTION);
  const save = useAction(
    async () => {
      const list = commas(banned);
      const found = termProblems(list, preferred);
      setErrors(found);
      if (found.banned || found.preferred) return false;
      await updateKit({ terms: kit.terms.map((x) => (x.id === term.id ? { ...x, banned: list, preferred: preferred.trim(), severity } : x)) }, `term ${term.ruleId}`);
      return true;
    },
    { errorPrefix: "Could not save the term", success: (ok) => (ok ? `Saved ${term.ruleId} to the draft.` : undefined) },
  );
  const remove = useAction(
    async () => {
      const yes = await confirm({
        title: `Remove ${term.ruleId}’s term?`,
        body: own ? `“${term.preferred}” stops being offered as a fix, and its rule ${term.ruleId} goes with it. Published rulebook versions keep both.` : `Code stops finding ${quote(term.banned)}. Rule ${term.ruleId} stays in the Rules tab. Published rulebook versions keep the term.`,
        confirmLabel: "Remove term",
        danger: true,
      });
      if (!yes) return false;
      await updateKit({ terms: kit.terms.filter((x) => x.id !== term.id), ...(own ? { rules: kit.rules.filter((r) => r.id !== own.id) } : {}) }, `removed term ${term.ruleId}`);
      return true;
    },
    { errorPrefix: "Could not remove the term", success: (ok) => (ok ? `Removed the ${term.ruleId} term.` : undefined) },
  );
  return (
    <form
      aria-label={`Term ${term.ruleId}`}
      className="grid items-start gap-3 rounded-[24px] bg-raised p-5 md:grid-cols-[1fr_1fr_140px]"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <Field
        id={`b-${term.id}`}
        label={
          <>
            <Code>{term.ruleId}</Code> Not this (comma-separated)
          </>
        }
        value={banned}
        disabled={!admin}
        onChange={(e) => (setBanned(e.target.value), setErrors({ ...errors, banned: undefined }))}
        error={errors.banned}
      />
      <Field id={`p-${term.id}`} label="Say this" value={preferred} disabled={!admin} onChange={(e) => (setPreferred(e.target.value), setErrors({ ...errors, preferred: undefined }))} error={errors.preferred} />
      {admin ? (
        <Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </Select>
      ) : (
        <div>
          <p className="text-[14px] font-medium">Severity</p>
          <div className="mt-2">
            <SeverityPill severity={term.severity} />
          </div>
        </div>
      )}
      {admin && (
        <div className="flex gap-2 md:col-span-3">
          <button className="btn btn-secondary btn-sm" type="submit" disabled={save.busy}>
            Save
          </button>
          <button className="btn btn-ghost btn-sm text-neg-ink" type="button" disabled={remove.busy} onClick={() => remove.run()}>
            <Trash2 size={14} aria-hidden="true" /> Remove
          </button>
        </div>
      )}
    </form>
  );
}

// ---- Palette ----------------------------------------------------------------

const HEX_ERROR = "Use a hex colour like #B8860B (a # and 6 letters or digits).";

export function PaletteSection({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div>
        <h2 className="text-[18px] font-semibold">Palette</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted">
          Creatives are flagged when a dominant colour is more than <Gloss id="delta-e">ΔE</Gloss> 2000 10 from every colour here (VIS-01). With no colours, creatives are not checked against a palette.
        </p>
      </div>
      <div className="min-w-0 space-y-4">
        {admin && <AddColour kit={kit} />}
        {kit.palette.length === 0 ? (
          <Empty title="No colours yet." />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {kit.palette.map((p) => (
              <li key={`${p.name}-${p.hex}-${kit.updatedAt}`}>
                <ColourCard colour={p} kit={kit} admin={admin} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function AddColour({ kit }: { kit: BrandKit }) {
  const [name, setName] = useState("");
  const [hex, setHex] = useState("");
  const [errors, setErrors] = useState<{ name?: string; hex?: string }>({});
  const preview = normaliseHex(hex);
  const add = useAction(
    async () => {
      const next: { name?: string; hex?: string } = {};
      const n = name.trim();
      if (!n) next.name = "Name the colour.";
      else if (kit.palette.some((p) => p.name.toLowerCase() === n.toLowerCase())) next.name = "A colour with that name is already in the palette.";
      const h = normaliseHex(hex);
      if (!h) next.hex = HEX_ERROR;
      setErrors(next);
      if (next.name || next.hex) return false;
      await updateKit({ palette: [...kit.palette, { name: n, hex: h! }] }, `palette ${n}`);
      setName("");
      setHex("");
      return n;
    },
    { errorPrefix: "Could not add the colour", success: (n) => (n ? `Added ${n} to the palette.` : undefined) },
  );
  return (
    <form
      aria-label="Add a colour"
      className="grid items-start gap-3 rounded-[18px] bg-raised p-4 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        void add.run();
      }}
    >
      <Field label="Colour name" value={name} onChange={(e) => (setName(e.target.value), setErrors({ ...errors, name: undefined }))} error={errors.name} placeholder="Rose Clay" />
      <div>
        <Field label="Hex code" value={hex} onChange={(e) => (setHex(e.target.value), setErrors({ ...errors, hex: undefined }))} error={errors.hex} placeholder="#C97B63" className="font-mono text-[13px]" spellCheck={false} />
      </div>
      <div className="flex items-center gap-3 sm:pt-[30px]">
        <span aria-hidden="true" className="h-10 w-10 flex-none rounded-full border border-line" style={{ background: preview ?? "transparent" }} />
        <button className="btn btn-inverse" type="submit" disabled={add.busy}>
          <Plus size={14} aria-hidden="true" /> Add colour
        </button>
      </div>
    </form>
  );
}

/** Whether black or white reads better on a colour, and by how much (WCAG relative luminance). */
function onColour(hex: string): { ink: string; ratio: number } {
  const lum = (h: string) => {
    const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const l = /^#[0-9a-f]{6}$/i.test(hex) ? lum(hex) : 0;
  const white = 1.05 / (l + 0.05);
  const black = (l + 0.05) / 0.05;
  return white >= black ? { ink: "#ffffff", ratio: white } : { ink: "#000000", ratio: black };
}

function ColourCard({ colour, kit, admin }: { colour: { name: string; hex: string }; kit: BrandKit; admin: boolean }) {
  const confirm = useConfirm();
  const [name, setName] = useState(colour.name);
  const [hex, setHex] = useState(colour.hex);
  const [errors, setErrors] = useState<{ name?: string; hex?: string }>({});
  const at = kit.palette.findIndex((p) => p.name === colour.name && p.hex === colour.hex);
  const shown = normaliseHex(hex) ?? colour.hex;

  const save = useAction(
    (n: string, h: string) => updateKit({ palette: kit.palette.map((p, i) => (i === at ? { name: n, hex: h } : p)) }, `palette ${n}`),
    { errorPrefix: "Could not save the colour", success: "Saved to the draft." },
  );
  const drop = useAction(
    async () => {
      if (!(await confirm({ title: `Remove ${colour.name}?`, body: "It leaves the draft palette. Published rulebook versions keep it.", confirmLabel: "Remove colour", danger: true }))) return false;
      await updateKit({ palette: kit.palette.filter((_, i) => i !== at) }, `removed palette ${colour.name}`);
      return true;
    },
    { errorPrefix: "Could not remove the colour", success: (done) => (done ? `Removed ${colour.name}.` : undefined) },
  );

  // Saves when a field is left with a good value; a bad one stays on screen with its error.
  const commit = async () => {
    const n = name.trim();
    const h = normaliseHex(hex);
    const next: { name?: string; hex?: string } = {};
    if (!n) next.name = "Name the colour.";
    else if (kit.palette.some((p, i) => i !== at && p.name.toLowerCase() === n.toLowerCase())) next.name = "A colour with that name is already in the palette.";
    if (!h) next.hex = HEX_ERROR;
    setErrors(next);
    if (next.name || next.hex || (n === colour.name && h === colour.hex)) return;
    await save.run(n, h!);
  };

  return (
    <div className="rounded-[28px] bg-raised p-3">
      <div className="flex h-36 items-end justify-between rounded-[22px] p-4" style={{ background: shown, color: onColour(shown).ink }} aria-hidden="true">
        <span className="text-[28px] font-semibold leading-none tracking-[-0.02em]">Aa</span>
        <span className="num text-[13px] font-medium">{onColour(shown).ratio.toFixed(1)}:1</span>
      </div>
      <div className="mt-3 space-y-3 px-1 pb-1">
        <Field label={`${colour.name} name`} hideLabel value={name} disabled={!admin} onChange={(e) => (setName(e.target.value), setErrors({ ...errors, name: undefined }))} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} error={errors.name} className="!h-9 font-medium" />
        <Field
          label={`${colour.name} hex`}
          hideLabel
          value={hex}
          disabled={!admin}
          onChange={(e) => (setHex(e.target.value), setErrors({ ...errors, hex: undefined }))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          error={errors.hex}
          className="!h-9 font-mono text-[12.5px]"
          spellCheck={false}
        />
      </div>
      {admin && (
        <button
          className="btn btn-ghost btn-sm mt-2 -ml-2 text-neg-ink"
          aria-label={`Remove ${colour.name}`}
          disabled={drop.busy}
          onClick={() => drop.run()}
        >
          <Trash2 size={14} aria-hidden="true" /> Remove
        </button>
      )}
    </div>
  );
}

// ---- Facts ----------------------------------------------------------------

const KINDS: FactKind[] = ["study", "clinical", "spec", "price", "offer", "certification", "policy", "panel"];
const UNITS: Unit[] = ["percent", "day", "week", "month", "year", "minute", "hour", "inr", "ml", "spf", "n", "count"];

const blankFact = (facts: Fact[]): Fact => ({ id: nextFactId(facts), statement: "", approvedWording: "", inlineWording: "", kind: "spec", quantities: [], keywords: [], triggers: [], owner: "", source: "" });

export function FactsTab({ kit, admin }: { kit: BrandKit; admin: boolean }) {
  const [sel, setSel] = useState<string | null>(kit.facts[0]?.id ?? null);
  const adding = sel === "new";
  const fact = adding ? blankFact(kit.facts) : kit.facts.find((f) => f.id === sel);
  const today = todayIso();
  const expired = kit.facts.filter((f) => isExpired(f, today)).length;
  const soon = kit.facts.filter((f) => f.validTo && !isExpired(f, today) && Date.parse(f.validTo) - Date.parse(today) <= 30 * 86_400_000).length;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="min-w-0">
        {kit.facts.length === 0 ? (
          <Empty title="No facts yet.">A fact is a claim the brand can make, with its approved wording, an owner and the dates it holds.</Empty>
        ) : (
          <>
            <p className="mb-3 text-[14px] leading-[22px] text-muted">
              <span className="num text-ink">{kit.facts.length}</span> approved fact{kit.facts.length === 1 ? "" : "s"}.{" "}
              {expired ? <span className="text-neg-ink">{expired} expired. </span> : null}
              {soon ? <span className="text-warn-ink">{soon} expire within 30 days. </span> : null}
              {!expired && !soon ? "None expires within 30 days. " : null}
              Each bar runs from the day a fact became valid to the day it ends; the cream tick is today.
            </p>
            <div className="card p-3">
              <Table label="Claim Ledger facts" minWidth={640} className="tbl-pick">
                <thead>
                  <tr>
                    <th>Fact</th>
                    <th>Owner</th>
                    <th className="w-[190px]">Valid from, to today</th>
                    <th className="num">Valid to</th>
                  </tr>
                </thead>
                <tbody>
                  {kit.facts.map((f) => (
                    <tr key={f.id} data-selected={sel === f.id ? "" : undefined} onClick={() => setSel(f.id)} className="align-middle">
                      <td className="pr-3">
                        <button className="text-left" aria-current={sel === f.id ? "true" : undefined} onClick={(e) => (e.stopPropagation(), setSel(f.id))}>
                          <Code>{f.id}</Code> {f.statement}
                        </button>
                      </td>
                      <td className="pr-3 text-muted">{f.owner}</td>
                      <td className="pr-3">
                        <ValidityBar fact={f} today={today} />
                      </td>
                      <td className="num whitespace-nowrap">
                        {f.validTo ? (
                          <span className={isExpired(f, today) ? "pill bg-neg-bg text-neg-ink" : ""}>{isExpired(f, today) ? `Expired ${formatDate(f.validTo)}` : formatDate(f.validTo)}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
        {admin && (
          <button className="btn btn-secondary btn-sm mt-3" onClick={() => setSel("new")}>
            <Plus size={14} aria-hidden="true" /> Add fact
          </button>
        )}
      </div>
      {fact && <FactEditor key={`${adding ? "new" : fact.id}-${kit.updatedAt}`} fact={fact} isNew={adding} kit={kit} admin={admin} onDone={(id) => setSel(id)} />}
    </div>
  );
}

type FactErrors = Partial<Record<"statement" | "approvedWording" | "owner" | "validFrom" | "validTo" | "figures", string>>;

function FactEditor({ fact, isNew, kit, admin, onDone }: { fact: Fact; isNew: boolean; kit: BrandKit; admin: boolean; onDone: (id: string | null) => void }) {
  const confirm = useConfirm();
  const [f, setF] = useState(fact);
  const [keywords, setKeywords] = useState(fact.keywords.join(", "));
  const [figures, setFigures] = useState<{ value: string; unit: Unit }[]>(fact.quantities.map((q) => ({ value: String(q.value), unit: q.unit })));
  const [badDate, setBadDate] = useState<{ validFrom?: boolean; validTo?: boolean }>({});
  const [errors, setErrors] = useState<FactErrors>({});
  const owners = [...new Set(kit.facts.map((x) => x.owner).filter(Boolean))];
  const listId = `owners-${useId().replace(/:/g, "")}`;
  const set = (patch: Partial<Fact>) => setF((x) => ({ ...x, ...patch }));

  const check = (): FactErrors => {
    const e: FactErrors = {};
    if (!f.statement.trim()) e.statement = "Say what the fact is.";
    if (!f.approvedWording.trim()) e.approvedWording = "Give the approved wording, as a full sentence.";
    if (!f.owner.trim()) e.owner = "Name the team that owns this fact, so its expiry alert has someone to go to.";
    if (badDate.validFrom) e.validFrom = "That is not a date. Use the date picker, or write it like 2026-09-15.";
    if (badDate.validTo) e.validTo = "That is not a date. Use the date picker, or write it like 2027-03-31.";
    if (!e.validFrom && !e.validTo && f.validFrom && f.validTo && f.validTo < f.validFrom) e.validTo = `Valid to (${formatDate(f.validTo)}) is before valid from (${formatDate(f.validFrom)}).`;
    if (figures.some((q) => q.value.trim() === "" || !Number.isFinite(Number(q.value)))) e.figures = "Each figure needs a number.";
    return e;
  };

  const save = useAction(
    async () => {
      const found = check();
      setErrors(found);
      if (Object.keys(found).length) return null;
      const quantities: Quantity[] = figures.map((q) => ({ value: Number(q.value), unit: q.unit }));
      const next: Fact = {
        ...f,
        statement: f.statement.trim(),
        approvedWording: f.approvedWording.trim(),
        inlineWording: f.inlineWording.trim(),
        footnote: f.footnote?.trim() || undefined,
        owner: f.owner.trim(),
        source: f.source.trim(),
        keywords: commas(keywords),
        quantities,
      };
      await updateKit({ facts: isNew ? [...kit.facts, next] : kit.facts.map((x) => (x.id === next.id ? next : x)) }, `fact ${next.id}`);
      onDone(next.id);
      return next.id;
    },
    { errorPrefix: "Could not save the fact", success: (id) => (id ? `Saved ${id} to the draft.` : undefined) },
  );
  const remove = useAction(
    async () => {
      const yes = await confirm({ title: `Remove ${f.id}?`, body: "It leaves the draft Claim Ledger, so drafts stop being compared with it. Published rulebook versions keep it.", confirmLabel: "Remove fact", danger: true });
      if (!yes) return null;
      await updateKit({ facts: kit.facts.filter((x) => x.id !== f.id) }, `removed fact ${f.id}`);
      onDone(null);
      return f.id;
    },
    { errorPrefix: "Could not remove the fact", success: (id) => (id ? `Removed ${id}.` : undefined) },
  );
  const dis = !admin;

  return (
    <form
      aria-label={isNew ? "New fact" : `Fact ${f.id}`}
      noValidate
      className="min-w-0 space-y-4 rounded-[28px] bg-raised p-5 md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <h2 className="text-[16px] font-semibold">
        <Code>{f.id}</Code> {isNew ? "New fact" : admin ? "Edit fact" : "Fact"}
      </h2>
      <Field id="f-statement" label="Statement" multiline rows={2} value={f.statement} disabled={dis} onChange={(e) => set({ statement: e.target.value })} error={errors.statement} />
      <Field id="f-approvedWording" label="Approved wording" multiline rows={2} value={f.approvedWording} disabled={dis} onChange={(e) => set({ approvedWording: e.target.value })} error={errors.approvedWording} />
      <Field id="f-inlineWording" label="Short wording" hint="A short phrase that can replace a claim inside a sentence." value={f.inlineWording} disabled={dis} onChange={(e) => set({ inlineWording: e.target.value })} />
      <Field id="f-footnote" label="Footnote" value={f.footnote ?? ""} disabled={dis} onChange={(e) => set({ footnote: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Field id="f-owner" label="Owner" list={listId} value={f.owner} disabled={dis} onChange={(e) => set({ owner: e.target.value })} error={errors.owner} autoComplete="off" />
          <datalist id={listId}>
            {owners.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>
        <Select id="f-kind" label="Kind" value={f.kind} disabled={dis} onChange={(e) => set({ kind: e.target.value as FactKind })}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k[0].toUpperCase() + k.slice(1)}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="f-validFrom"
          label="Valid from"
          type="date"
          value={f.validFrom ?? ""}
          disabled={dis}
          onChange={(e) => (setBadDate({ ...badDate, validFrom: e.target.validity.badInput }), set({ validFrom: e.target.value || undefined }))}
          error={errors.validFrom}
        />
        <Field
          id="f-validTo"
          label="Valid to"
          type="date"
          value={f.validTo ?? ""}
          disabled={dis}
          onChange={(e) => (setBadDate({ ...badDate, validTo: e.target.validity.badInput }), set({ validTo: e.target.value || undefined }))}
          error={errors.validTo}
          hint="The owner is told 30, 14, 7 and 1 days before this date, and on it."
        />
      </div>
      <Field id="f-source" label="Source" value={f.source} disabled={dis} onChange={(e) => set({ source: e.target.value })} />
      <Field id="f-keywords" label="Keywords (comma-separated)" hint="Words a draft is likely to use about this fact." value={keywords} disabled={dis} onChange={(e) => setKeywords(e.target.value)} />
      <Field id="f-trig" label="Phrases that make this claim (one per line)" multiline rows={3} value={f.triggers.join("\n")} disabled={dis} onChange={(e) => set({ triggers: lines(e.target.value) })} />

      <fieldset className="min-w-0">
        <legend className="text-[14px] font-medium">Figures compared in code</legend>
        <p className="mt-1 text-[13px] leading-5 text-muted">A draft that gives a different number for the same thing is flagged.</p>
        <ul className="mt-2 space-y-2">
          {figures.map((q, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
              <Field label={`Figure ${i + 1} value`} hideLabel type="number" step="any" value={q.value} disabled={dis} onChange={(e) => setFigures(figures.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <Select label={`Figure ${i + 1} unit`} hideLabel value={q.unit} disabled={dis} onChange={(e) => setFigures(figures.map((x, j) => (j === i ? { ...x, unit: e.target.value as Unit } : x)))}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
              {admin && (
                <button type="button" className="btn btn-ghost h-10 w-10 !px-0 text-neg-ink" aria-label={`Remove figure ${i + 1}`} onClick={() => setFigures(figures.filter((_, j) => j !== i))}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {errors.figures && (
          <p role="alert" className="mt-2 text-[13px] text-neg-ink">
            {errors.figures}
          </p>
        )}
        {admin && (
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setFigures([...figures, { value: "", unit: "percent" }])}>
            <Plus size={14} aria-hidden="true" /> Add a figure
          </button>
        )}
      </fieldset>

      {admin && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-inverse btn-sm" type="submit" disabled={save.busy}>
            {isNew ? "Add fact" : "Save to draft"}
          </button>
          {isNew ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => onDone(kit.facts[0]?.id ?? null)}>
              Cancel
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm text-neg-ink" type="button" disabled={remove.busy} onClick={() => remove.run()}>
              <Trash2 size={14} aria-hidden="true" /> Remove
            </button>
          )}
        </div>
      )}
    </form>
  );
}
