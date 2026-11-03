"use client";

// Small shared pieces every screen builds on: a dialog and the confirm that replaces native confirm(),
// toasts, the guarded async action, form fields and tables, glossary terms, and the strip of marks a
// draft earns on its way to a Hallmark. Surfaces separate by a lightness step, gold stays on marks,
// and every move is transform and opacity through ./motion.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { ChevronDown, X } from "lucide-react";
import type { SubmissionStatus } from "@/lib/types";
import { Rise, strike } from "./motion";

const domId = (raw: string) => raw.replace(/:/g, "");

// ---- Dialog and confirm ---------------------------------------------------

/**
 * The native <dialog>'s open and close, shared by every modal here: showModal gives the focus trap, the
 * inert page behind it and Escape; focus goes back to whatever opened it (or to `returnTo`, for a browser
 * that does not focus a button on click). `open` is the source of truth, so a parent that ignores onClose
 * keeps it open. Mark the control that should take focus first with `data-autofocus`.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModal(open: boolean, onClose: () => void, returnTo?: HTMLElement | null) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const isOpen = useRef(open);

  useLayoutEffect(() => {
    isOpen.current = open;
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      d.showModal();
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && d.open) {
      d.close();
      if (opener.current?.isConnected) opener.current.focus();
    }
  }, [open, returnTo]);
  useEffect(
    () => () => {
      if (ref.current?.open) ref.current.close();
    },
    [],
  );

  return {
    ref,
    // Escape: the parent decides, so the state and the dialog never disagree.
    onCancel: (e: SyntheticEvent) => {
      e.preventDefault();
      onClose();
    },
    // A second Escape (or anything else that closes it natively) still reaches the parent.
    onClose: () => {
      if (isOpen.current) onClose();
    },
    // Only the scrim can be the target: the panel fills the dialog box.
    onClick: (e: ReactMouseEvent) => {
      if (e.target === ref.current) onClose();
    },
    // Tab goes round the dialog: past the last control it comes back to the first, and Shift+Tab the other way,
    // rather than leaving for the browser's own bar.
    onKeyDown: (e: ReactKeyboardEvent) => {
      const d = ref.current;
      if (e.key !== "Tab" || e.defaultPrevented || !d) return;
      const items = [...d.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === d)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    },
  };
}

/** A centred modal. `size="lg"` is for a decision that needs room to compare things side by side. */
export function Dialog({ open, onClose, title, children, actions, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; children?: ReactNode; actions?: ReactNode; size?: "md" | "lg" }) {
  const modal = useModal(open, onClose);
  const uid = domId(useId());

  return (
    <dialog
      {...modal}
      aria-labelledby={`${uid}-title`}
      aria-describedby={`${uid}-body`}
      className={`dialog m-auto max-h-[calc(100dvh-32px)] max-w-none overflow-y-auto rounded-[28px] bg-raised p-0 text-ink ${size === "lg" ? "w-[min(calc(100vw-24px),820px)]" : "w-[min(calc(100vw-32px),460px)]"}`}
    >
      {open && (
        <Rise from={{ y: 16, scale: 0.97 }} className="p-6 sm:p-7">
          <h2 id={`${uid}-title`} className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">
            {title}
          </h2>
          <div id={`${uid}-body`} className="mt-3 text-[14.5px] leading-6">
            {children}
          </div>
          {actions && (
            // A tall dialog scrolls; its actions stay in reach at the foot, on the dialog's own ground.
            <div className={`mt-6 flex flex-wrap justify-end gap-2 ${size === "lg" ? "sticky bottom-0 -mx-6 -mb-6 bg-raised px-6 pb-6 pt-3 sm:-mx-7 sm:-mb-7 sm:px-7 sm:pb-7" : ""}`}>{actions}</div>
          )}
        </Rise>
      )}
    </dialog>
  );
}

/**
 * A panel that slides in from the right edge (the whole screen on a phone), on the same native dialog:
 * the page behind goes inert, Tab stays inside, Escape and the scrim close it, and focus goes back to
 * `returnTo` or the control that opened it. Its content is laid out as a column that fills the height,
 * so a header can stay put while the body scrolls. It renders nothing inside until open, so a heavy
 * body (a PDF) starts only after the panel is on screen.
 */
