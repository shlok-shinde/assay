"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import type { Channel, ImageAsset, IntentCard, PageSpan, Version } from "@/lib/types";
import { CHANNELS } from "@/seed/velvra";
import { SAMPLES, type Sample } from "@/seed/samples";
import { ACCEPT, fetchAsFile, IntakeError, parseFile } from "@/lib/parse";
import { draftIntent } from "@/engine/fix";
import { aiTask } from "@/lib/ai-client";
import { checkVersion, createSubmission } from "@/store/actions";
import { useAiStatus, useKit } from "@/store/hooks";
import { TitleRow } from "./AppShell";
import { useBrand } from "./BrandSwitcher";
import { ImageMarker } from "./ImageMarker";
import { Term } from "./primitives";
import { Notice, Spinner } from "./ui";
import { useDealIn } from "./motion";

interface Draft {
  title: string;
  channel: Channel;
  audience: string;
  campaign: string;
  agency?: string;
  text: string;
  pages?: PageSpan[];
  image?: ImageAsset;
  source: Version["source"];
  sampleId?: string;
}

const EMPTY: Draft = { title: "", channel: "instagram", audience: "", campaign: "", text: "", source: { kind: "paste" } };
const EMPTY_INTENT: IntentCard = { goal: "", keyMessage: "", cta: "", confirmed: false, draftedBy: "creator" };

