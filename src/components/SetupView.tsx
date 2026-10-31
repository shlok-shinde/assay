"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { addBrand, listBrands, forgetBrand, switchBrand } from "@/store/brands";
import type { BrandKit } from "@/lib/types";
import { starterRules } from "@/seed/starter";
import { useKit } from "@/store/hooks";
import { TitleRow } from "./AppShell";
import { useDealIn } from "./motion";
import { JUST_ADDED, useBrand } from "./BrandSwitcher";
import { Field, useAction, useConfirm } from "./primitives";
import { PageLoading } from "./ui";

interface Step {
  id: string;
  label: string;
  /** What is true now, from the kit itself. */
  state: string;
  done: boolean;
  href: string;
  cta: string;
}

/** The four things a new brand adds to the starter rules, each with whether it is done, read from the kit. */
export function setupSteps(kit: BrandKit): Step[] {
  const factsDated = kit.facts.filter((f) => f.validTo).length;
  const starter = starterRules();
  // The starter rules are only a start: this counts once one is reworded, one is removed or an own rule is added.
  const ownRule = kit.rules.some((r) => r.id.startsWith("CUSTOM-")) || starter.some((s) => JSON.stringify(kit.rules.find((r) => r.id === s.id)) !== JSON.stringify(s));
  return [
    { id: "words", label: "Words to use and avoid", state: kit.terms.length ? `${kit.terms.length} term${kit.terms.length === 1 ? "" : "s"}` : "No terms yet", done: kit.terms.length > 0, href: "/app/kit?tab=terms", cta: "Add words" },
    { id: "palette", label: "Brand colours", state: kit.palette.length ? `${kit.palette.length} colour${kit.palette.length === 1 ? "" : "s"}` : "No colours yet", done: kit.palette.length > 0, href: "/app/kit?tab=assets", cta: "Add colours" },
    {
      id: "facts",
      label: "Approved facts and who owns them",
      state: kit.facts.length ? `${kit.facts.length} fact${kit.facts.length === 1 ? "" : "s"}, ${factsDated} with an expiry date` : "No facts yet",
      done: kit.facts.length > 0,
      href: "/app/kit?tab=facts",
      cta: "Add facts",
    },
    {
      id: "rules",
      label: "Your own rules",
      state: ownRule ? `${kit.rules.length} rules, starter wording changed or your own added` : `${kit.rules.length} starter rules, none changed yet`,
      done: ownRule,
      href: "/app/kit?tab=rules",
      cta: "Edit rules",
    },
  ];
}