export function Drawer({ open, onClose, label, children, returnTo }: { open: boolean; onClose: () => void; label: string; children?: ReactNode; returnTo?: HTMLElement | null }) {
  const modal = useModal(open, onClose, returnTo);
  return (
    <dialog {...modal} aria-label={label} className="dialog drawer text-ink">
      {open && (
        <Rise from={{ x: 56 }} className="flex h-full min-h-0 flex-col">
          {children}
        </Rise>
      )}
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive: the confirm button turns red and focus starts on Cancel. */
  danger?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);

/** `if (await confirm({ title, body, confirmLabel, danger })) …`: the dialog version of window.confirm. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm needs a ConfirmProvider above it.");
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const waiting = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean) => {
    const resolve = waiting.current;
    waiting.current = null;
    setOptions(null);
    resolve?.(answer);
  }, []);
  const confirm = useCallback<Confirm>(
    (next) =>
      new Promise<boolean>((resolve) => {
        // A second question while one is open answers the first with No.
        waiting.current?.(false);
        waiting.current = resolve;
        setOptions(next);
      }),
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!options}
        onClose={() => settle(false)}
        title={options?.title ?? ""}
        actions={
          options && (
            <>
              <button type="button" className="btn btn-ghost btn-lg" onClick={() => settle(false)} data-autofocus={options.danger ? "" : undefined}>
                {options.cancelLabel ?? "Cancel"}
              </button>
              <button type="button" className={`btn btn-lg ${options.danger ? "btn-danger" : "btn-inverse"}`} onClick={() => settle(true)} data-autofocus={options.danger ? undefined : ""}>
                {options.confirmLabel ?? "Confirm"}
              </button>
            </>
          )
        }
      >
        {options?.body}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

// ---- Toasts ---------------------------------------------------------------

export type ToastTone = "info" | "error" | "success";
type ToastRow = { id: number; message: string; tone: ToastTone };
type Toast = (message: string, options?: { tone?: ToastTone }) => void;

const ToastContext = createContext<Toast | null>(null);
const TOAST_MS = 6000;
const TOAST_MAX = 4;
const TONE_DOT: Record<ToastTone, string> = { info: "bg-gold-mark", success: "bg-positive", error: "bg-negative" };
const TONE_WORD: Record<ToastTone, string> = { info: "Note", success: "Done", error: "Error" };

/** `toast("Saved", { tone: "success" })`. Info and success go after about six seconds; an error stays until dismissed. */
export function useToast(): Toast {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast needs a ToastProvider above it.");
  return toast;
}

function ToastItem({ toast, onDismiss }: { toast: ToastRow; onDismiss: (id: number) => void }) {
  // The clock stops while the pointer or focus is on the toast, so it can be read and its button reached.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (toast.tone === "error" || held) return;
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, held, onDismiss]);
  return (
    <Rise from={{ y: 14 }} className="pointer-events-auto">
      <div
        className="float flex items-start gap-3 rounded-[20px] bg-active py-3 pl-4 pr-2 text-[14px] leading-5"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        <span className={`mt-[6px] h-2 w-2 flex-none rounded-full ${TONE_DOT[toast.tone]}`} aria-hidden="true" />
        <p className="min-w-0 flex-1 break-words py-0.5">
          <span className="sr-only">{TONE_WORD[toast.tone]}: </span>
          {toast.message}
        </p>
        <button type="button" className="btn btn-ghost h-8 w-8 flex-none !px-0 text-muted" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </Rise>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<ToastRow[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((rowId: number) => setRows((all) => all.filter((r) => r.id !== rowId)), []);
  const toast = useCallback<Toast>((message, options) => {
    const row: ToastRow = { id: next.current++, message, tone: options?.tone ?? "info" };
    setRows((all) => [...all, row].slice(-TOAST_MAX));
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* The region is always there, so a screen reader is already listening when a toast arrives. */}
      <div
        role="status"
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-stretch gap-2 pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:right-4 sm:w-[380px] print:hidden"
      >
        {rows.map((r) => (
          <ToastItem key={r.id} toast={r} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---- Guarded actions ------------------------------------------------------

/**
 * Wraps an async action: a second call while one is running does nothing (a double click runs once),
 * a failure is caught and shown in a toast and in `error`, and `busy` says one is in flight.
 * `run` resolves to the result, or undefined when the action failed or was skipped. `success` is the
 * toast for a good outcome (a function can return nothing to say none); `toastError: false` keeps an
 * error to `error` alone, for a screen that shows it in place.
 */
export function useAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  { success, errorPrefix, toastError = true }: { success?: string | ((result: R) => string | undefined); errorPrefix?: string; toastError?: boolean } = {},
) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const latest = useRef({ fn, success, errorPrefix, toastError });
  useEffect(() => {
    latest.current = { fn, success, errorPrefix, toastError };
  });

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await latest.current.fn(...args);
        const { success: ok } = latest.current;
        const said = typeof ok === "function" ? ok(result) : ok;
        if (said) toast(said, { tone: "success" });
        return result;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        const message = latest.current.errorPrefix ? `${latest.current.errorPrefix}: ${reason}` : reason;
        setError(message);
        if (latest.current.toastError) toast(message, { tone: "error" });
        return undefined;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [toast],
  );
  const clearError = useCallback(() => setError(null), []);
  return { run, busy, error, clearError };
}

// ---- Fields, select, table ------------------------------------------------

interface FieldChrome {
  label: ReactNode;
  hint?: ReactNode;
  /** Shown under the field in red and announced; the field is marked invalid. */
  error?: ReactNode;
  /** Keep the label for assistive tech only, when the surrounding layout already names the field. */
  hideLabel?: boolean;
}

type ControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

function FieldShell({ label, hint, error, hideLabel, id: given, children }: FieldChrome & { id?: string; children: (control: ControlProps) => ReactNode }) {
  const auto = domId(useId());
  const own = given ?? `f-${auto}`;
  const describedBy = [hint ? `${own}-hint` : null, error ? `${own}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={own} className={hideLabel ? "sr-only" : "block text-[14px] font-medium"}>
        {label}
      </label>
      <div className={hideLabel ? undefined : "mt-2"}>{children({ id: own, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}</div>
      {hint && (
        <p id={`${own}-hint`} className="mt-2 text-[13px] leading-5 text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${own}-error`} role="alert" className="mt-2 text-[13px] leading-5 text-neg-ink">
          {error}
        </p>
      )}
    </div>
  );
}

