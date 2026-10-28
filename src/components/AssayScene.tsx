"use client";

// "How it works" as one held scene: the sample draft is checked, fixed, approved and stamped while the
// section stays pinned and the scroll drives a GSAP timeline. Without motion (reduced motion, a phone,
// no script) the same markup reads as the finished result: v2, every finding fixed, both approvals
// and the Hallmark.
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { sha256Hex } from "@/engine/hash";
import { Mark } from "./ui";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const s: Record<string, string> = new Proxy({}, { get: (_t, key) => `lp-${String(key)}` });

const STEPS = [
  ["Check", "Rule checks run in the browser and Gemini judges tone. Each finding quotes the draft and cites the brand book page or the approved fact."],
  ["Fix", "Each fix rewrites only its own words, uses the fact's approved wording and footnote, and is checked against the creator's key message."],
  ["Approve", "Claims go to Compliance, then the draft to a Reviewer. A creator can't wave away a high-severity finding alone."],
  ["Stamp", "Approval writes a Hallmark: the content's SHA-256, the rulebook version and every decision, chained to the one before."],
] as const;

const FINDINGS = [
  ["m3", "CLAIM-01", "High", "Contradicts F-112: the study ran 4 weeks, not 7 days", "p.18 §6.1"],
  ["m4", "CLAIM-03", "High", "A superlative with no fact behind it", "p.19 §6.3"],
  ["m1", "VOICE-02", "Medium", "Never hype", "p.6 §2.2"],
  ["m2", "TERM-04", "Low", "Say Daily Shield SPF 50, not sunblock", "p.12 §4.2"],
] as const;

const V2 =
  "Our new Daily Shield SPF 50 is shown in our 4-week study to help skin look more even (82% saw a visibly more even skin tone)!* Lightweight protection for every day. Shop now via the link in bio.";

