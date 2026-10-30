import Link from "next/link";
import type { Metadata } from "next";
import { requireOrg } from "@/server/session";
import { listCases } from "@/server/services/cases";
import { hasDemoCase } from "@/server/services/demo";
import { aiRunsThisMonth } from "@/server/ai/runs";
import { PLANS } from "@/server/plans";
import { can } from "@/server/permissions";
import { ActionForm, Submit } from "@/components/forms";
import { createCaseAction, loadDemoAction } from "@/app/actions";

export const metadata: Metadata = { title: "Cases" };

export default async function Cases({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { ctx, org, role } = await requireOrg(slug);
  const [rows, demo, usage] = await Promise.all([listCases(ctx), hasDemoCase(ctx.db, ctx.orgId), aiRunsThisMonth(ctx.db, ctx.orgId)]);
  const plan = PLANS[org.plan];
  const open = rows.filter((r) => r.status === "open").length;
  const canCreate = can(role, "case.create");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="eyebrow">{org.name}</p>
          <h1 className="h-display text-[34px]">Investigation cases</h1>
        </div>
        <div className="flex flex-wrap gap-5 text-[13px]">
          <Stat label="Plan" value={plan.label} />
          <Stat label="Open cases" value={plan.openCases === null ? String(open) : `${open} of ${plan.openCases}`} />
          <Stat label="Model runs this month" value={plan.aiRunsPerMonth === null ? String(usage.runs) : `${usage.runs} of ${plan.aiRunsPerMonth.toLocaleString()}`} />
        </div>
      </div>

      {canCreate && (
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <details className="card p-4" open={rows.length === 0}>
            <summary className="cursor-pointer font-semibold">Open a new case</summary>
            <ActionForm action={createCaseAction} className="mt-4 grid gap-3 md:grid-cols-2">
              <input type="hidden" name="org" value={slug} />
              <label className="field md:col-span-2"><span>Title</span><input className="input" name="title" placeholder="Intermittent fault, as reported" required /></label>
              <label className="field"><span>Aircraft or equipment</span><input className="input" name="aircraft" placeholder="Registration, MSN, or P/N and S/N" required /></label>
              <label className="field"><span>System</span><input className="input" name="system" placeholder="ATA chapter and system" /></label>
              <label className="field md:col-span-2"><span>Unresolved question</span><textarea className="input" name="question" placeholder="What does this investigation need to answer?" required /></label>
              <label className="field"><span>Evidence cutoff</span><input className="input" type="date" name="evidenceCutoff" /></label>
              <div className="flex items-end"><Submit pendingText="Opening…">Open case</Submit></div>
            </ActionForm>
          </details>
          {!demo && (
            <ActionForm action={loadDemoAction} className="card grid content-start gap-2 p-4 md:max-w-xs">
              <input type="hidden" name="org" value={slug} />
              <p className="font-semibold">Try the demo case</p>
              <p className="caption">A fictional recurring bleed-air fault with eight records, an example AI draft and three explanations to test.</p>
              <div><Submit className="btn" pendingText="Loading…">Load demo case</Submit></div>
            </ActionForm>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-semibold">No cases yet</p>
          <p className="caption">Open a case for one unresolved defect, or load the demo case to see the workflow.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="card w-full border-collapse text-left text-[13.5px]">
            <thead className="bg-sunk">
              <tr>
                {["Case", "Title", "Aircraft", "To check", "Handover", "Updated"].map((h) => <th key={h} className="eyebrow px-3 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-line align-top hover:bg-sunk/50">
                  <td className="px-3 py-3"><Link href={`/app/${slug}/cases/${c.id}`} className="mono font-medium text-accent">{c.ref}</Link></td>
                  <td className="px-3 py-3">
                    <Link href={`/app/${slug}/cases/${c.id}`} className="font-medium hover:text-accent">{c.title}</Link>
                    <div className="mt-1 flex gap-2">
                      {c.isDemo && <span className="pill pill-inc">Demo</span>}
                      {c.status === "closed" && <span className="pill pill-inc">Closed</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3">{c.aircraft}</td>
                  <td className="px-3 py-3">{c.unreviewed ? <span className="pill pill-amber">{c.unreviewed} unreviewed</span> : <span className="caption">{c.statements ? "All checked" : "No draft yet"}</span>}</td>
                  <td className="px-3 py-3">
                    {c.latestVersion === 0 ? <span className="pill pill-amber">Not approved</span>
                      : c.changedSinceApproval ? <span className="pill pill-amber">v{c.latestVersion} · changed since</span>
                      : <span className="pill pill-good">v{c.latestVersion} approved</span>}
                  </td>
                  <td className="mono px-3 py-3">{c.updatedAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid">
      <span className="eyebrow">{label}</span>
      <span className="font-display text-[20px] font-semibold">{value}</span>
    </div>
  );
}