export function NewDraft() {
  const router = useRouter();
  const params = useSearchParams();
  const ai = useAiStatus();
  const kit = useKit();
  const brand = useBrand();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [intent, setIntent] = useState<IntentCard>(EMPTY_INTENT);
  const [busy, setBusy] = useState<string | null>(null);
  // Why the last file or sample could not be read, shown beside the upload button; and why the check failed, shown beside Run check.
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const autoloaded = useRef(false);
  const samples = useRef<HTMLUListElement>(null);
  useDealIn(samples, ":scope > li", []);

  const loadSample = async (s: Sample) => {
    setFileError(null);
    setBusy(`Loading “${s.title}”…`);
    try {
      let next: Draft = { ...EMPTY, title: s.title, channel: s.channel, audience: s.audience, campaign: s.campaign, agency: s.agency, text: s.text, sampleId: s.id, source: { kind: "paste" } };
      if (s.file) {
        const parsed = await parseFile(await fetchAsFile(s.file.path, s.file.name));
        next = { ...next, text: parsed.text, pages: parsed.pages, source: { kind: parsed.kind, fileName: s.file.name } };
      }
      if (s.image) {
        const parsed = await parseFile(await fetchAsFile(s.image.path, s.image.name));
        next = { ...next, image: { ...parsed.image!, alt: s.image.alt, logoBox: s.image.logoBox } };
      }
      setDraft(next);
      setIntent({ ...s.intent, confirmed: true, draftedBy: "creator" });
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const id = params.get("sample");
    const s = SAMPLES.find((x) => x.id === id);
    if (s && !autoloaded.current) {
      autoloaded.current = true;
      void loadSample(s);
    }
  }, [params]);

  // A file that cannot be read says why and changes nothing: the pasted copy, the title and the Intent Card stay as they were.
  const onFile = async (file: File) => {
    setFileError(null);
    setBusy(`Reading ${file.name}…`);
    try {
      const parsed = await parseFile(file);
      setDraft((d) => ({
        ...d,
        title: d.title || file.name.replace(/\.[a-z]+$/i, ""),
        text: parsed.kind === "image" ? d.text : parsed.text,
        pages: parsed.pages,
        image: parsed.image ?? (parsed.kind === "image" ? undefined : d.image),
        source: { kind: parsed.kind, fileName: file.name },
        sampleId: undefined,
      }));
      if (parsed.text) setIntent((i) => (i.keyMessage ? i : draftIntent(parsed.text)));
    } catch (e) {
      setFileError(e instanceof IntakeError ? e.message : `Could not read ${file.name}, so nothing was changed.`);
    } finally {
      setBusy(null);
    }
  };

  const aiDraftIntent = async () => {
    setDrafting(true);
    const r = await aiTask("draftIntent", { text: draft.text.slice(0, 5900), channel: draft.channel });
    setDrafting(false);
    if (r.ok) setIntent({ ...r.data, confirmed: false, draftedBy: "ai" });
    else setIntent({ ...draftIntent(draft.text), confirmed: false });
  };

  // A creative means the check will run OCR: start fetching it while the creator reads the form.
  const hasImage = !!draft.image;
  useEffect(() => {
    if (hasImage) void import("@/engine/visual").then((m) => m.warmOcr());
  }, [hasImage]);

  const hasContent = draft.text.trim().length > 0 || !!draft.image;
  const canRun = hasContent && draft.title.trim() && !busy;
  // The Intent Card is optional. One the creator hasn't confirmed is not used, so a guess drafted from the
  // copy never stands in for what they meant; fixes on a blank card say "not checked".
  const intentUnused = !intent.confirmed;
  const intentHasText = !!(intent.goal.trim() || intent.keyMessage.trim() || intent.cta.trim());

  const run = async () => {
    setError(null);
    setBusy(draft.image ? "Checking the copy and reading the creative…" : "Checking against the rulebook and Claim Ledger…");
    try {
      const id = await createSubmission({ ...draft, intent: intent.confirmed ? intent : EMPTY_INTENT });
      const versions = await import("@/store/db").then(({ db }) => db.versions.where("submissionId").equals(id).toArray());
      await checkVersion(id, versions[0].id);
      router.push(`/app/s/${id}`);
    } catch (e) {
      setError((e as Error).message || "The check failed.");
      setBusy(null);
    }
  };

  return (
    <div className="px-4 py-5 md:px-8 md:py-8">
      <TitleRow
        title="New draft"
        sub={
          <>
            Paste copy or upload a file. Assay checks it against {kit?.name ?? "the brand"}&apos;s published rulebook and <Term id="claim-ledger">Claim Ledger</Term>, then shows every issue with its source.
          </>
        }
      />

      <div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section aria-labelledby="content" className="card min-w-0 p-5 md:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="content" className="text-[18px] font-semibold">
              Content
            </h2>
            <p className="num text-[12.5px] text-faint">{draft.text.length.toLocaleString("en-IN")} characters</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label="Upload a file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f && !busy) void onFile(f);
            }}
            className={`mt-4 flex flex-col items-center gap-3 rounded-[28px] px-6 py-9 text-center transition-colors duration-200 md:py-12 ${over ? "bg-active" : "bg-field"}`}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-raised text-muted" aria-hidden="true">
              <Upload size={22} />
            </span>
            <p className="text-[16px] font-medium">Drop a DOCX, a PDF or a creative here</p>
            <p className="max-w-[420px] text-[13.5px] leading-5 text-muted">Text, page numbers and the picture are read in this browser. Or paste the copy straight into the box below.</p>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => fileRef.current?.click()} disabled={!!busy}>
              <Upload size={14} aria-hidden="true" /> Upload DOCX, PDF or image
            </button>
          </div>
          {fileError && (
            <div className="mt-3">
              <Notice tone="error" role="alert">
                {fileError}
              </Notice>
            </div>
          )}
          {draft.source.fileName && (
            <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted">
              <FileText size={14} aria-hidden="true" /> From {draft.source.fileName}
              {draft.pages ? ` · ${draft.pages.length} page${draft.pages.length === 1 ? "" : "s"}, page numbers kept` : ""}
            </p>
          )}
          <label htmlFor="copy" className="sr-only">
            Draft copy
          </label>
          <textarea
            id="copy"
            className="field mt-4 min-h-[240px] !rounded-[22px] !border-0 !bg-field p-4 font-[inherit]"
            placeholder="Paste a caption, email, product page or brochure copy…"
            value={draft.text}
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value, pages: undefined }))}
          />

          {draft.image && (
            <div className="mt-5 grid gap-5 rounded-[24px] bg-field p-4 md:grid-cols-[minmax(0,320px)_1fr]">
              <ImageMarker image={draft.image} onBox={(logoBox) => setDraft((d) => ({ ...d, image: { ...d.image!, logoBox } }))} />
              <div className="space-y-4">
                <div>
                  <label htmlFor="alt" className="text-[14px] font-medium">
                    Alt text
                  </label>
                  <textarea
                    id="alt"
                    rows={3}
                    className="field mt-2"
                    placeholder="Describe the image, including any text in it"
                    value={draft.image.alt}
                    onChange={(e) => setDraft((d) => ({ ...d, image: { ...d.image!, alt: e.target.value } }))}
                  />
                </div>
                <div className="text-[13px] leading-5 text-muted">
                  <p className="font-medium text-ink">Logo size check</p>
                  <p>Drag a box around the logo on the image. Assay measures it against the 120 px minimum. Assay does not find logos by itself, so the box is yours to draw.</p>
                  {draft.image.logoBox && (
                    <button type="button" className="mt-1 text-ink underline" onClick={() => setDraft((d) => ({ ...d, image: { ...d.image!, logoBox: undefined } }))}>
                      Clear the logo box
                    </button>
                  )}
                </div>
                <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={() => setDraft((d) => ({ ...d, image: undefined }))}>
                  Remove the image
                </button>
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="title" className="text-[14px] font-medium">
                Title
              </label>
              <input id="title" className="field mt-2" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Monsoon launch: Instagram post" />
            </div>
            <div>
              <label htmlFor="channel" className="text-[14px] font-medium">
                Channel
              </label>
              <select id="channel" className="field mt-2" value={draft.channel} onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value as Channel }))}>
                {CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="audience" className="text-[14px] font-medium">
                Audience
              </label>
              <input id="audience" className="field mt-2" value={draft.audience} onChange={(e) => setDraft((d) => ({ ...d, audience: e.target.value }))} placeholder="Gen Z, 18–24" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="campaign" className="text-[14px] font-medium">
                Campaign
              </label>
              <input id="campaign" className="field mt-2" value={draft.campaign} onChange={(e) => setDraft((d) => ({ ...d, campaign: e.target.value }))} placeholder="Monsoon launch" />
            </div>
          </div>
        </section>

        <div className="space-y-6 xl:sticky xl:top-3">
          <section aria-labelledby="intent-h" className="rounded-[32px] bg-active p-6">
            <div className="flex items-start justify-between gap-2">
              <h2 id="intent-h" className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">
                <Term id="intent-card">Intent Card</Term>
              </h2>
              <div className="flex gap-1">
                <button type="button" className="btn btn-ghost btn-sm" disabled={!draft.text.trim()} onClick={() => setIntent({ ...draftIntent(draft.text), confirmed: false })}>
                  Draft it
                </button>
                {ai?.aiConfigured && !kit?.confidential && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!draft.text.trim() || drafting} onClick={aiDraftIntent}>
                    {drafting ? "Drafting…" : "Draft with AI"}
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1.5 text-[13.5px] leading-5 text-muted">Optional. What the post is for: fill it in and every fix is checked to keep your key message and call to action. Leave it blank to just check the copy.</p>
            {(
              [
                ["goal", "Goal", "Launch awareness"],
                ["keyMessage", "Key message", "Daily sun protection that evens skin tone"],
                ["cta", "Call to action", "Shop via link in bio"],
              ] as const
            ).map(([k, label, ph]) => (
              <div key={k} className="mt-4">
                <label htmlFor={`intent-${k}`} className="text-[13.5px] font-medium">
                  {label}
                </label>
                <input
                  id={`intent-${k}`}
                  className="field mt-1.5"
                  value={intent[k]}
                  placeholder={ph}
                  onChange={(e) => setIntent((i) => ({ ...i, [k]: e.target.value, draftedBy: "creator" }))}
                />
              </div>
            ))}
            <label className="mt-5 flex items-start gap-2.5 rounded-[20px] bg-sheet p-4 text-[13.5px] leading-5">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#f4efe4]" checked={intent.confirmed} onChange={(e) => setIntent((i) => ({ ...i, confirmed: e.target.checked }))} />
              <span>
                I confirm this is what the draft is for
                {intent.draftedBy !== "creator" && <span className="text-muted"> (drafted by {intent.draftedBy === "ai" ? "the AI" : "a heuristic"}; check it)</span>}
              </span>
            </label>
          </section>

          {error && (
            <Notice tone="error" role="alert">
              {error}
            </Notice>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary btn-lg" disabled={!canRun} onClick={run}>
              Run check
            </button>
            {busy ? (
              <Spinner label={busy} />
            ) : !canRun ? (
              <span className="text-[13px] text-muted">{!hasContent ? "Add copy or a file first." : "Give the draft a title."}</span>
            ) : (
              intentUnused && (
                <span className="text-[13px] text-muted">
                  {intentHasText ? "The Intent Card isn't confirmed, so it won't be used: fixes won't be checked against your message." : "No Intent Card: fixes won't be checked against your message."}
                </span>
              )
            )}
          </div>
          {kit?.confidential && <Notice tone="info">Confidential mode is on: nothing in this draft will be sent to an AI service.</Notice>}
        </div>
      </div>

      {brand?.demo && (
        <section aria-labelledby="samples" className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="samples" className="text-[15px] font-semibold text-muted">
              Or start from a sample
            </h2>
            <p className="text-[13px] text-muted">Fictional Velvra drafts; each loads through the same upload path you would use.</p>
          </div>
          <ul ref={samples} className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {SAMPLES.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => loadSample(s)}
                  disabled={!!busy}
                  className={`flex h-full w-full flex-col items-start gap-1.5 rounded-[24px] p-5 text-left transition-colors ${draft.sampleId === s.id ? "bg-active" : "bg-raised hover:bg-active"}`}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-[14.5px] font-medium">{s.title}</span>
                    <span className="pill bg-neutral-bg text-neutral-ink">{CHANNELS.find((c) => c.id === s.channel)?.label}</span>
                  </span>
                  <span className="text-[13px] leading-5 text-muted">{s.shows}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