export function SetupView() {
  const brand = useBrand();
  const kit = useKit();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [, refresh] = useState(0);
  const steps = useRef<HTMLUListElement>(null);
  useDealIn(steps, ":scope > li", [!!brand && !!kit]);

  const create = useAction(
    async () => {
      const value = name.trim();
      if (!value) return setError("Give the brand a name.");
      if (value.length > 40) return setError("Keep the name to 40 characters or fewer.");
      if (listBrands().some((b) => b.name.toLowerCase() === value.toLowerCase())) return setError("A brand with that name already exists in this browser.");
      setError(undefined);
      const added = addBrand(value);
      try {
        window.sessionStorage.setItem(JUST_ADDED, added.id);
      } catch {
        // Without session storage the new brand still opens, on its drafts.
      }
      switchBrand(added.id);
    },
    { errorPrefix: "Could not add the brand" },
  );

  const forget = async (id: string, label: string) => {
    if (await confirm({ title: `Forget ${label}?`, body: `It leaves this list. Its drafts and rulebook stay in this browser's storage until you clear site data, and adding a brand with the same name brings them back.`, confirmLabel: "Forget brand", danger: true })) {
      forgetBrand(id);
      refresh((n) => n + 1);
    }
  };

  if (!brand || !kit) return <PageLoading label="Opening the brands…" />;
  const brands = listBrands();
  const list = brand.demo ? [] : setupSteps(kit);
  const done = list.filter((s) => s.done).length;

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        title={brand.demo ? "Add a brand" : `Set up ${kit.name}`}
        sub={
          brand.demo
            ? "Each brand has its own rulebook, facts, drafts and history in this browser, and none of it can reach another brand. Velvra stays exactly as it is."
            : `${kit.name} starts on Assay's starter rules and nothing else. Four things make it yours; each opens the Brand Kit on the right tab.`
        }
      />

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          {!brand.demo && (
            <section aria-labelledby="steps-h" className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="steps-h" className="text-[16px] font-semibold">
                  Checklist
                </h2>
                <p className="num text-[13px] text-muted">
                  {done} of {list.length} done
                </p>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-field" role="img" aria-label={`${done} of ${list.length} steps done`}>
                <div className="h-1.5 rounded-full bg-gold-mark transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${(done / list.length) * 100}%` }} />
              </div>
              <ul ref={steps} className="mt-4 space-y-2.5">
                {list.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-[18px] bg-raised px-4 py-3.5" data-step={s.id} data-done={s.done ? "" : undefined}>
                    <span
                      aria-hidden="true"
                      className={`flex h-6 w-6 flex-none items-center justify-center rounded-full ${s.done ? "bg-positive text-sheet" : "border-2 border-control"}`}
                    >
                      {s.done && <Check size={13} strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] font-medium">
                        {s.label}
                        <span className="sr-only">{s.done ? " (done)" : " (not done yet)"}</span>
                      </p>
                      <p className="text-[13px] text-muted">{s.state}</p>
                    </div>
                    <Link href={s.href} className={`btn btn-sm flex-none ${s.done ? "btn-secondary" : "btn-inverse"}`}>
                      {s.done ? "Review" : s.cta} <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[13px] leading-5 text-muted">Changes stay in the Brand Kit draft until a Brand Admin publishes them as a rulebook version.</p>
            </section>
          )}

          <section aria-labelledby="add-h" className="card p-5">
            <h2 id="add-h" className="text-[16px] font-semibold">
              Name the brand
            </h2>
            <p className="mt-1 text-[13.5px] leading-5 text-muted">Name it, and Assay opens it on the starter rules. You become its Brand Admin.</p>
            <form
              className="mt-4 max-w-[460px]"
              onSubmit={(e) => {
                e.preventDefault();
                void create.run();
              }}
            >
              <Field label="Brand name" value={name} maxLength={60} autoComplete="off" onChange={(e) => (setName(e.target.value), setError(undefined))} error={error} />
              <button className="btn btn-inverse btn-lg mt-4" type="submit" disabled={create.busy}>
                {create.busy ? "Adding…" : "Create brand and switch to it"}
              </button>
            </form>
          </section>
        </div>

        <div className="min-w-0 space-y-6">
        <aside aria-labelledby="brands-h" className="rounded-[20px] bg-raised p-5">
          <h2 id="brands-h" className="text-[15px] font-semibold">
            Brands in this browser
          </h2>
          <ul className="mt-3 space-y-1.5">
            {brands.map((b) => {
              const here = b.id === brand.id;
              return (
                <li key={b.id} className="flex items-center gap-2 rounded-[14px] bg-sheet px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[14px]">
                    {b.name}
                    {b.demo && <span className="text-muted"> · demo</span>}
                    {b.team && <span className="text-muted"> · team</span>}
                  </span>
                  {here ? (
                    <span className="pill bg-neutral-bg text-neutral-ink">Open now</span>
                  ) : (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => switchBrand(b.id)}>
                        Switch to {b.name}
                      </button>
                      {!b.demo && (
                        <button className="btn btn-ghost btn-sm text-neg-ink" onClick={() => forget(b.id, b.name)}>
                          Forget
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[13px] leading-5 text-muted">Switching reloads Assay onto that brand. Nothing is shared between brands.</p>
        </aside>
        <aside aria-labelledby="team-h" className="rounded-[20px] bg-raised p-5">
          <h2 id="team-h" className="text-[15px] font-semibold">
            Work with other people
          </h2>
          <p className="mt-1 text-[13.5px] leading-5 text-muted">
            A brand made here lives in this browser alone. A team workspace keeps its drafts and decisions on a server, so a creator, a reviewer and Compliance each sign in and see the same work.
          </p>
          <Link href="/team" className="btn btn-secondary btn-sm mt-3">
            Team workspaces <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </aside>
        </div>
      </div>
    </div>
  );
}