type FieldProps = FieldChrome & ({ multiline?: false } & Omit<ComponentProps<"input">, "children"> | { multiline: true } & Omit<ComponentProps<"textarea">, "children">);

/** A labelled input (or textarea, with `multiline`) on the app's .field style, its hint and error wired through aria-describedby. */
export function Field(props: FieldProps) {
  const { label, hint, error, hideLabel, multiline, className = "", id: given, ...rest } = props;
  return (
    <FieldShell label={label} hint={hint} error={error} hideLabel={hideLabel} id={given}>
      {(control) =>
        multiline ? (
          <textarea {...(rest as ComponentProps<"textarea">)} {...control} rows={(rest as ComponentProps<"textarea">).rows ?? 3} className={`field ${className}`} />
        ) : (
          <input {...(rest as ComponentProps<"input">)} {...control} className={`field ${className}`} />
        )
      }
    </FieldShell>
  );
}

/** A native select with the field's look: the platform's own picker, so it works with every keyboard and phone. */
export function Select({ label, hint, error, hideLabel, className = "", id: given, children, ...rest }: FieldChrome & Omit<ComponentProps<"select">, "children"> & { children: ReactNode }) {
  return (
    <FieldShell label={label} hint={hint} error={error} hideLabel={hideLabel} id={given}>
      {(control) => (
        <div className="relative">
          <select {...rest} {...control} className={`field appearance-none pr-10 ${className}`}>
            {children}
          </select>
          <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-faint" />
        </div>
      )}
    </FieldShell>
  );
}

/**
 * Rules and alignment, nothing else: a grey sentence-case header over a rule, a lighter rule between
 * rows, no zebra and no header fill. Give a cell `className="num"` to right-align a figure. With
 * `sticky` the header stays put inside a box of `maxHeight`. `label` names the table for assistive
 * tech and makes a table that scrolls sideways reachable by keyboard. `minWidth` is the width below
 * which it scrolls sideways instead of squeezing its columns (a phone).
 */
