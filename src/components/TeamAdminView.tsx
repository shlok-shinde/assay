"use client";

// /app/team: who is in this team workspace. Everyone sees the member list; a Brand Admin also invites and removes
// people, exports the workspace, and deletes it. The server decides every one of these; the buttons here only ask.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, Trash2, UserPlus, UserMinus } from "lucide-react";
import type { Role } from "@/lib/types";
import { forgetBrand } from "@/store/brands";
import { TitleRow } from "./AppShell";
import { useBrand } from "./BrandSwitcher";
import { saveFile } from "./download";
import { Dialog, Field, Select, Table, useAction, useConfirm } from "./primitives";
import { Notice, PageLoading, ROLE_LABEL, StatusPanel } from "./ui";

const loadTeam = () => import("@/store/team");
type Member = { email: string; name: string; role: Role };
const ROLES: Role[] = ["creator", "reviewer", "compliance", "admin"];
const WHAT: Record<Role, string> = {
  creator: "Checks drafts, fixes them and submits them for review.",
  reviewer: "Approves or sends back what is submitted, and writes the Hallmark.",
  compliance: "Decides every claim that is routed from a draft.",
  admin: "Edits the rulebook, invites and removes people, and can take any desk.",
};

export function TeamAdminView() {
  const brand = useBrand();
  const confirm = useConfirm();
  const team = brand?.team;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const isTeam = !!team;
  useEffect(() => {
    if (!isTeam) return;
    let live = true;
    loadTeam()
      .then(async (t) => {
        const [list, status] = await Promise.all([t.listMembers(), t.teamStatus()]);
        if (!live) return;
        setMembers(list);
        setMe(status.signedIn ?? null);
        setProblem(null);
      })
      .catch((e: Error) => live && setProblem(e.message));
    return () => {
      live = false;
    };
  }, [isTeam, round]);
  const load = () => setRound((n) => n + 1);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("creator");
  const [invited, setInvited] = useState<{ email: string; testLink?: string } | null>(null);
  const invite = useAction(
    async () => {
      const r = await (await loadTeam()).invite(email.trim(), name.trim(), role);
      setInvited({ email: email.trim(), testLink: r.testLink });
      setName("");
      setEmail("");
    },
    { toastError: false },
  );

  const remove = useAction(
    async (m: Member) => {
      const yes = await confirm({
        title: `Remove ${m.name}?`,
        body: <p>{m.name} loses access to {brand?.name} at once, on every device. Their drafts and comments stay in the workspace.</p>,
        confirmLabel: "Remove",
        danger: true,
      });
      if (!yes) return null;
      await (await loadTeam()).removeMember(m.email);
      load();
      return m.name;
    },
    { errorPrefix: "Could not remove them", success: (who) => (who ? `Removed ${who}.` : undefined) },
  );

  const exported = useAction(
    async () => {
      const r = await (await loadTeam()).exportTeamWorkspace();
      const slug = r.workspace.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
      saveFile(`assay-team-${slug}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "assay-team", workspace: r.workspace, exportedAt: new Date().toISOString(), rows: r.rows }, null, 2));
    },
    { errorPrefix: "Could not export the workspace", success: "Workspace exported." },
  );

  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const del = useAction(
    async () => {
      await (await loadTeam()).deleteWorkspace();
      if (brand) forgetBrand(brand.id);
      // A full load, not a client-side move: the app's storage is bound to the workspace it started on.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/team";
    },
    { toastError: false },
  );

  if (!brand) return <PageLoading label="Opening the team…" />;
  if (!team) {
    return (
      <StatusPanel
        title="This isn't a team workspace"
        actions={
          <Link href="/team" className="btn btn-inverse btn-lg">
            Team workspaces
          </Link>
        }
      >
        <p>The demo and brands kept in this browser have no team. Create a team workspace to work with other people on the same drafts.</p>
      </StatusPanel>
    );
  }
  const admin = team.role === "admin";

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <TitleRow
        title="Team"
        sub={
          <>
            {brand.name} · you are {team.name}, {ROLE_LABEL[team.role]}.{" "}
            {admin ? "Everyone below can see this workspace's drafts, findings and decisions." : "A Brand Admin manages who is in the team."}
          </>
        }
      />

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="members-h" className="min-w-0 rounded-[24px] bg-raised p-5 md:p-6">
          <h2 id="members-h" className="text-[16px] font-semibold">
            Members
          </h2>
          {problem && (
            <div className="mt-3">
              <Notice tone="error" role="alert">
                {problem}
              </Notice>
            </div>
          )}
          {!members && !problem && <p role="status" className="mt-3 text-[14px] text-muted">Reading the member list…</p>}
          {members && (
            <Table label="Members of this workspace" minWidth={0} className="mt-3">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="hidden sm:table-cell">Email</th>
                  <th>Role</th>
                  {admin && <th className="num">
                    <span className="sr-only">Actions</span>
                  </th>}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.email} data-member={m.email}>
                    <td className="font-medium">
                      {m.name}
                      {m.email === me && <span className="text-muted"> (you)</span>}
                      <span className="block break-all text-[12.5px] font-normal text-muted sm:hidden">{m.email}</span>
                    </td>
                    <td className="hidden break-all text-muted sm:table-cell">{m.email}</td>
                    <td>
                      <span className="pill bg-neutral-bg text-neutral-ink">{ROLE_LABEL[m.role]}</span>
                    </td>
                    {admin && (
                      <td className="num">
                        {m.email !== me && (
                          <button type="button" className="btn btn-ghost btn-sm text-neg-ink" disabled={remove.busy} aria-label={`Remove ${m.name}`} onClick={() => remove.run(m)}>
                            <UserMinus size={14} aria-hidden="true" /> Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <dl className="mt-5 space-y-2 text-[13.5px] leading-5">
            {ROLES.map((r) => (
              <div key={r} className="flex flex-wrap gap-x-3">
                <dt className="w-[96px] flex-none font-medium">{ROLE_LABEL[r]}</dt>
                <dd className="min-w-0 flex-1 text-muted">{WHAT[r]}</dd>
              </div>
            ))}
          </dl>
        </section>

        {admin && (
          <div className="min-w-0 space-y-6">
            <section aria-labelledby="invite-h" className="rounded-[24px] bg-raised p-5 md:p-6">
              <h2 id="invite-h" className="text-[16px] font-semibold">
                Invite someone
              </h2>
              <p className="mt-1 text-[13.5px] leading-5 text-muted">They get an email with a link that works once and expires in 30 minutes. They join the list above when they open it.</p>
              <form
                className="mt-4 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setInvited(null);
                  void invite.run();
                }}
              >
                <Field label="Their name" value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} />
                <Field label="Their email" type="email" value={email} maxLength={200} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
                <Select label="Their role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
                {invite.error && (
                  <Notice tone="error" role="alert">
                    {invite.error}
                  </Notice>
                )}
                {invited && (
                  <Notice tone="info" role="status">
                    <p>Invitation sent to {invited.email}. The link works once and expires in 30 minutes.</p>
                    {invited.testLink && (
                      <p className="mt-1.5">
                        This server is in test mode, so the link is here too: <a className="break-all underline" href={invited.testLink}>{invited.testLink}</a>
                      </p>
                    )}
                  </Notice>
                )}
                <button type="submit" className="btn btn-inverse btn-lg" disabled={invite.busy || !name.trim() || !email.trim()}>
                  <UserPlus size={15} aria-hidden="true" /> {invite.busy ? "Sending…" : "Send invitation"}
                </button>
              </form>
            </section>

            <section aria-labelledby="keep-h" className="rounded-[24px] bg-raised p-5 md:p-6">
              <h2 id="keep-h" className="text-[16px] font-semibold">
                Keep or delete the workspace
              </h2>
              <p className="mt-1 text-[13.5px] leading-5 text-muted">An export holds every row the server keeps for this workspace, as one JSON file.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" disabled={exported.busy} onClick={() => exported.run()}>
                  <Download size={14} aria-hidden="true" /> Export workspace (JSON)
                </button>
                <button type="button" className="btn btn-ghost text-neg-ink" onClick={() => (setTyped(""), setDeleting(true))}>
                  <Trash2 size={14} aria-hidden="true" /> Delete workspace
                </button>
              </div>
            </section>
          </div>
        )}
      </div>

      <Dialog
        open={deleting}
        onClose={() => !del.busy && setDeleting(false)}
        title={`Delete ${brand.name}?`}
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-lg" onClick={() => setDeleting(false)} disabled={del.busy} data-autofocus="">
              Cancel
            </button>
            <button type="button" className="btn btn-danger btn-lg" disabled={del.busy || typed.trim() !== brand.name} onClick={() => del.run()}>
              {del.busy ? "Deleting…" : "Delete for everyone"}
            </button>
          </>
        }
      >
        <p>This deletes every draft, finding, decision, Hallmark and member of {brand.name} from the server, for everyone. It can&apos;t be undone. Export it first if you want a copy.</p>
        <div className="mt-4">
          <Field label={`Type ${brand.name} to confirm`} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        </div>
        {del.error && (
          <div className="mt-3">
            <Notice tone="error" role="alert">
              {del.error}
            </Notice>
          </div>
        )}
      </Dialog>
    </div>
  );
}
