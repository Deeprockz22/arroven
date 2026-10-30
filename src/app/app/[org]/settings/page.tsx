import type { Metadata } from "next";
import { requireOrg } from "@/server/session";
import { listMembers, listPendingInvites } from "@/server/services/accounts";
import { aiRunsThisMonth } from "@/server/ai/runs";
import { can, ROLE_LABELS } from "@/server/permissions";
import { ROLES } from "@/server/db/schema";
import { PLANS } from "@/server/plans";
import { providerLabel } from "@/server/ai/label";
import { ActionForm, ConfirmSubmit, Submit } from "@/components/forms";
import { Drop } from "@/components/drop";
import { changeRoleAction, createTrainingExportAction, deleteTrainingExportAction, inviteAction, planAction, removeMemberAction, settingsAction } from "@/app/actions";
import { listTrainingExports, trainingEligibility } from "@/server/training/export";
import { utcStamp } from "@/lib/labels";

export const metadata: Metadata = { title: "Settings" };

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including plan and owners",
  admin: "Members, settings and all engineering work",
  reviewer: "Engineering work and handover approval",
  engineer: "Import, draft, check, decide, ask questions",
  viewer: "Read cases and handovers",
};

export default async function Settings({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { ctx, org, role, user } = await requireOrg(slug);
  const canTrain = can(role, "training.manage");
  const canOrg = can(role, "org.settings");
  const manage = can(role, "members.manage");
  const [members, invites, usage, exports, eligibility] = await Promise.all([
    listMembers(ctx), listPendingInvites(ctx), aiRunsThisMonth(ctx.db, ctx.orgId),
    canTrain ? listTrainingExports(ctx) : Promise.resolve([]), canTrain ? trainingEligibility(ctx) : Promise.resolve([]),
  ]);
  const permittedCases = eligibility.filter((c) => c.permitted);
  const liveExports = exports.filter(({ e }) => !e.deletedAt);
  const deletedExports = exports.filter(({ e }) => e.deletedAt);
  const plan = PLANS[org.plan];
  const hidden = <input type="hidden" name="org" value={slug} />;
  const sections = [["organization", "Organization"], ["members", "Members"], ["plan", "Plan and usage"], ...(canTrain ? [["training", "Training data"]] : [])];

  return (
    <div className="grid gap-6">
      <div className="grid gap-0.5">
        <p className="caption">{org.name}</p>
        <h1 className="text-[24px] font-semibold">Settings</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-24 lg:flex-col lg:self-start" aria-label="Settings sections">
          {sections.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-md px-3 py-1.5 text-[14px] text-muted hover:bg-surface hover:text-accent">{label}</a>
          ))}
        </nav>

        <div className="grid max-w-[880px] gap-5">
          <section id="organization" className="card scroll-mt-24">
            <Head title="Organization" />
            <ActionForm action={settingsAction} className="grid gap-4 px-5 py-4">
              {hidden}
              <label className="field max-w-md"><span>Name</span><input className="input" name="name" defaultValue={org.name} disabled={!canOrg} /></label>
              <label className="flex items-start gap-2.5 text-[14px]">
                <input type="checkbox" name="requireIndependentReview" defaultChecked={org.requireIndependentReview} disabled={!canOrg} className="mt-1" />
                <span>Require an independent reviewer<span className="caption block">The person who approves a handover can&apos;t be the case&apos;s responsible engineer.</span></span>
              </label>
              {canOrg && <div><Submit className="btn btn-sm btn-primary">Save</Submit></div>}
            </ActionForm>
          </section>

          <section id="members" className="card scroll-mt-24">
            <Head title="Members" note={`${members.length} member${members.length === 1 ? "" : "s"}`}>
              {manage && (
                <Drop label="Invite" primary small>
                  <ActionForm action={inviteAction} className="grid gap-3" reset>
                    {hidden}
                    <label className="field"><span>Work email</span><input className="input" type="email" name="email" required /></label>
                    <label className="field"><span>Role</span>
                      <select className="input" name="role" defaultValue="engineer">
                        {ROLES.filter((r) => r !== "owner" || role === "owner").map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}: {ROLE_HELP[r]}</option>)}
                      </select>
                    </label>
                    <p className="caption">You get a link to send yourself. It works once and expires in 7 days.</p>
                    <div><Submit className="btn btn-sm btn-primary">Create invite link</Submit></div>
                  </ActionForm>
                </Drop>
              )}
            </Head>
            <ul className="divide-y divide-line">
              {members.map((m) => {
                const editable = manage && m.userId !== user.id;
                return (
                  <li key={m.userId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                    <span className="grid min-w-0 flex-1">
                      <span className="text-[14px] font-medium">{m.name}{m.userId === user.id && <span className="caption"> (you)</span>}</span>
                      <span className="caption truncate">{m.email}</span>
                    </span>
                    {editable ? (
                      <>
                        <ActionForm action={changeRoleAction} className="flex items-center gap-2" quiet>
                          {hidden}
                          <input type="hidden" name="userId" value={m.userId} />
                          <select className="input w-auto py-1 text-[13px]" name="role" defaultValue={m.role} aria-label={`Role for ${m.name}`}>
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                          <Submit className="text-[12.5px] font-medium text-accent hover:underline" pendingText="…">Save</Submit>
                        </ActionForm>
                        <ActionForm action={removeMemberAction} quiet>
                          {hidden}
                          <input type="hidden" name="userId" value={m.userId} />
                          <ConfirmSubmit className="text-[12.5px] text-muted hover:text-bad" confirmText="Remove">Remove</ConfirmSubmit>
                        </ActionForm>
                      </>
                    ) : <span className="text-[13px] text-muted">{ROLE_LABELS[m.role]}</span>}
                  </li>
                );
              })}
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 px-5 py-3 text-muted">
                  <span className="grid min-w-0 flex-1">
                    <span className="text-[14px]">{i.email}</span>
                    <span className="caption">Invited as {ROLE_LABELS[i.role].toLowerCase()} · link expires {i.expiresAt.toISOString().slice(0, 10)}</span>
                  </span>
                  <span className="pill pill-inc">Pending</span>
                </li>
              ))}
            </ul>
          </section>

          <section id="plan" className="card scroll-mt-24">
            <Head title="Plan and usage" />
            <div className="grid gap-4 px-5 py-4">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat label="Plan" value={plan.label} />
                <Stat label="Model runs this month" value={plan.aiRunsPerMonth === null ? String(usage.runs) : `${usage.runs} of ${plan.aiRunsPerMonth.toLocaleString()}`} />
                <Stat label="Models" value={providerLabel()} small />
              </dl>
              <p className="caption">Records are processed only by ARROVEN&apos;s own models in ARROVEN&apos;s hosting. No third-party AI service is used.</p>
              {role === "owner" && (
                <ActionForm action={planAction} className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  {hidden}
                  <label htmlFor="plan-select" className="text-[13.5px] text-muted">Change plan</label>
                  <select id="plan-select" className="input w-auto py-1 text-[13px]" name="plan" defaultValue={org.plan}>
                    {Object.entries(PLANS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  </select>
                  <Submit className="btn btn-sm">Apply</Submit>
                  <span className="caption">Billing isn&apos;t connected yet, so changes apply at once.</span>
                </ActionForm>
              )}
            </div>
          </section>

          {canTrain && (
            <section id="training" className="card scroll-mt-24">
              <Head title="Training data" note={`${permittedCases.length} of ${eligibility.length} cases permitted`}>
                <Drop label="Create export" primary small>
                  <ActionForm action={createTrainingExportAction} className="grid gap-3" reset>
                    {hidden}
                    <p className="caption">Builds a de-identified dataset of engineer-checked labels from the {permittedCases.length} permitted case{permittedCases.length === 1 ? "" : "s"}.</p>
                    <label className="field"><span>What it&apos;s for</span><input className="input" name="purpose" placeholder="e.g. Train extraction model v0.2" required minLength={5} /></label>
                    <div><Submit className="btn btn-sm btn-primary" pendingText="Building…">Create export</Submit></div>
                  </ActionForm>
                </Drop>
              </Head>
              <div className="grid gap-1 border-b border-line px-5 py-3">
                <p className="caption">Cases included in exports</p>
                <p className="text-[13.5px]">
                  {permittedCases.length
                    ? permittedCases.map((c, i) => <span key={c.id}>{i > 0 && ", "}<a className="mono text-accent" href={`/app/${slug}/cases/${c.id}`}>{c.ref}</a></span>)
                    : "None yet. Record a training permission on a case's Overview tab."}
                </p>
              </div>
              {!liveExports.length && <p className="caption px-5 py-4">No exports yet.</p>}
              <ul className="divide-y divide-line">
                {liveExports.map(({ e, by }) => {
                  const labels = Object.values(e.counts).reduce((a, b) => a + b, 0);
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                      <span className="grid min-w-0 flex-1">
                        <span className="text-[14px] font-medium">{e.purpose}</span>
                        <span className="caption">{utcStamp(e.createdAt)} · {by} · {e.caseRefs.length} case{e.caseRefs.length === 1 ? "" : "s"} · {labels} labels · <span className="mono" title={e.sha256}>{e.sha256.slice(0, 10)}</span></span>
                      </span>
                      <a className="text-[12.5px] font-medium text-accent hover:underline" href={`/api/orgs/${slug}/training-exports/${e.id}`}>Download</a>
                      <ActionForm action={deleteTrainingExportAction} quiet>
                        {hidden}
                        <input type="hidden" name="exportId" value={e.id} />
                        <ConfirmSubmit className="text-[12.5px] text-muted hover:text-bad" confirmText="Delete file">Delete</ConfirmSubmit>
                      </ActionForm>
                    </li>
                  );
                })}
              </ul>
              {deletedExports.length > 0 && (
                <details className="border-t border-line">
                  <summary className="cursor-pointer px-5 py-2.5 text-[13px] text-muted hover:text-accent">Deleted ({deletedExports.length}) ›</summary>
                  <ul className="divide-y divide-line">
                    {deletedExports.map(({ e }) => (
                      <li key={e.id} className="px-5 py-2.5 text-[13px] text-muted">
                        {e.purpose} · deleted {e.deletedAt!.toISOString().slice(0, 10)} · <span className="mono">{e.sha256.slice(0, 10)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Head({ title, note, children }: { title: string; note?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
      <span className="flex items-baseline gap-3">
        <h2 className="h-section">{title}</h2>
        {note && <span className="caption">{note}</span>}
      </span>
      {children}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <dt className="caption">{label}</dt>
      <dd className={small ? "text-[13.5px] font-medium" : "text-[20px] font-semibold"}>{value}</dd>
    </div>
  );
}
