"use client";

// The two pages that sit outside the app shell, because there is no workspace to open yet: /team (create a team
// workspace, sign in, pick a workspace) and /team/verify (use the emailed link). The team code is loaded only when one
// of these pages runs, so the demo's first load never carries it.
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import type { Role } from "@/lib/types";
import { addTeamBrand, switchBrand } from "@/store/brands";
import type { TeamStatus } from "@/store/team";
import { ConfirmProvider, Field, ToastProvider, useAction } from "./primitives";
import { AssayLoader, Mark, Notice, ROLE_LABEL } from "./ui";

const loadTeam = () => import("@/store/team");

/** The ground these pages stand on: the app's night, with a bar to get back to the app. */
export function TeamFrame({ children, centered }: { children: ReactNode; centered?: boolean }) {
  return (
    <div className="theme-night min-h-screen bg-chrome text-ink">
      <ToastProvider>
        <ConfirmProvider>
          <a href="#main" className="skip-link">
            Skip to main content
          </a>
          <header className="mx-auto flex h-16 w-full max-w-[1000px] items-center justify-between gap-3 px-4 md:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <Mark size={28} />
              <span className="font-display text-[21px] font-medium tracking-[-0.02em]">Assay</span>
            </Link>
            <Link href="/app" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} aria-hidden="true" /> Back to the app
            </Link>
          </header>
          <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[1000px] px-4 pb-16 pt-4 outline-none md:px-6 md:pt-8 ${centered ? "flex min-h-[calc(100vh-64px)] flex-col justify-center pb-28" : ""}`}>
            {children}
          </main>
        </ConfirmProvider>
      </ToastProvider>
    </div>
  );
}

/** What was sent, in words, and where a test run reads the link from. */
function Sent({ to, created, testLink, onAgain }: { to: string; created: boolean; testLink?: string; onAgain: () => void }) {
  return (
    <div role="status" className="space-y-3">
      <MailCheck size={26} aria-hidden="true" className="text-gold-mark" />
      <h3 className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">Check your email</h3>
      <p className="text-[14.5px] leading-6">
        {created ? `We sent a link to ${to}. Open it to create the workspace and sign in.` : `If ${to} belongs to a team workspace, we sent it a sign-in link.`} The link works once and expires in 30 minutes.
      </p>
      {testLink && (
        <p className="rounded-[16px] bg-gold-wash px-4 py-3 text-[13.5px] leading-5">
          This server is in test mode, so the link is here too: <a className="break-all underline" href={testLink}>{testLink}</a>
        </p>
      )}
      <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={onAgain}>
        Use a different address
      </button>
    </div>
  );
}

function Card({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-[28px] bg-raised p-6 md:p-7">
      <h2 id={id} className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">
        {title}
      </h2>
      <p className="mt-1.5 text-[14px] leading-6 text-muted">{intro}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function CreateForm() {
  const [workspace, setWorkspace] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ to: string; testLink?: string } | null>(null);
  const start = useAction(
    async () => {
      const r = await (await loadTeam()).startWorkspace(workspace.trim(), name.trim(), email.trim());
      setSent({ to: email.trim(), testLink: r.testLink });
    },
    { toastError: false },
  );
  if (sent) return <Sent to={sent.to} created testLink={sent.testLink} onAgain={() => setSent(null)} />;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void start.run();
      }}
    >
      <Field label="Workspace name" value={workspace} maxLength={80} autoComplete="organization" onChange={(e) => setWorkspace(e.target.value)} hint="Usually the brand or the company." />
      <Field label="Your name" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      <Field label="Your email" type="email" value={email} maxLength={200} autoComplete="email" onChange={(e) => setEmail(e.target.value)} hint="The link goes here. You become the workspace's Brand Admin." />
      {start.error && (
        <Notice tone="error" role="alert">
          {start.error}
        </Notice>
      )}
      <button type="submit" className="btn btn-inverse btn-lg" disabled={start.busy || !workspace.trim() || !name.trim() || !email.trim()}>
        {start.busy ? "Sending…" : "Email me a link"}
      </button>
    </form>
  );
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ to: string; testLink?: string } | null>(null);
  const signIn = useAction(
    async () => {
      const r = await (await loadTeam()).requestSignIn(email.trim());
      setSent({ to: email.trim(), testLink: r.testLink });
    },
    { toastError: false },
  );
  if (sent) return <Sent to={sent.to} created={false} testLink={sent.testLink} onAgain={() => setSent(null)} />;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void signIn.run();
      }}
    >
      <Field label="Your email" type="email" value={email} maxLength={200} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
      {signIn.error && (
        <Notice tone="error" role="alert">
          {signIn.error}
        </Notice>
      )}
      <button type="submit" className="btn btn-inverse btn-lg" disabled={signIn.busy || !email.trim()}>
        {signIn.busy ? "Sending…" : "Email me a link"}
      </button>
    </form>
  );
}

function Workspaces({ email, list, onSignedOut }: { email: string; list: NonNullable<TeamStatus["workspaces"]>; onSignedOut: () => void }) {
  const out = useAction(
    async () => {
      await (await loadTeam()).signOut();
      onSignedOut();
    },
    { errorPrefix: "Could not sign out", success: "Signed out." },
  );
  return (
    <section aria-labelledby="mine-h" className="rounded-[28px] bg-raised p-6 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="mine-h" className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">
            Your workspaces
          </h2>
          <p className="mt-1.5 text-[14px] leading-6 text-muted">
            Signed in as <span className="text-ink">{email}</span>.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={out.busy} onClick={() => out.run()}>
          Sign out
        </button>
      </div>
      {list.length === 0 ? (
        <p className="mt-4 text-[14px] leading-6 text-muted">This address is not in any workspace yet. Create one below, or ask a Brand Admin to invite you.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {list.map((w) => (
            <li key={w.workspaceId} className="flex flex-wrap items-center gap-3 rounded-[20px] bg-sheet px-4 py-3" data-workspace={w.workspaceName}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{w.workspaceName}</p>
                <p className="text-[13px] text-muted">
                  You are {w.name}, {ROLE_LABEL[w.role as Role]}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-inverse btn-sm"
                aria-label={`Open ${w.workspaceName}`}
                onClick={() => switchBrand(addTeamBrand(w.workspaceId, w.workspaceName, w.name, w.role).id)}
              >
                Open <ArrowRight size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TeamView() {
  const [status, setStatus] = useState<TeamStatus | "failed" | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    loadTeam()
      .then((t) => t.teamStatus())
      .then(
        (s) => live && setStatus(s),
        () => live && setStatus("failed"),
      );
    return () => {
      live = false;
    };
  }, [round]);
  const load = () => {
    setStatus(null);
    setRound((n) => n + 1);
  };

  let body: ReactNode;
  if (status === null) {
    body = (
      <p role="status" className="flex items-center gap-3 text-[15px] text-muted">
        <AssayLoader size={28} /> Asking the server what it offers…
      </p>
    );
  } else if (status === "failed") {
    body = (
      <section className="rounded-[28px] bg-raised p-6 md:p-7">
        <h2 className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">Assay couldn&apos;t reach the server</h2>
        <p className="mt-2 text-[14.5px] leading-6 text-muted">Check the connection and try again. The demo and any brands kept in this browser work without the server.</p>
        <button type="button" className="btn btn-inverse btn-lg mt-4" onClick={load}>
          Try again
        </button>
      </section>
    );
  } else if (!status.enabled || !status.email) {
    body = (
      <section aria-labelledby="off-h" className="rounded-[28px] bg-raised p-6 md:p-7" data-testid="team-off">
        <h2 id="off-h" className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">
          Team workspaces are switched off here
        </h2>
        <p className="mt-2 text-[14.5px] leading-6">
          {!status.enabled
            ? "This deployment has no database, so there is nowhere to keep a team's work."
            : "This deployment has a database but no email service, so sign-in links can't be sent."}
        </p>
        <p className="mt-2 text-[14.5px] leading-6 text-muted">The demo and any brands kept in this browser still work, exactly as before.</p>
        <Link href="/app" className="btn btn-inverse btn-lg mt-5">
          Back to the app
        </Link>
      </section>
    );
  } else {
    body = (
      <div className="space-y-5">
        {status.signedIn && <Workspaces email={status.signedIn} list={status.workspaces ?? []} onSignedOut={load} />}
        <div className="grid gap-5 md:grid-cols-2">
          <Card id="create-h" title="Create a team workspace" intro="Your team's drafts, findings and decisions are kept on the server, so everyone sees the same thing. You choose who joins.">
            <CreateForm />
          </Card>
          <Card id="signin-h" title="Sign in" intro="Already in a workspace? We email you a link. There are no passwords.">
            <SignInForm />
            <div className="mt-6 rounded-[20px] bg-sheet px-4 py-4 text-[13.5px] leading-6 text-muted">
              <p className="font-medium text-ink">How the link works</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                <li>It goes to the address you give, and works once.</li>
                <li>It expires after 30 minutes.</li>
                <li>Opening it asks you to press a button before it signs you in, so a mail scanner can&apos;t use it up.</li>
                <li>Signing in on a new browser brings the workspace&apos;s drafts with it.</li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <TeamFrame>
      <h1 className="font-display text-[26px] font-medium leading-8 tracking-[-0.02em] md:text-[32px] md:leading-10">Team workspaces</h1>
      <p className="mt-2 max-w-[640px] text-[15px] leading-7 text-muted">
        A team workspace keeps drafts, findings and decisions on a server, so people in different places work on the same drafts. Each person signs in with an emailed link, and a Brand Admin sets their role.
      </p>
      <div className="mt-8">{body}</div>
    </TeamFrame>
  );
}

/**
 * Where an emailed link lands. The link's code is in the address after the #, which a server never sees, and it is
 * used only when the person presses the button: a mail scanner that opens the link would otherwise use it up.
 * The code is taken out of the address bar as soon as it has been read.
 */
let readCode: string | undefined;

function VerifyBody() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    // Only the browser can read the address's fragment, so it is read once the page is here. It is kept in
    // the module as well, because React may run this twice in development and the address is empty by then.
    const code = window.location.hash.replace(/^#/, "");
    if (code) readCode = code;
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(readCode ?? "");
  }, []);
  const go = useAction(
    async () => {
      const brand = await (await loadTeam()).verifyLink(token ?? "");
      if (!brand) throw new Error("That link signed you in, but there is no workspace to open yet. Ask a Brand Admin to invite you.");
      switchBrand(brand.id);
    },
    { toastError: false },
  );

  let body: ReactNode;
  if (token === null) {
    body = (
      <p role="status" className="flex items-center gap-3 text-[15px] text-muted">
        <AssayLoader size={28} /> Reading the link…
      </p>
    );
  } else if (!token) {
    body = (
      <section className="rounded-[28px] bg-raised p-6 md:p-7">
        <h2 className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">This link has no code in it</h2>
        <p className="mt-2 text-[14.5px] leading-6 text-muted">It may have been cut short when it was copied. Ask for a new one.</p>
        <Link href="/team" className="btn btn-inverse btn-lg mt-5">
          Back to team sign-in
        </Link>
      </section>
    );
  } else {
    body = (
      <section className="rounded-[28px] bg-raised p-6 md:p-7">
        <h2 className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em]">Continue to Assay</h2>
        <p className="mt-2 text-[14.5px] leading-6 text-muted">This signs you in on this browser. The link works once, so it is used when you press the button.</p>
        {go.error && (
          <div className="mt-4">
            <Notice tone="error" role="alert">
              {go.error}
            </Notice>
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!go.error && (
            <button type="button" className="btn btn-inverse btn-lg" disabled={go.busy} onClick={() => go.run()}>
              {go.busy ? "Signing you in…" : "Continue to Assay"}
            </button>
          )}
          {go.error && (
            <Link href="/team" className="btn btn-inverse btn-lg">
              Back to team sign-in
            </Link>
          )}
        </div>
      </section>
    );
  }

  return <div>{body}</div>;
}

export function VerifyView() {
  return (
    <TeamFrame centered>
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-14">
        <div>
          <h1 className="font-display text-[26px] font-medium leading-8 tracking-[-0.02em] md:text-[32px] md:leading-10">Sign in to a team workspace</h1>
          <p className="mt-3 max-w-[460px] text-[15px] leading-7 text-muted">
            The link in your email brought you here. Pressing the button signs you in on this browser and opens your workspace. The link works once, and expires 30 minutes after it was sent.
          </p>
        </div>
        <VerifyBody />
      </div>
    </TeamFrame>
  );
}
