"use client";

// The labelling page: a person who is not technical reads one draft at a time and ticks the brand rules it
// breaks, on a phone. It is deliberately a world of its own: no app shell, no link into the app, and nothing
// imported from the engine or the store, so a labeller cannot see how Assay judged a draft and stays blind.
// It shows the manifest's words only (no labels, no notes, no code patterns). Answers go to /api/label one at
// a time as the person moves on, are always kept on the device too, and can be downloaded when the server
// can't take them.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ArrowRight, Check, Download, RotateCw } from "lucide-react";
import { BATCH, pickBatch } from "./label-batch";

// ---- What the manifest holds -------------------------------------------------------

interface LabelRule {
  id: string;
  title: string;
  text: string;
  category: string;
  /** Empty means every channel. */
  channels: string[];
  yes?: string;
  no?: string;
}
interface Limits {
  maxEmoji: number;
  maxExclamation: number;
  maxCapsWords: number;
  readabilityMin: number;
}
interface Item {
  id: string;
  channel: string;
  text: string;
}
interface Manifest {
  note: string;
  rules: LabelRule[];
  facts: { wording: string; footnote?: string; validTo?: string }[];
  today: string;
  limits: Record<string, Limits>;
  practice: { text: string; channel: string; answer: string[]; why: string }[];
  items: Item[];
}

const STORE = "assay-label:v1";

const CHANNEL: Record<string, string> = { instagram: "Instagram post", email: "Email", website: "Website copy", linkedin: "LinkedIn post", brochure: "Brochure" };
/** The channel as a noun in a sentence: "this LinkedIn post", "this email". */
const NOUN: Record<string, string> = { instagram: "Instagram post", email: "email", website: "website copy", linkedin: "LinkedIn post", brochure: "brochure" };
const CATEGORY: Record<string, string> = { tone: "Tone of voice", message: "Messaging", term: "Words to use and avoid", claim: "Claims and promises", legal: "Legal lines", accessibility: "Accessibility", visual: "Look" };

// ---- What is kept on the device ----------------------------------------------------

interface Answer {
  ruleIds: string[];
  ms: number;
  /** The server has it. */
  saved: boolean;
}
interface Stored {
  coder: string;
  practiceDone: boolean;
  stage: "intro" | "practice" | "batch" | "done";
  practiceAt: number;
  batch: string[];
  index: number;
  answers: Record<string, Answer>;
  /** The ticks on drafts not yet answered, so a reload, a lock screen or a step back loses nothing. */
  tick: Record<string, { ruleIds: string[]; none: boolean }>;
}

const newCode = () => {
  const bytes = new Uint8Array(9);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return "c" + [...bytes].map((b) => (b % 36).toString(36)).join("");
};

const fresh = (): Stored => ({ coder: newCode(), practiceDone: false, stage: "intro", practiceAt: 0, batch: [], index: 0, answers: {}, tick: {} });

function load(): Stored {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Stored>;
      if (s && typeof s.coder === "string" && /^[a-z0-9-]{4,40}$/.test(s.coder)) return { ...fresh(), ...s, tick: s.tick && !("key" in s.tick) ? s.tick : {} } as Stored;
    }
  } catch {
    // Storage blocked or damaged: start again with a new code.
  }
  return fresh();
}

function store(s: Stored) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // Without storage the page still works for this visit.
  }
}

// ---- The server --------------------------------------------------------------------

interface Progress {
  enabled: boolean;
  counts: Record<string, number>;
  mine: string[];
}

async function getProgress(coder: string): Promise<Progress> {
  try {
    const r = await fetch(`/api/label?coder=${encodeURIComponent(coder)}`, { cache: "no-store" });
    if (!r.ok) return { enabled: false, counts: {}, mine: [] };
    const j = (await r.json()) as Partial<Progress>;
    return { enabled: !!j.enabled, counts: j.counts ?? {}, mine: j.mine ?? [] };
  } catch {
    return { enabled: false, counts: {}, mine: [] };
  }
}

