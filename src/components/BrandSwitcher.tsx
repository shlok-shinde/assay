"use client";

// Which brand this browser is working on, and the way to change it. Each brand is its own database, so
// switching reloads the page onto the other one; nothing from one brand can show up in the other.
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronsUpDown, Plus, Users } from "lucide-react";
import { activeBrand, listBrands, switchBrand, type Brand } from "@/store/brands";

/** Set in session storage while a brand is being created, so the next screen can land on its set-up checklist. */
export const JUST_ADDED = "assay:just-added";

const quiet = () => () => {};

/**
 * The active brand, once the browser has said which it is. It is null while the page is being built on the
 * server and for the first paint on the client, so nothing brand-specific is ever drawn from a guess: a
 * screen waits for it, or draws a neutral frame, and nothing mismatches when it arrives.
 */
export function useBrand(): Brand | null {
  const id = useSyncExternalStore(quiet, () => activeBrand().id, () => null);
  return useMemo(() => (id ? (listBrands().find((b) => b.id === id) ?? null) : null), [id]);
}

/** The sidebar's brand card, opening a short list of the brands in this browser and the way to add one. */
export function BrandSwitcher({ brand, name, version, onNavigate }: { brand: Brand; name: string; version?: string; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = `brands-${useId().replace(/:/g, "")}`;
  const brands = open ? listBrands() : [];

  // Escape and a click anywhere else close it; focus goes back to the card.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={box} className="relative mt-3">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-[14px] border border-line bg-sheet px-3 py-2 text-left transition-colors hover:border-control"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{name}</span>
          <span className="block text-[12px] text-muted">
            {brand.demo ? `Rulebook v${version ?? "3.2"} · demo data in this browser` : brand.team ? `Rulebook v${version ?? "1.0"} · team workspace` : `Rulebook v${version ?? "1.0"} · stored in this browser`}
          </span>
          <span className="sr-only">Switch brand</span>
        </span>
        <ChevronsUpDown size={14} aria-hidden="true" className="flex-none text-faint" />
      </button>
      {open && (
        <div id={panel} role="group" aria-label="Brands in this browser" className="float absolute inset-x-0 top-[calc(100%+6px)] z-30 rounded-[18px] bg-raised p-1.5">
          <ul>
            {brands.map((b) => {
              const here = b.id === brand.id;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    aria-current={here ? "true" : undefined}
                    onClick={() => (here ? setOpen(false) : switchBrand(b.id))}
                    className="flex min-h-9 w-full items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-left text-[13.5px] transition-colors hover:bg-active"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {b.name}
                      {b.demo && <span className="text-muted"> · demo</span>}
                      {b.team && <span className="text-muted"> · team</span>}
                    </span>
                    {here && <Check size={14} aria-hidden="true" className="flex-none text-gold-mark" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <Link
            href="/app/setup"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="mt-1 flex min-h-9 items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-[13.5px] text-muted transition-colors hover:bg-active hover:text-ink"
          >
            <Plus size={14} aria-hidden="true" /> Add a brand
          </Link>
          <Link
            href="/team"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex min-h-9 items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-[13.5px] text-muted transition-colors hover:bg-active hover:text-ink"
          >
            <Users size={14} aria-hidden="true" /> Team workspaces
          </Link>
        </div>
      )}
    </div>
  );
}
