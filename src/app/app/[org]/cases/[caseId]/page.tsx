import Link from "next/link";
import { requireOrg } from "@/server/session";
import { caseEngineers, caseMetrics, handoverData, loadCase } from "@/server/services/cases";
import { can } from "@/server/permissions";
import { ActionForm, ConfirmSubmit, Submit } from "@/components/forms";
import { assignAction, caseStatusAction, trainingPermissionAction, updateCaseAction } from "@/app/actions";
import { latestRuns } from "@/server/ai/runs";
import { readiness } from "@/lib/handover";
import { utcStamp } from "@/lib/labels";

export default async function Overview({ params }: { params: Promise<{ org: string; caseId: string }> }) {
  const { org: slug, caseId } = await params;
  const { ctx, role } = await requireOrg(slug);
  const [c, m, data, runs, engineers] = await Promise.all([loadCase(ctx, caseId), caseMetrics(ctx, caseId), handoverData(ctx, caseId), latestRuns(ctx, caseId), caseEngineers(ctx)]);
  const hidden = (<><input type="hidden" name="org" value={slug} /><input type="hidden" name="caseId" value={caseId} /></>);
  const writable = c.status === "open";
  const decided = m.accepted + m.edited + m.rejected;
  const pct = (n: number) => (decided ? `${Math.round((n / decided) * 100)}%` : "–");
  const base = `/app/${slug}/cases/${caseId}`;
  const sources = data.sources.filter((s) => s.available).length;
  const checks = readiness(data);
  const todo = checks.filter((r) => !r.ok);
  const passing = checks.length - todo.length;

  const next = !sources
    ? { href: `${base}/sources`, text: "Import the first source record" }
    : !data.statements.length
      ? { href: `${base}/chronology`, text: "Draft the chronology" }
      : m.unreviewed
        ? { href: `${base}/chronology?status=unreviewed`, text: `Check ${m.unreviewed} drafted statement${m.unreviewed > 1 ? "s" : ""}` }
        : !data.hypotheses.length
          ? { href: `${base}/explanations`, text: "Write the first explanation to test" }
          : { href: `${base}/review`, text: "Review open questions and the handover" };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section className="grid content-start gap-5">
        <Link href={next.href} className="flex items-center justify-between gap-3 rounded-[10px] bg-accent px-5 py-4 text-accent-ink hover:brightness-110">
          <span><span className="block text-[12.5px] opacity-85">Next step</span><span className="text-[16px] font-semibold">{next.text}</span></span>
          <span aria-hidden className="text-[20px]">→</span>
        </Link>

        <div className="card grid gap-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="h-section">Before the handover can be approved</h2>
            <span className="caption">{passing} of {checks.length} checks pass</span>
          </div>
          {todo.length === 0 ? <p className="text-[14px] text-good">Everything is ready for a reviewer.</p> : (
            <ul className="grid gap-2">
              {todo.map((r) => (
                <li key={r.text} className="flex gap-2.5 text-[14px]">
                  <span aria-hidden className={`mt-[7px] h-2 w-2 flex-none rounded-full ${r.block ? "bg-bad" : "bg-amber"}`} />
                  <span>{r.text}{r.block && <span className="text-bad"> Blocks approval.</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card grid gap-4 p-5">
          <h2 className="h-section">How the drafts are holding up</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Drafted" value={m.total} />
            <Metric label="Accepted as written" value={pct(m.accepted)} />
            <Metric label="Corrected" value={pct(m.edited)} />
            <Metric label="Rejected" value={pct(m.rejected)} />
          </div>
          <details>
            <summary className="cursor-pointer text-[13px] font-medium text-accent">More measures ›</summary>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-4">
              <Small label="Still unreviewed" value={m.unreviewed} />
              <Small label="Invented citations dropped" value={m.dropped} />
              <Small label="Added by engineers" value={m.manual} />
              <Small label="Median draft to decision" value={m.medianReviewSeconds == null ? "–" : fmtDuration(m.medianReviewSeconds)} />
            </dl>
            <p className="caption mt-3 max-w-[70ch]">Corrected and rejected drafts are errors an engineer caught. Compare with a manual timeline of the same case to judge the time saved.</p>
          </details>
        </div>
      </section>

      <aside className="grid content-start gap-3">
        <div className="card grid gap-3 p-5">
          <h2 className="h-section">Case settings</h2>
          <Row label="Responsible engineer" value={engineers.find((e) => e.id === c.responsibleEngineerId)?.name ?? "Not assigned"} />
          <Row label="Training use" value={c.trainingPermitted ? "Permitted" : "Not permitted"} />
          <Row label="Status" value={c.status === "open" ? "Open" : "Closed"} />
        </div>

        {can(role, "case.edit") && writable && (
          <Panel title="Edit case details">
            <ActionForm action={updateCaseAction} className="grid gap-3">
              {hidden}
              <label className="field"><span>Title</span><input className="input" name="title" defaultValue={c.title} required /></label>
              <label className="field"><span>Aircraft or equipment</span><input className="input" name="aircraft" defaultValue={c.aircraft} required /></label>
              <label className="field"><span>System</span><input className="input" name="system" defaultValue={c.system} /></label>
              <label className="field"><span>Unresolved question</span><textarea className="input" name="question" defaultValue={c.question} required /></label>
              <label className="field"><span>Evidence cutoff</span><input className="input" type="date" name="evidenceCutoff" defaultValue={c.evidenceCutoff ?? ""} /></label>
              <p className="caption">Changing the question or cutoff sends assessed explanations back for reassessment.</p>
              <div><Submit>Save details</Submit></div>
            </ActionForm>
          </Panel>
        )}

        {can(role, "case.assign") && writable && (
          <Panel title="Responsible engineer">
            <ActionForm action={assignAction} className="grid gap-2">
              {hidden}
              <select className="input" name="userId" defaultValue={c.responsibleEngineerId ?? ""} aria-label="Responsible engineer">
                {engineers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <p className="caption">With independent review on, this person cannot approve the handover.</p>
              <div><Submit className="btn btn-sm">Assign</Submit></div>
            </ActionForm>
          </Panel>
        )}

        {can(role, "training.manage") && (
          <Panel title="Training use">
            <p className="caption mb-2">
              {c.trainingPermitted
                ? `Engineer-checked labels from this case may train ARROVEN's own models. Basis: ${c.trainingBasis}`
                : "This case is left out of every training export until a permission and its basis are recorded."}
            </p>
            <ActionForm action={trainingPermissionAction} className="grid gap-2" quiet>
              {hidden}
              <input type="hidden" name="permitted" value={c.trainingPermitted ? "no" : "yes"} />
              {!c.trainingPermitted && <input className="input" name="basis" placeholder="Basis, e.g. Pilot agreement clause 6.3" aria-label="Basis for training use" required minLength={5} />}
              <div><Submit className={`btn btn-sm ${c.trainingPermitted ? "btn-bad" : "btn-good"}`}>{c.trainingPermitted ? "Withdraw training use" : "Record training permission"}</Submit></div>
            </ActionForm>
          </Panel>
        )}

        <Panel title={`Model runs${runs.length ? ` (${runs.length})` : ""}`}>
          {!runs.length && <p className="caption">No model runs on this case yet.</p>}
          <ul className="grid gap-2">
            {runs.slice(0, 8).map((r) => (
              <li key={r.id} className="grid gap-0.5 text-[13px]">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`pill ${r.status === "succeeded" ? "pill-good" : r.status === "failed" ? "pill-bad" : "pill-amber"}`}>{r.status}</span>
                  <span>{r.kind === "chronology" ? "Chronology" : r.kind === "analysis" ? "Compare and propose" : "Evidence"}</span>
                </span>
                <span className="caption">{r.status === "succeeded" ? `${r.produced} produced, ${r.dropped} dropped` : r.error ?? ""} · {r.model} · {utcStamp(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>

        {can(role, "handover.approve") && (
          <Panel title={c.status === "open" ? "Close case" : "Reopen case"}>
            <ActionForm action={caseStatusAction} className="grid gap-2" quiet>
              {hidden}
              <p className="caption">{c.status === "open" ? "A closed case is read-only. Approved handovers stay available." : "Reopening allows changes and a new handover version."}</p>
              <div>
                {c.status === "open"
                  ? <ConfirmSubmit className="btn btn-sm" confirmText="Close case" name="status" value="closed">Close case</ConfirmSubmit>
                  : <button className="btn btn-sm" name="status" value="open">Reopen case</button>}
              </div>
            </ActionForm>
          </Panel>
        )}
      </aside>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="card group px-5 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-medium">
        {title}
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="mt-3 pb-1">{children}</div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[26px] font-semibold tabular-nums leading-none">{value}</span>
      <span className="caption">{label}</span>
    </div>
  );
}

function Small({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="grid">
      <dt className="caption">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2 text-[13.5px] first-of-type:border-0 first-of-type:pt-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function fmtDuration(s: number) {
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