type Posted = { ok: true } | { ok: false; off: boolean; message: string };

async function post(coder: string, itemId: string, a: Answer): Promise<Posted> {
  try {
    const r = await fetch("/api/label", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coder, itemId, ruleIds: a.ruleIds, ms: Math.min(Math.max(0, Math.round(a.ms)), 3_600_000) }) });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { reason?: string; message?: string };
    return { ok: false, off: j.reason === "off", message: j.message ?? "That answer was not saved." };
  } catch {
    return { ok: false, off: false, message: "No connection." };
  }
}

// ---- The page ----------------------------------------------------------------------

type Net = "idle" | "saving" | "saved" | "failed" | "local";

export function LabelApp() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [problem, setProblem] = useState(false);
  const [s, setS] = useState<Stored | null>(null);
  const [server, setServer] = useState<Progress | null>(null);
  const [inflight, setInflight] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [starting, setStarting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lastScreen = useRef("");

  // Open: what is kept here, the drafts and rules, and how far this person already is on the server.
  useEffect(() => {
    let live = true;
    const kept = load();
    Promise.all([fetch("/label/manifest.json").then((r) => (r.ok ? (r.json() as Promise<Manifest>) : Promise.reject(new Error("manifest")))), getProgress(kept.coder)])
      .then(([m, p]) => {
        if (!live) return;
        setManifest(m);
        setServer(p);
        setOff(!p.enabled);
        setS(kept);
        setProblem(false);
      })
      .catch(() => live && setProblem(true));
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (s) store(s);
  }, [s]);

  // A new screen starts at the top, with its heading read out.
  const heading = useRef<HTMLHeadingElement>(null);
  const screenKey = s ? `${s.stage}:${s.index}:${s.practiceAt}` : "";
  useEffect(() => {
    const was = lastScreen.current;
    lastScreen.current = screenKey;
    // Not on the first screen the page opens with, only when a later one replaces it.
    if (!was || was === screenKey) return;
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [screenKey]);

  if (problem) {
    return (
      <Frame>
        <h1 className="font-display text-[28px] font-medium leading-9 tracking-[-0.02em]">The drafts did not load</h1>
        <p className="mt-3 text-[17px] leading-7 text-muted">Check your connection, then try again. Nothing you did before has been lost.</p>
        <button className="btn btn-inverse mt-6 h-12 px-6 text-[16px]" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </Frame>
    );
  }
  if (!manifest || !s) {
    return (
      <Frame>
        <p role="status" className="text-[17px] text-muted">
          Opening the drafts…
        </p>
      </Frame>
    );
  }

  const done = new Set([...(server?.mine ?? []), ...Object.keys(s.answers)]);
  const update = (patch: Partial<Stored> | ((x: Stored) => Partial<Stored>)) => setS((x) => (x ? { ...x, ...(typeof patch === "function" ? patch(x) : patch) } : x));

  const unsaved = Object.entries(s.answers).filter(([, a]) => !a.saved);
  const net: Net = off ? (Object.keys(s.answers).length ? "local" : "idle") : inflight > 0 ? "saving" : unsaved.length ? "failed" : Object.keys(s.answers).length ? "saved" : "idle";

  const send = async (itemId: string, a: Answer) => {
    if (off) return;
    setInflight((n) => n + 1);
    const r = await post(s.coder, itemId, a);
    setInflight((n) => n - 1);
    if (r.ok) {
      setReason(null);
      // A newer answer to the same draft may have been given meanwhile: only mark this one as saved if it is still the latest.
      setS((x) => (x && x.answers[itemId] && x.answers[itemId].ruleIds.join() === a.ruleIds.join() ? { ...x, answers: { ...x.answers, [itemId]: { ...x.answers[itemId], saved: true } } } : x));
    } else {
      setReason(r.message);
      if (r.off) setOff(true);
    }
  };

  const retry = async () => {
    for (const [id, a] of unsaved) await send(id, a);
  };

  const download = () => {
    const body = {
      coder: s.coder,
      note: "Anonymous answers from the labelling page. Each draft is listed by its opaque id with the ids of the rules the person ticked; an empty list means they chose that it breaks none.",
      exportedAt: new Date().toISOString(),
      answers: Object.entries(s.answers).map(([itemId, a]) => ({ itemId, ruleIds: a.ruleIds, ms: Math.round(a.ms), savedToServer: a.saved })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `my-answers-${s.coder}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const startBatch = async () => {
    setStarting(true);
    const p = await getProgress(s.coder);
    setServer(p);
    setOff(!p.enabled);
    const taken = new Set([...p.mine, ...Object.keys(s.answers)]);
    const batch = pickBatch(manifest.items, p.counts, taken);
    setStarting(false);
    update(batch.length ? { stage: "batch", batch, index: 0 } : { stage: "done", batch: [] });
  };

  const total = manifest.items.length;
  const shared = { net, reason, unsavedCount: unsaved.length, onRetry: retry, off, busy: starting };

  if (s.stage === "intro") {
    return (
      <Frame>
        <h1 ref={heading} tabIndex={-1} className="font-display text-[30px] font-medium leading-[38px] tracking-[-0.02em] !outline-none sm:text-[38px] sm:leading-[46px]">
          Help check some marketing drafts
        </h1>
        <p className="mt-4 max-w-[560px] text-[18px] leading-8">
          You will read short drafts written for a brand, and tick which of the brand&apos;s rules each one breaks. Answer from what you read and what you think, not from what you guess we expect: there is no trick.
        </p>
        <ul className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            ["About 30 seconds", "for each draft"],
            [`${BATCH} at a time`, "then you can stop or go on"],
            ["Anonymous", "no name, no email"],
          ].map(([big, small], i) => (
            <li key={big} className="enter-rise rounded-[24px] bg-raised px-5 py-4" style={{ animationDelay: `${i * 70}ms` }}>
              <p className="font-display text-[22px] font-medium leading-7 tracking-[-0.015em]">{big}</p>
              <p className="mt-0.5 text-[15px] text-muted">{small}</p>
            </li>
          ))}
        </ul>
        <div className="mt-7 max-w-[600px] space-y-3 text-[16px] leading-7 text-muted">
          <p>
            The brand is fictional. Nothing here is real advertising, and no real product or person is being judged. {manifest.note.replace(/^Fictional brand\.\s*/, "")}
          </p>
          <p>
            Your answers are anonymous. You are never asked who you are: this browser makes up a random code, <span className="font-mono text-[15px] text-ink">{s.coder}</span>, and the answers are stored under it.
            {done.size > 0 ? ` You have already done ${done.size} of ${total} drafts.` : ""}
          </p>
          {off && <p className="text-ink">Saving to our server is not available right now. Your answers stay on this phone, and at the end you can download them.</p>}
        </div>
        <button
          className="btn btn-inverse mt-8 h-12 px-7 text-[16px]"
          disabled={starting}
          onClick={() => (s.practiceDone ? startBatch() : update({ stage: "practice", practiceAt: 0 }))}
        >
          {s.practiceDone ? `Start ${BATCH} drafts` : "Try two practice drafts"} <ArrowRight size={18} aria-hidden="true" />
        </button>
      </Frame>
    );
  }

  if (s.stage === "practice") {
    const p = manifest.practice[s.practiceAt];
    if (!p) {
      return (
        <Frame>
          <h1 ref={heading} tabIndex={-1} className="font-display text-[28px] font-medium leading-9 !outline-none">
            Practice is done
          </h1>
          <button className="btn btn-inverse mt-6 h-12 px-6 text-[16px]" disabled={starting} onClick={startBatch}>
            Start the {BATCH} drafts <ArrowRight size={18} aria-hidden="true" />
          </button>
        </Frame>
      );
    }
    const last = s.practiceAt === manifest.practice.length - 1;
    return (
      <ItemScreen
        key={`practice-${s.practiceAt}`}
        manifest={manifest}
        item={{ id: `practice-${s.practiceAt}`, channel: p.channel, text: p.text }}
        label={`Practice ${s.practiceAt + 1} of ${manifest.practice.length}`}
        headingRef={heading}
        initial={{ ruleIds: [], none: false }}
        practice={{ answer: p.answer, why: p.why }}
        nextLabel={last ? `Start the ${BATCH} drafts` : "Next practice draft"}
        progress={(s.practiceAt + 1) / manifest.practice.length}
        {...shared}
        onTick={() => {}}
        onNext={() => (last ? (update({ practiceDone: true }), void startBatch()) : update({ practiceAt: s.practiceAt + 1 }))}
        onBack={s.practiceAt > 0 ? () => update({ practiceAt: s.practiceAt - 1 }) : undefined}
      />
    );
  }

  if (s.stage === "batch") {
    const id = s.batch[s.index];
    const item = manifest.items.find((x) => x.id === id);
    if (!item) {
      return (
        <Frame>
          <h1 ref={heading} tabIndex={-1} className="font-display text-[28px] font-medium leading-9 !outline-none">
            That set is finished
          </h1>
          <button className="btn btn-inverse mt-6 h-12 px-6 text-[16px]" disabled={starting} onClick={startBatch}>
            Find the next drafts <ArrowRight size={18} aria-hidden="true" />
          </button>
        </Frame>
      );
    }
    const mine = s.answers[id];
    const initial = s.tick[id] ?? (mine ? { ruleIds: mine.ruleIds, none: mine.ruleIds.length === 0 } : { ruleIds: [], none: false });
    const lastOne = s.index === s.batch.length - 1;
    return (
      <ItemScreen
        key={id}
        manifest={manifest}
        item={item}
        label={`Draft ${s.index + 1} of ${s.batch.length}`}
        headingRef={heading}
        initial={initial}
        nextLabel={lastOne ? "Finish" : "Next"}
        progress={(s.index + 1) / s.batch.length}
        {...shared}
        onTick={(ruleIds, none) => update((x) => ({ tick: { ...x.tick, [id]: { ruleIds, none } } }))}
        onNext={(ruleIds, ms) => {
          const answer: Answer = { ruleIds, ms, saved: false };
          update((x) => {
            const { [id]: _taken, ...tick } = x.tick;
            return { answers: { ...x.answers, [id]: answer }, tick, ...(lastOne ? { stage: "done" as const } : { index: x.index + 1 }) };
          });
          void send(id, answer);
        }}
        onBack={s.index > 0 ? () => update((x) => ({ index: x.index - 1 })) : undefined}
      />
    );
  }

  // Done.
  const remaining = total - done.size;
  return (
    <Frame>
      <h1 ref={heading} tabIndex={-1} className="font-display text-[30px] font-medium leading-[38px] tracking-[-0.02em] !outline-none sm:text-[38px] sm:leading-[46px]">
        Thank you
      </h1>
      <p className="mt-4 max-w-[560px] text-[18px] leading-8">
        {s.batch.length > 0 ? `That is ${s.batch.length} drafts read and answered.` : "You have answered every draft there is."} Your own judgement is what makes this useful.
        {done.size > 0 ? ` You have now done ${done.size} of ${total}.` : ""}
      </p>
      <ul className="mt-6 grid max-w-[560px] gap-3 sm:grid-cols-2">
        <li className="rounded-[24px] bg-raised px-5 py-4">
          <p className="font-display text-[26px] font-medium leading-8 tracking-[-0.015em]">{s.batch.length}</p>
          <p className="text-[15px] text-muted">drafts in this set</p>
        </li>
        <li className="rounded-[24px] bg-raised px-5 py-4">
          <p className="font-display text-[26px] font-medium leading-8 tracking-[-0.015em]">
            {done.size} <span className="text-[17px] text-muted">of {total}</span>
          </p>
          <p className="text-[15px] text-muted">drafts you have done in all</p>
        </li>
      </ul>
      <div className="mt-5 max-w-[560px]">
        <SaveNote {...shared} always />
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {remaining > 0 && (
          <button className="btn btn-inverse h-12 px-7 text-[16px]" disabled={starting} onClick={startBatch}>
            {starting ? "Finding more…" : `Do another ${Math.min(BATCH, remaining)}`} <ArrowRight size={18} aria-hidden="true" />
          </button>
        )}
        {(net === "failed" || net === "local" || Object.keys(s.answers).length > 0) && (
          <button className="btn btn-secondary h-12 px-6 text-[16px]" onClick={download}>
            <Download size={18} aria-hidden="true" /> Download my answers
          </button>
        )}
      </div>
      <p className="mt-6 max-w-[560px] text-[15px] leading-6 text-muted">You can close this page now. Your answers are anonymous, and nothing here links to who you are.</p>
    </Frame>
  );
}

// ---- Pieces ------------------------------------------------------------------------

/** The page's frame: one centred column on the dark ground, no navigation, nothing that leads anywhere else. */
function Frame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="theme-night min-h-dvh bg-chrome text-ink">
      <main id="main" className={`mx-auto w-full px-4 pb-16 pt-8 sm:px-8 sm:pt-12 ${wide ? "max-w-[1120px]" : "max-w-[720px]"}`}>
        {children}
      </main>
    </div>
  );
}

interface NetProps {
  net: Net;
  reason: string | null;
  unsavedCount: number;
  onRetry: () => void;
  off: boolean;
  /** Another set of drafts is being found, so Next waits. */
  busy?: boolean;
}

/** Whether the answers have reached the server, said in words and never by colour alone. */
function SaveNote({ net, reason, unsavedCount, onRetry, off, always }: NetProps & { always?: boolean }) {
  if (net === "idle" && !always) return null;
  return (
    <div role="status" className="text-[15px] leading-6">
      {net === "saving" && <p className="text-muted">Saving…</p>}
      {net === "saved" && (
        <p className="flex items-center gap-1.5 text-pos-ink">
          <Check size={16} aria-hidden="true" strokeWidth={2.6} /> Saved
        </p>
      )}
      {net === "local" && <p className="text-muted">{off ? "Answers are kept on this phone. Download them at the end." : "Answers are kept on this phone."}</p>}
      {net === "failed" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-neg-ink">
          <span>
            {unsavedCount} answer{unsavedCount === 1 ? " is" : "s are"} not saved yet{reason ? `: ${reason}` : ""}
          </span>
          <button className="btn btn-secondary h-11 px-4 text-[15px]" onClick={onRetry}>
            <RotateCw size={16} aria-hidden="true" /> Retry
          </button>
        </div>
      )}
      {net === "idle" && always && <p className="text-muted">Nothing to save.</p>}
    </div>
  );
}

const dateWords = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function limitsText(l: Limits): string[] {
  const upTo = (n: number, one: string, many: string) => (n === 0 ? `No ${many}` : `Up to ${n} ${n === 1 ? one : many}`);
  return [upTo(l.maxEmoji, "emoji", "emoji"), upTo(l.maxExclamation, "exclamation mark", "exclamation marks"), upTo(l.maxCapsWords, "ALL-CAPS word", "ALL-CAPS words"), `Reading ease of at least ${l.readabilityMin} (higher is easier)`];
}

function ItemScreen({
  manifest,
  item,
  label,
  headingRef,
  initial,
  practice,
  nextLabel,
  progress,
  net,
  reason,
  unsavedCount,
  onRetry,
  off,
  busy,
  onTick,
  onNext,
  onBack,
}: {
  manifest: Manifest;
  item: Item;
  label: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  initial: { ruleIds: string[]; none: boolean };
  practice?: { answer: string[]; why: string };
  nextLabel: string;
  progress: number;
  onTick: (ruleIds: string[], none: boolean) => void;
  onNext: (ruleIds: string[], ms: number) => void;
  onBack?: () => void;
} & NetProps) {
  const [ticks, setTicks] = useState<string[]>(initial.ruleIds);
  const [none, setNone] = useState(initial.none);
  const [checked, setChecked] = useState(false);
  const [examples, setExamples] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  const rules = manifest.rules.filter((r) => r.channels.length === 0 || r.channels.includes(item.channel));
  const groups = [...new Set(rules.map((r) => r.category))].map((c) => ({ category: c, rules: rules.filter((r) => r.category === c) }));
  const answered = none || ticks.length > 0;
  const limits = manifest.limits[item.channel];
  const channel = CHANNEL[item.channel] ?? item.channel;
  const noun = NOUN[item.channel] ?? item.channel;

  const tick = (id: string, on: boolean) => {
    const next = on ? [...ticks, id] : ticks.filter((x) => x !== id);
    setTicks(next);
    setNone(false);
    onTick(next, false);
  };
  const chooseNone = (on: boolean) => {
    setNone(on);
    if (on) setTicks([]);
    onTick(on ? [] : ticks, on);
  };

  const titleOf = (id: string) => manifest.rules.find((r) => r.id === id)?.title ?? id;
  const sameAsAnswer = practice && practice.answer.length === ticks.length && practice.answer.every((a) => ticks.includes(a));

  return (
    <Frame wide>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-[17px] font-semibold !outline-none">
          {label}
        </h1>
        <SaveNote net={net} reason={reason} unsavedCount={unsavedCount} onRetry={onRetry} off={off} />
      </header>
      <div role="progressbar" aria-label="Progress through this set" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="mt-3 h-2 rounded-full bg-field">
        <div className="h-2 rounded-full bg-gold-mark transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="mt-6 gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
        <section aria-labelledby="draft-h" className="lg:sticky lg:top-6 lg:self-start">
          <div className="flex items-center gap-2">
            <h2 id="draft-h" className="text-[15px] text-muted">
              The draft
            </h2>
            <span className="pill h-7 bg-neutral-bg px-3 text-[13.5px] text-neutral-ink">{channel}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap rounded-[28px] bg-sheet px-6 py-6 font-display text-[22px] leading-[1.55] tracking-[-0.005em] sm:text-[24px]">{item.text}</p>

          <div className="mt-4 space-y-2.5">
            <details className="group rounded-[22px] bg-raised">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                The brand&apos;s approved facts
                <span aria-hidden="true" className="text-[20px] leading-none text-muted transition-transform duration-300 group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="px-5 pb-4">
                <p className="text-[14px] leading-5 text-muted">A claim in a draft should match one of these.</p>
                <ul className="mt-3 space-y-3">
                  {manifest.facts.map((f, i) => (
                    <li key={i} className="text-[15px] leading-6">
                      {f.wording}
                      {f.footnote && <span className="block text-[13.5px] text-muted">{f.footnote}</span>}
                      {f.validTo && <span className="block text-[13.5px] text-muted">{f.validTo < manifest.today ? `Expired ${dateWords(f.validTo)}` : `Valid to ${dateWords(f.validTo)}`}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </details>
            {limits && (
              <details className="group rounded-[22px] bg-raised">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                  Limits for {noun}
                  <span aria-hidden="true" className="text-[20px] leading-none text-muted transition-transform duration-300 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <ul className="space-y-1.5 px-5 pb-4 text-[15px] leading-6">
                  {limitsText(limits).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>

        <fieldset className="mt-8 min-w-0 lg:mt-0">
          <legend className="text-[19px] font-semibold leading-7">Which of these rules does it break?</legend>
          <p className="mt-1 text-[15px] leading-6 text-muted">Tick every one that applies to this {noun}. These are the rules that apply to it.</p>
          {rules.some((r) => r.yes || r.no) && (
            <button type="button" className="btn btn-ghost mt-2 -ml-3 h-11 px-3 text-[15px]" aria-pressed={examples} onClick={() => setExamples((x) => !x)}>
              {examples ? "Hide the examples" : "Show an example for each rule"}
            </button>
          )}
          <div className="mt-3 space-y-6">
            {groups.map((g) => (
              <div key={g.category} role="group" aria-labelledby={`g-${g.category}`}>
                <h3 id={`g-${g.category}`} className="text-[15px] font-medium text-muted">
                  {CATEGORY[g.category] ?? g.category}
                </h3>
                <ul className="mt-2 space-y-2">
                  {g.rules.map((r) => (
                    <li key={r.id}>
                      <label className="flex min-h-14 cursor-pointer items-start gap-4 rounded-[22px] bg-raised px-4 py-3.5 transition-colors duration-200 hover:bg-active has-checked:bg-active">
                        <input type="checkbox" className="mt-0.5 h-6 w-6 flex-none accent-gold-mark" checked={ticks.includes(r.id)} onChange={(e) => tick(r.id, e.target.checked)} />
                        <span className="min-w-0">
                          <span className="block text-[16.5px] font-medium leading-6">{r.title}</span>
                          <span className="mt-0.5 block text-[15px] leading-6 text-muted">{r.text}</span>
                          {examples && (r.yes || r.no) && (
                            <span className="mt-2 block space-y-1 text-[14px] leading-5">
                              {r.no && (
                                <span className="block">
                                  <span className="text-muted">Breaks it: </span>“{r.no}”
                                </span>
                              )}
                              {r.yes && (
                                <span className="block">
                                  <span className="text-muted">Follows it: </span>“{r.yes}”
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <label className="flex min-h-14 cursor-pointer items-start gap-4 rounded-[22px] border-2 border-dashed border-control px-4 py-3.5 transition-colors duration-200 hover:bg-raised has-checked:border-solid has-checked:border-transparent has-checked:bg-active">
              <input type="checkbox" className="mt-0.5 h-6 w-6 flex-none accent-gold-mark" checked={none} onChange={(e) => chooseNone(e.target.checked)} />
              <span>
                <span className="block text-[16.5px] font-medium leading-6">Breaks none of these</span>
                <span className="mt-0.5 block text-[15px] leading-6 text-muted">Choose this if the draft follows every rule above.</span>
              </span>
            </label>
          </div>

          {practice && checked && (
            <div role="status" className="mt-6 rounded-[24px] bg-sheet px-5 py-4 text-[16px] leading-7" data-practice-feedback>
              <p className="font-semibold">{sameAsAnswer ? "That matches the answer." : "That is different from the answer."}</p>
              <p className="mt-1">
                The answer: {practice.answer.length ? practice.answer.map(titleOf).join("; ") : "it breaks none of the rules"}.
              </p>
              <p className="mt-1 text-muted">{practice.why}</p>
              <p className="mt-2 text-[14px] text-muted">Practice answers are not saved.</p>
            </div>
          )}
        </fieldset>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-chrome pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-8">
          <button className="btn btn-secondary h-12 px-5 text-[16px]" disabled={!onBack} onClick={onBack}>
            <ArrowLeft size={18} aria-hidden="true" /> Back
          </button>
          {!answered && <p className="order-first w-full text-[14px] leading-5 text-muted sm:order-none sm:w-auto sm:min-w-0 sm:flex-1 sm:text-[15px]">Tick a rule, or choose “Breaks none of these”.</p>}
          {answered && <span className="hidden flex-1 sm:block" />}
          <button
            className="btn btn-inverse h-12 px-7 text-[16px]"
            disabled={!answered || busy}
            onClick={() => {
              if (practice && !checked) return setChecked(true);
              onNext(ticks, Date.now() - shownAt.current);
            }}
          >
            {practice && !checked ? "Check my answer" : nextLabel} <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div aria-hidden="true" className="h-32" />
    </Frame>
  );
}