export function Table({ children, label, sticky, maxHeight = 420, minWidth, className = "" }: { children: ReactNode; label?: string; sticky?: boolean; maxHeight?: number | string; minWidth?: number; className?: string }) {
  return (
    <div
      className={`relative ${sticky ? "tbl-sticky" : "overflow-x-auto"} ${className}`}
      style={sticky ? { maxHeight } : undefined}
      {...(label ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
    >
      <table className="tbl" style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}

// ---- Glossary -------------------------------------------------------------

export type TermId = "claim-ledger" | "hallmark" | "intent-card" | "roles" | "delta-e" | "flesch" | "wcag";

/**
 * What each term means in this app, in plain words. One map, so a definition is never written twice.
 * Each opens with the everyday thing it is, because the first person to try Assay asked exactly that.
 */
export const GLOSSARY: Record<TermId, { term: string; body: string }> = {
  "claim-ledger": {
    term: "Claim Ledger",
    body: "The brand's list of product facts it is allowed to state, like “SPF 50” or “lasts 8 hours”. Each has its exact wording, an owner and the dates it is valid. Assay finds the claims in a draft (numbers, durations, SPF, “clinically proven”) and compares them with the ledger in code, not by AI. Each comes back supported, contradicted, outdated or unsupported, always naming the fact it was compared with.",
  },
  hallmark: {
    term: "Hallmark",
    body: "The approval stamp, made so it can't be quietly changed later. It is written when a reviewer approves a version, and holds a SHA-256 hash of the approved content and of the rulebook, how every finding ended, who approved, which AI models ran, and the hash of the previous Hallmark. Change any old record and every hash after it stops matching; Verify checks them in this browser.",
  },
  "intent-card": {
    term: "Intent Card",
    body: "Optional: what the post is for, in three lines (the goal, the key message and the call to action). With it, every fix is checked to still carry your key message and call to action, so a fix that satisfies a rule cannot quietly change what the post says. Leave it blank to just check the copy.",
  },
  roles: {
    term: "Roles",
    body: "In a real team these are different people. The Creator writes the post and fixes what Assay finds. Compliance (often legal or regulatory) approves or sends back product claims, like SPF or “clinically proven”. The Reviewer, usually the brand or marketing lead, gives the final approval. The Brand Admin keeps the rulebook and Claim Ledger up to date. In this demo you can be each of them: switch here.",
  },
  "delta-e": {
    term: "ΔE (delta E)",
    body: "A number for how different two colours look: 0 is identical and about 1 is barely visible. Assay uses the CIEDE2000 formula. A colour that fills a creative and sits more than ΔE 10 from every colour in the brand palette is flagged (rule VIS-01).",
  },
  flesch: {
    term: "Flesch reading ease",
    body: "A score for how easy copy is to read, from the length of its sentences and the syllables in its words. Higher is easier; plain English sits around 60 to 70. Each channel has a minimum, and copy of 60 words or more that falls under it is flagged (rule A11Y-03).",
  },
  wcag: {
    term: "WCAG",
    body: "The Web Content Accessibility Guidelines, the international standard for content people with low vision or other needs can use. Assay applies its text-contrast rule at level AA: at least 4.5 to 1 for normal text and 3 to 1 for large text, measured on the creative's own pixels (rule A11Y-01).",
  },
};

/**
 * A word with a dotted underline that opens its definition. The panel is a native popover, so
 * Escape and a click outside close it, it sits in the top layer (no scrolling box can clip it), and
 * the word is a real button: Tab to it, Enter or Space to open. The definition is in the page only
 * while the panel is open, so a closed one adds no hidden text for a search, a script or a reader to trip on.
 */
export function Term({ id: termId, children }: { id: TermId; children: ReactNode }) {
  const def = GLOSSARY[termId];
  const panelId = `term-${domId(useId())}`;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  // Fixed coordinates under the word, clamped to the screen; flipped above it when there is no room below.
  const place = useCallback((settled: boolean) => {
    const b = button.current;
    const p = panel.current;
    if (!b || !p) return;
    const r = b.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 32);
    p.style.width = `${width}px`;
    p.style.left = `${Math.min(Math.max(16, r.left), window.innerWidth - width - 16)}px`;
    p.style.top = `${r.bottom + 8}px`;
    if (settled && r.bottom + 8 + p.offsetHeight > window.innerHeight - 16 && r.top - 8 - p.offsetHeight > 16) p.style.top = `${r.top - 8 - p.offsetHeight}px`;
  }, []);
  // The definition arrives with the open state, so its height is only known after that render.
  useLayoutEffect(() => {
    if (open) place(true);
  }, [open, place]);

  // The panel is fixed, so it would drift from its word: close it when the page moves.
  useEffect(() => {
    if (!open) return;
    const close = () => panel.current?.hidePopover();
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button ref={button} type="button" className="term" popoverTarget={panelId} aria-expanded={open} aria-controls={panelId}>
        {children}
      </button>
      <span
        ref={panel}
        id={panelId}
        popover="auto"
        role="note"
        aria-label={def.term}
        className="term-panel"
        onBeforeToggle={(e) => e.newState === "open" && place(false)}
        onToggle={(e) => setOpen(e.newState === "open")}
      >
        {open && (
          <>
            <strong className="block text-[14px] font-semibold">{def.term}</strong>
            <span className="mt-1 block">{def.body}</span>
          </>
        )}
      </span>
    </>
  );
}

// ---- Marks ----------------------------------------------------------------

export interface MarkState {
  checked: boolean;
  fixed: boolean;
  cleared: boolean;
  hallmarked: boolean;
}

const MARKS = [
  { key: "checked", label: "Checked" },
  { key: "fixed", label: "Fixed" },
  { key: "cleared", label: "Cleared" },
  { key: "hallmarked", label: "Hallmarked" },
] as const satisfies readonly { key: keyof MarkState; label: string }[];

/**
 * Which marks a draft has earned, from what is actually stored. Checked: a check has run. Fixed: a
 * later version exists. Cleared: it is with the reviewer (or done) and no claim is still waiting on
 * Compliance, counting claims Compliance sent back. Hallmarked: a Hallmark was written for it.
 */
export function markStateOf(
  status: SubmissionStatus,
  { hasCheck, hasFixVersion, hasHallmark, openClaims }: { hasCheck: boolean; hasFixVersion: boolean; hasHallmark: boolean; openClaims: number },
): MarkState {
  return {
    checked: hasCheck,
    fixed: hasFixVersion,
    cleared: hasCheck && (status === "in_review" || status === "approved") && openClaims === 0,
    hallmarked: hasHallmark,
  };
}

const sentence = (words: string[], last: "and" | "or") => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`);

/** "Checked, fixed; not yet cleared or hallmarked": the strip said in words. */
export function markLabel(state: MarkState): string {
  const earned = MARKS.filter((m) => state[m.key]).map((m) => m.label.toLowerCase());
  const missing = MARKS.filter((m) => !state[m.key]).map((m) => m.label.toLowerCase());
  if (!earned.length) return `Not yet ${sentence(missing, "or")}`;
  const done = earned.length === MARKS.length ? sentence(earned, "and") : earned.join(", ");
  const text = missing.length ? `${done}; not yet ${sentence(missing, "or")}` : done;
  return text[0].toUpperCase() + text.slice(1);
}

// What each die has struck into it: a tick, a plus, a double tick and the brand's own A.
const GLYPH: Record<keyof MarkState, string> = {
  checked: "M7.5 12.5l3 3 6-6.5",
  fixed: "M12 7.5v9M7.5 12h9",
  cleared: "M5.5 12.5l3 3 5-5.5M11 15.5l.9.9 6.1-6.9",
  hallmarked: "M8 17l4-9 4 9M9.6 14h4.8",
};

function Die({ name, earned }: { name: keyof MarkState; earned: boolean }) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true" className="block">
      {earned ? (
        <>
          <circle cx="12" cy="12" r="11" fill="var(--color-gold-mark)" />
          <circle cx="12" cy="12" r="8.6" fill="none" stroke="var(--color-sheet)" strokeOpacity=".35" />
        </>
      ) : (
        <circle cx="12" cy="12" r="10.25" fill="none" stroke="var(--color-control)" strokeWidth="1.5" strokeDasharray="2.5 3" />
      )}
      <path d={GLYPH[name]} fill="none" stroke={earned ? "var(--color-sheet)" : "var(--color-control)"} strokeWidth={earned ? 2.2 : 1.6} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={earned ? 1 : 0.55} />
    </svg>
  );
}

/**
 * The marks a real hallmark carries, as four punched dies: empty until earned, then struck gold.
 * It is one image to assistive tech, with its state in words. With `animateNew`, a die that becomes
 * earned while the strip is on screen is struck in; dies already earned when it appears stay still.
 */
export function MarkStrip({ checked, fixed, cleared, hallmarked, animateNew }: MarkState & { animateNew?: boolean }) {
  const strip = useRef<HTMLSpanElement>(null);
  const before = useRef<MarkState | null>(null);
  const state: MarkState = { checked, fixed, cleared, hallmarked };

  useEffect(() => {
    const was = before.current;
    before.current = { checked, fixed, cleared, hallmarked };
    if (!animateNew || !was) return;
    for (const { key } of MARKS) if ({ checked, fixed, cleared, hallmarked }[key] && !was[key]) strike(strip.current?.querySelector(`[data-die="${key}"]`) ?? null, strip.current);
  }, [checked, fixed, cleared, hallmarked, animateNew]);

  return (
    <span ref={strip} role="img" aria-label={markLabel(state)} className="inline-flex flex-wrap items-center gap-x-5 gap-y-2">
      {MARKS.map(({ key, label }) => (
        <span key={key} className="inline-flex items-center gap-2 text-[12.5px] leading-5">
          <span data-die={key} className="block">
            <Die name={key} earned={state[key]} />
          </span>
          <span className={state[key] ? "font-medium text-ink" : "text-faint"} aria-hidden="true">
            {label}
          </span>
        </span>
      ))}
    </span>
  );
}
