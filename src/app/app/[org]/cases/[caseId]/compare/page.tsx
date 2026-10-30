import Link from "next/link";
import { requireOrg } from "@/server/session";
import { caseComparisons, caseProposals, caseStatements, loadCase, openRunsForCase } from "@/server/services/cases";
import { can } from "@/server/permissions";
import { providerLabel } from "@/server/ai/label";
import { ActionForm, Submit } from "@/components/forms";
import { AiRunButton } from "@/components/ai-run";
import { comparisonAction, proposalAction } from "@/app/actions";

export const metadata = { title: "Compare" };

const FINDING: Record<string, [string, string]> = {
  agree: ["Records agree", "pill-good"],
  differ: ["Records differ", "pill-bad"],
  cannot_compare: ["Can't be compared", "pill-inc"],
};
const DECIDED: Record<string, string> = { adopted: "Adopted", rejected: "Rejected", unresolved: "Left unresolved", question: "Added to questions", dismissed: "Dismissed" };

export default async function Compare({ params }: { params: Promise<{ org: string; caseId: string }> }) {
  const { org: slug, caseId } = await params;
  const { ctx, role } = await requireOrg(slug);
  const [c, cmps, props, stmts, active] = await Promise.all([loadCase(ctx, caseId), caseComparisons(ctx, caseId), caseProposals(ctx, caseId), caseStatements(ctx, caseId), openRunsForCase(ctx, caseId)]);
  const base = `/app/${slug}/cases/${caseId}`;
  const writable = c.status === "open";
  const byCode = new Map(stmts.map((s) => [s.code, s]));
  const checked = stmts.filter((s) => (s.status === "accepted" || s.status === "edited") && !s.needsReassessment).length;
  const hidden = (<><input type="hidden" name="org" value={slug} /><input type="hidden" name="caseId" value={caseId} /></>);
  const chips = (codes: string[]) => (
    <span className="flex flex-wrap gap-1">
      {codes.map((code) => <Link key={code} href={`${base}/chronology#${code}`} className="loc" title={byCode.get(code)?.text}>{code}</Link>)}
    </span>
  );

  const openCmps = cmps.filter((x) => x.status === "open");
  const doneCmps = cmps.filter((x) => x.status !== "open");
  const openProps = props.filter((p) => p.status === "proposed" || p.status === "unresolved");
  const doneProps = props.filter((p) => p.status === "adopted" || p.status === "rejected");
  const canQuestion = can(role, "question.write") && writable;

  return (
    <div className="grid gap-4">
      {can(role, "ai.run") && writable && (
        <div className="card grid gap-1.5 px-5 py-4">
          <AiRunButton org={slug} caseId={caseId} kind="analysis" label={cmps.length || props.length ? "Compare and propose again" : "Compare and propose"}
            activeRunId={active.find((r) => r.kind === "analysis")?.id} disabled={!checked} providerLabel={providerLabel()} />
          <p className="caption">{checked ? "Uses only checked statements from authorised records. Everything below is a proposal until an engineer decides." : "Check statements on the Chronology tab first."}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card self-start">
          <div className="flex items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="h-section">Comparisons</h2>
            <span className="caption">{openCmps.length} to decide</span>
          </div>
          {!cmps.length && <p className="caption px-5 py-4">None yet.</p>}
          {cmps.length > 0 && !openCmps.length && <p className="px-5 py-3 text-[13.5px] text-good">All comparisons decided.</p>}
          <ul className="divide-y divide-line">
            {openCmps.map((x) => (
              <li key={x.id} className="grid gap-1.5 px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`pill ${FINDING[x.finding][1]}`}>{FINDING[x.finding][0]}</span>
                  {chips(x.statements)}
                </div>
                <p className="text-[14px] font-medium">{x.title}</p>
                <p className="text-[13.5px] text-muted">{x.note}</p>
                {canQuestion && (
                  <ActionForm action={comparisonAction} className="flex gap-3" quiet>
                    {hidden}
                    <input type="hidden" name="comparisonId" value={x.id} />
                    <Submit className="text-[12.5px] font-medium text-accent hover:underline" name="decision" value="question" pendingText="…">Add to questions</Submit>
                    <Submit className="text-[12.5px] text-muted hover:underline" name="decision" value="dismiss" pendingText="…">Dismiss</Submit>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          {doneCmps.length > 0 && (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-5 py-2.5 text-[13px] text-muted hover:text-accent">Decided ({doneCmps.length}) ›</summary>
              <ul className="divide-y divide-line">
                {doneCmps.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]">
                    <span className="min-w-0 flex-1 text-muted">{x.title}</span>
                    <span className="text-[12px] text-muted">{DECIDED[x.status]}</span>
                    {canQuestion && (
                      <ActionForm action={comparisonAction} quiet>
                        {hidden}
                        <input type="hidden" name="comparisonId" value={x.id} />
                        <Submit className="text-[12px] text-accent hover:underline" name="decision" value="reopen" pendingText="…">Reopen</Submit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="card self-start">
          <div className="flex items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="h-section">Proposals</h2>
            <span className="caption">{openProps.filter((p) => p.status === "proposed").length} to review</span>
          </div>
          {!props.length && <p className="caption px-5 py-4">None yet.</p>}
          <ul className="divide-y divide-line">
            {openProps.map((p) => {
              const may = writable && can(role, p.kind === "explanation" ? "hypothesis.write" : "question.write");
              return (
                <li key={p.id} className="grid gap-1.5 px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="pill pill-accent">{p.kind === "explanation" ? "Explanation" : "Question"}</span>
                    {p.status === "unresolved" && <span className="pill pill-inc">Left unresolved</span>}
                    {p.basis.length > 0 && chips(p.basis)}
                  </div>
                  {p.kind === "explanation" && <p className="text-[14px] font-medium">{p.title}</p>}
                  <p className="text-[13.5px]">{p.text}</p>
                  {p.uncertainty && <p className="text-[13px] text-muted">Uncertain: {p.uncertainty}</p>}
                  {p.decisionNote && <p className="text-[13px] text-muted">Engineer: {p.decisionNote}</p>}
                  {may && (
                    <div className="flex flex-wrap items-start gap-4">
                      <details>
                        <summary className="cursor-pointer text-[12.5px] font-medium text-accent hover:underline">Adopt</summary>
                        <ActionForm action={proposalAction} className="mt-2 grid gap-2" quiet>
                          {hidden}
                          <input type="hidden" name="proposalId" value={p.id} />
                          <input type="hidden" name="decision" value="adopted" />
                          {p.kind === "explanation" && <input className="input" name="title" defaultValue={p.title} aria-label="Title" required />}
                          <textarea className="input" name="text" defaultValue={p.text} aria-label={p.kind === "explanation" ? "Explanation, in your words" : "Question"} required />
                          <div><Submit className="btn btn-sm btn-primary">{p.kind === "explanation" ? "Adopt as explanation" : "Adopt as question"}</Submit></div>
                        </ActionForm>
                      </details>
                      <details>
                        <summary className="cursor-pointer text-[12.5px] text-muted hover:underline">Reject or leave unresolved</summary>
                        <ActionForm action={proposalAction} className="mt-2 grid gap-2" quiet>
                          {hidden}
                          <input type="hidden" name="proposalId" value={p.id} />
                          <input className="input" name="note" placeholder="Why (required)" aria-label="Reason" required minLength={5} />
                          <div className="flex gap-2">
                            <Submit className="btn btn-sm btn-bad" name="decision" value="rejected" pendingText="…">Reject</Submit>
                            <Submit className="btn btn-sm" name="decision" value="unresolved" pendingText="…">Leave unresolved</Submit>
                          </div>
                        </ActionForm>
                      </details>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {doneProps.length > 0 && (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-5 py-2.5 text-[13px] text-muted hover:text-accent">Decided ({doneProps.length}) ›</summary>
              <ul className="divide-y divide-line">
                {doneProps.map((p) => (
                  <li key={p.id} className="grid gap-0.5 px-5 py-2.5 text-[13px]">
                    <span className="flex flex-wrap items-baseline gap-x-3">
                      <span className="min-w-0 flex-1 text-muted">{p.kind === "explanation" ? p.title : p.text}</span>
                      <span className="text-[12px] text-muted">{DECIDED[p.status]}</span>
                    </span>
                    {p.decisionNote && <span className="text-[12.5px] text-muted">Engineer: {p.decisionNote}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