export function AssayScene() {
  const root = useRef<HTMLElement>(null);
  const [hash, setHash] = useState("");
  useEffect(() => {
    void sha256Hex(V2).then(setHash);
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(min-width: 900px) and (prefers-reduced-motion: no-preference)", () => {
        const q = gsap.utils.selector(root);
        // Stacks the step texts in one place; without this they read as a list.
        root.current!.dataset.scene = "live";
        const count = { n: 0 };
        const countEl = q(".lp-sceneCount")[0];
        const setCount = () => (countEl.textContent = `${Math.round(count.n)} finding${Math.round(count.n) === 1 ? "" : "s"}`);

        // The opening state: v1 of the draft, nothing found yet.
        gsap.set(q(".lp-sceneV2, .lp-sceneFixed, .lp-sceneAfter, .lp-sceneApproval, .lp-sceneStamp, .lp-sceneHash"), { autoAlpha: 0 });
        gsap.set(q(".lp-sceneV1"), { autoAlpha: 1 });
        gsap.set(q(".lp-sceneMark"), { "--hl": 0 });
        gsap.set(q(".lp-sceneMarker"), { scale: 0 });
        gsap.set(q(".lp-sceneFinding"), { autoAlpha: 0, y: 18 });
        gsap.set(q(".lp-sceneStep"), { opacity: 0.42 });
        gsap.set(q(".lp-sceneStep")[0], { opacity: 1 });
        gsap.set(q(".lp-sceneSay"), { autoAlpha: 0, y: 14 });
        gsap.set(q(".lp-sceneSay")[0], { autoAlpha: 1, y: 0 });
        gsap.set(q(".lp-sceneStatus > span"), { autoAlpha: 0 });
        gsap.set(q(".lp-sceneStatus > span")[0], { autoAlpha: 1 });
        gsap.set(q(".lp-sceneStamp"), { scale: 2.8, rotation: -24, y: -80 });
        countEl.textContent = "0 findings";

        const step = (tl: gsap.core.Timeline, i: number, at: number) => {
          tl.to(q(".lp-sceneStep"), { opacity: 0.42, duration: 0.2 }, at)
            .to(q(".lp-sceneStep")[i], { opacity: 1, duration: 0.2 }, at)
            .to(q(".lp-sceneSay")[i - 1], { autoAlpha: 0, y: -14, duration: 0.2 }, at)
            .fromTo(q(".lp-sceneSay")[i], { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.25 }, at + 0.05)
            .to(q(".lp-sceneStatus > span")[i - 1], { autoAlpha: 0, duration: 0.15 }, at)
            .to(q(".lp-sceneStatus > span")[i], { autoAlpha: 1, duration: 0.15 }, at + 0.1);
        };

        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: () => `+=${window.innerHeight * 3.4}`,
            pin: true,
            scrub: 0.7,
            invalidateOnRefresh: true,
          },
        });

        // Check: each quote lights up, gets its number, and its finding deals in.
        tl.addLabel("check", 0);
        FINDINGS.forEach(([mark], i) => {
          const at = 0.1 + i * 0.18;
          tl.to(q(`.lp-sceneMark[data-m="${mark}"]`), { "--hl": 1, duration: 0.2 }, at)
            .to(q(`.lp-sceneMark[data-m="${mark}"] .lp-sceneMarker`), { scale: 1, ease: "back.out(2.4)", duration: 0.18 }, at + 0.04)
            .to(q(".lp-sceneFinding")[i], { autoAlpha: 1, y: 0, duration: 0.22 }, at + 0.06)
            .to(count, { n: i + 1, duration: 0.15, onUpdate: setCount }, at + 0.06);
        });
        tl.addLabel("checked", 0.95);

        // Fix: v1 is rewritten into v2 from the left, the creative and its readings flip, every finding is fixed.
        step(tl, 1, 1);
        tl.to(q(".lp-sceneV1"), { autoAlpha: 0, duration: 0.35 }, 1.1)
          .fromTo(q(".lp-sceneV2"), { autoAlpha: 1, clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.55, ease: "power3.inOut" }, 1.1)
          .to(q(".lp-sceneSev"), { autoAlpha: 0, duration: 0.15, stagger: 0.08 }, 1.35)
          .to(q(".lp-sceneFixed"), { autoAlpha: 1, duration: 0.15, stagger: 0.08 }, 1.4)
          .to(q(".lp-sceneAfter"), { autoAlpha: 1, duration: 0.3 }, 1.45)
          .to(q(".lp-sceneBefore"), { autoAlpha: 0, duration: 0.3 }, 1.45)
          .addLabel("fixed", 1.95);

        // Approve: Compliance clears the claims, then the Reviewer signs.
        step(tl, 2, 2);
        tl.fromTo(q(".lp-sceneApproval"), { autoAlpha: 0, x: -20 }, { autoAlpha: 1, x: 0, duration: 0.25, stagger: 0.3 }, 2.15).addLabel("approved", 2.95);

        // Stamp: the punch drops onto the sheet, the sheet takes the blow, the hash is struck under it.
        step(tl, 3, 3);
        tl.to(q(".lp-sceneStamp"), { autoAlpha: 1, duration: 0.05 }, 3.1)
          .to(q(".lp-sceneStamp"), { scale: 1, rotation: -8, y: 0, duration: 0.3, ease: "power4.in" }, 3.1)
          .to(q(".lp-sceneSheet"), { y: 6, duration: 0.05, ease: "power1.out" }, 3.4)
          .to(q(".lp-sceneSheet"), { y: 0, duration: 0.25, ease: "elastic.out(1, 0.5)" }, 3.45)
          .fromTo(q(".lp-sceneHash"), { autoAlpha: 1, clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.35, ease: "steps(24)" }, 3.5)
          .addLabel("stamped", 3.95)
          .to({}, { duration: 0.25 });
        return () => {
          delete root.current?.dataset.scene;
        };
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} id="how" aria-labelledby="how-h" className={s.scene}>
      <div className={`${s.wrap} ${s.sceneGrid}`}>
        <div className={s.sceneSteps}>
          <h2 id="how-h" className={s.srOnly}>
            How it works
          </h2>
          <ol className={s.sceneVerbs}>
            {STEPS.map(([verb]) => (
              <li key={verb} className={`${s.display} ${s.sceneStep}`}>
                {verb}
              </li>
            ))}
          </ol>
          <div className={s.sceneSays}>
            {STEPS.map(([verb, text]) => (
              <p key={verb} className={s.sceneSay}>
                <span className={s.srOnly}>{verb}: </span>
                {text}
              </p>
            ))}
          </div>
        </div>

        <div data-ui className={s.sceneSheet}>
          <span className={s.sceneStamp} aria-hidden="true">
            <Mark size={92} />
          </span>
          <div className={s.sceneHead}>
            <div>
              <p className={s.sceneTitle}>Monsoon launch: Instagram post</p>
              <p className={s.sceneMeta}>Velvra rulebook v3.2 · Women 22–35, metro India</p>
            </div>
            <p className={s.sceneStatus}>
              <span className={s.sceneCount}>4 findings, all fixed</span>
              <span>v2 · intent kept</span>
              <span>In review · Compliance cleared</span>
              <span>Approved · Hallmark #1</span>
            </p>
          </div>

          <div className={s.sceneCopy}>
            <p className={s.sceneV1} aria-hidden="true">
              <Mk m="m1" n={3}>OMG</Mk> our new <Mk m="m2" n={4}>sunblock</Mk> is <Mk m="m3" n={1}>clinically proven to erase dark spots in just 7 days</Mk>!{" "}
              <Mk m="m4" n={2}>The best serum in India</Mk>. Shop now via the link in bio.
            </p>
            <p className={s.sceneV2}>
              {V2}
              <span className={s.sceneFoot}>*In-house study, 40 participants, 2025.</span>
            </p>
          </div>

          <div className={s.sceneBody}>
            <div className={s.sceneCreative}>
              <div className={s.sceneImg}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static crop of the sample creative */}
                <img src="/landing/strip.webp" alt="" width={780} height={312} className={s.sceneBefore} loading="lazy" />
                {/* eslint-disable-next-line @next/next/no-img-element -- static crop of the corrected creative */}
                <img src="/landing/strip-fixed.webp" alt="The sample Velvra creative: a Daily Shield tube on Rose Clay, after the fixes." width={780} height={312} className={s.sceneAfter} loading="lazy" />
              </div>
              <dl className={s.sceneReadings}>
                <div>
                  <dt>Headline contrast</dt>
                  <dd className="num">
                    <span className={s.sceneBefore}>1.7:1</span>
                    <span className={s.sceneAfter}>5.7:1</span>
                  </dd>
                </div>
                <div>
                  <dt>Palette distance</dt>
                  <dd className="num">
                    <span className={s.sceneBefore}>ΔE 18</span>
                    <span className={s.sceneAfter}>ΔE 2</span>
                  </dd>
                </div>
              </dl>
            </div>
            <ol className={s.sceneFindings}>
              {FINDINGS.map(([, rule, sev, what, page], i) => (
                <li key={rule} className={s.sceneFinding}>
                  <span className="marker !ml-0 flex-none">{i + 1}</span>
                  <span className="min-w-0">
                    <span className={s.sceneWhat}>{what}</span>
                    <span className={s.sceneCite}>
                      {rule} · Brand Book {page}
                    </span>
                  </span>
                  <span className={s.sceneState}>
                    <span className={`${s.sceneSev} ${s[`sev${sev}`]}`}>{sev}</span>
                    <span className={s.sceneFixed}>Fixed</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className={s.sceneFoot2}>
            <p className={s.sceneApproval}>
              <b>Meera</b> · Compliance · cleared CLAIM-01 and CLAIM-03
            </p>
            <p className={s.sceneApproval}>
              <b>Arjun</b> · Reviewer · approved v2
            </p>
            <p className={`num ${s.sceneHash}`}>sha256 {hash ? `${hash.slice(0, 32)}…` : "…"}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Mk({ m, n, children }: { m: string; n: number; children: React.ReactNode }) {
  return (
    <span className={s.sceneMark} data-m={m}>
      {children}
      <span className={`marker ${s.sceneMarker}`}>{n}</span>
    </span>
  );
}
