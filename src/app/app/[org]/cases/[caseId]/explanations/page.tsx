import Link from "next/link";
import { requireOrg } from "@/server/session";
import { caseHypotheses, caseStatements, hypothesisEvidence, loadCase, openRunsForCase } from "@/server/services/cases";
import { can } from "@/server/permissions";
import { ASSESSMENTS, RELATIONS } from "@/server/db/schema";
import { ASSESSMENT_LABELS, RELATION_LABELS, lineAnchor, logDate } from "@/lib/labels";
import { providerLabel } from "@/server/ai/label";
import { ActionForm, Submit } from "@/components/forms";
import { AiRunButton } from "@/components/ai-run";
import { assessAction, clearDecisionAction, createHypothesisAction, decisionAction, gapAction } from "@/app/actions";

export const metadata = { title: "Explanations" };

const ASSESS_PILL: Record<string, string> = { not_assessed: "pill-inc", unresolved: "pill-amber", consistent: "pill-good", not_consistent: "pill-bad" };
const REL_PILL: Record<string, string> = { supports: "pill-good", challenges: "pill-bad", inconclusive: "pill-inc", not_relevant: "pill-inc" };

export default async function Explanations({ params, searchParams }: { params: Promise<{ org: string; caseId: string }>; searchParams: Promise<{ h?: string; all?: string }> }) {
  const { org: slug, caseId } = await params;
  const { h: hCode, all } = await searchParams;
  const { ctx, role } = await requireOrg(slug);
  const [c, hs, stmts, active] = await Promise.all([loadCase(ctx, caseId), caseHypotheses(ctx, caseId), caseStatements(ctx, caseId), openRunsForCase(ctx, caseId)]);
  const base = `/app/${slug}/cases/${caseId}`;
  const selected = hs.find((h) => h.code === hCode) ?? hs[0];
  const writable = c.status === "open";
  const hidden = (<><input type="hidden" name="org" value={slug} /><input type="hidden" name="caseId" value={caseId} /></>);

  const ev = selected ? await hypothesisEvidence(ctx, caseId, selected.id) : null;
  const sugBy = new Map(ev?.suggestions.map((s) => [s.statementId, s]) ?? []);
  const decBy = new Map(ev?.decisions.map((d) => [d.statementId, d]) ?? []);
  const isChecked = (s: (typeof stmts)[number]) => (s.status === "accepted" || s.status === "edited") && !s.needsReassessment;
  const checked = stmts.filter(isChecked);
  const rows = stmts.filter((s) => sugBy.has(s.id) || decBy.has(s.id) || (all && isChecked(s)));
  const toDecide = rows.filter((s) => !decBy.has(s.id) && isChecked(s)).length;
  const unchecked = stmts.filter((s) => s.status === "unreviewed").length;
  const activeRun = active.find((r) => r.kind === "evidence" && r.targetId === selected?.id);
  const canDecide = can(role, "decision.write") && writable;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="grid content-start gap-3">
        <div className="card">
          <div className="border-b border-line px-4 py-3"><h2 className="h-section">Explanations</h2></div>
          {!hs.length && <p className="caption px-4 py-3">None yet. Write the explanations you want to test against the record.</p>}
          <ul className="divide-y divide-line">
            {hs.map((h) => {
              const on = h.id === selected?.id;
              return (
                <li key={h.id}>
                  <Link href={`${base}/explanations?h=${h.code}`} aria-current={on ? "true" : undefined}
                    className={`grid gap-0.5 px-4 py-3 ${on ? "bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-sunk"}`}>
                    <span className="flex items-center gap-2 text-[13.5px] font-medium">
                      <span className="mono text-[11.5px] text-accent">{h.code}</span>
                      <span className="min-w-0 truncate">{h.title}</span>
                      {h.needsReassessment && <span className="ml-auto h-2 w-2 flex-none rounded-full bg-bad" title="Needs reassessment" />}
                    </span>
                    <span className="caption">{ASSESSMENT_LABELS[h.assessment]} · {h.tally.supports} for, {h.tally.challenges} against, {h.tally.inconclusive} unclear</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {can(role, "hypothesis.write") && writable && (
            <details className="border-t border-line" open={!hs.length}>
              <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium text-accent">+ Add an explanation</summary>
              <ActionForm action={createHypothesisAction} className="grid gap-2 px-4 pb-4" reset>
                {hidden}
                <input className="input" name="title" maxLength={120} placeholder="Short title" aria-label="Short title" required />
                <textarea className="input" name="text" placeholder="The explanation, in your words" aria-label="Explanation" required />
                <div><Submit className="btn btn-sm btn-primary">Add</Submit></div>
              </ActionForm>
            </details>
          )}
        </div>
      </aside>

      {selected && ev ? (
        <section className="grid min-w-0 content-start gap-4">
          <div className="card grid gap-3 p-5">
            <div className="grid gap-1">
              <span className="caption">{selected.code} · {selected.origin === "ai_proposal" ? "adopted from a model proposal" : "written by an engineer"}</span>
              <h2 className="text-[20px] font-semibold leading-snug">{selected.title}</h2>
              <p className="max-w-[75ch] text-[14.5px]">{selected.text}</p>
            </div>

            <div className="grid gap-1.5 rounded-lg bg-sunk px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">Assessment</span>
                <span className={`pill ${ASSESS_PILL[selected.assessment]}`}>{ASSESSMENT_LABELS[selected.assessment]}</span>
                {selected.needsReassessment && <span className="pill pill-bad">Needs reassessment</span>}
              </div>
              {selected.needsReassessment && <p className="text-[13px] text-bad">{selected.reassessReason}</p>}
              {selected.assessmentNote && <p className="text-[13.5px]">{selected.assessmentNote}</p>}
              {canDecide && (
                <details open={selected.needsReassessment}>
                  <summary className="cursor-pointer text-[13px] font-medium text-accent hover:underline">{selected.assessment === "not_assessed" ? "Assess this explanation" : "Change the assessment"}</summary>
                  <ActionForm action={assessAction} className="mt-2 grid gap-2" quiet>
                    {hidden}
                    <input type="hidden" name="hypothesisId" value={selected.id} />
                    <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                      <legend className="sr-only">Assessment of {selected.code}</legend>
                      {ASSESSMENTS.filter((a) => a !== "not_assessed").map((a) => (
                        <label key={a} className="inline-flex items-center gap-1.5 text-[13px]">
                          <input type="radio" name="assessment" value={a} defaultChecked={selected.assessment === a} required /> {ASSESSMENT_LABELS[a]}
                        </label>
                      ))}
                    </fieldset>
                    <textarea className="input" name="note" defaultValue={selected.assessmentNote ?? ""} placeholder="What the evidence does and does not establish (required)" required minLength={10} />
                    <p className="caption">Not a root-cause finding, and not a maintenance instruction.</p>
                    <div><Submit className="btn btn-sm btn-primary">Save assessment</Submit></div>
                  </ActionForm>
                </details>
              )}
            </div>

            {can(role, "ai.run") && writable && (
              <AiRunButton org={slug} caseId={caseId} kind="evidence" hypothesisId={selected.id} label="Find evidence" activeRunId={activeRun?.id} disabled={!checked.length} providerLabel={providerLabel()} />
            )}
            {unchecked > 0 && <p className="caption">{unchecked} statement{unchecked > 1 ? "s are" : " is"} not checked yet and can&apos;t be used as evidence.</p>}
          </div>

          <div className="card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
              <h3 className="h-section">Evidence</h3>
              <span className="flex items-baseline gap-3">
                {toDecide > 0 && <span className="caption">{toDecide} to decide</span>}
                <Link className="text-[13px] text-accent hover:underline" href={`${base}/explanations?h=${selected.code}${all ? "" : "&all=1"}`}>{all ? "Show suggested only" : "Show all checked statements"}</Link>
              </span>
            </div>
            {!rows.length && <p className="caption px-5 py-4">No evidence yet. Use Find evidence, or show all checked statements and decide directly.</p>}
            <ul className="divide-y divide-line">
              {rows.map((s) => {
                const sug = sugBy.get(s.id);
                const dec = decBy.get(s.id);
                const usable = isChecked(s);
                const form = (
                  <ActionForm action={decisionAction} className="mt-2 grid gap-2" quiet>
                    {hidden}
                    <input type="hidden" name="hypothesisId" value={selected.id} />
                    <input type="hidden" name="statementId" value={s.id} />
                    <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                      <legend className="sr-only">What {s.code} means for {selected.code}</legend>
                      {RELATIONS.map((r) => (
                        <label key={r} className="inline-flex items-center gap-1.5 text-[13px]">
                          <input type="radio" name="relation" value={r} defaultChecked={dec?.relation === r} required /> {RELATION_LABELS[r]}
                        </label>
                      ))}
                    </fieldset>
                    <input className="input" name="reason" defaultValue={dec?.reason} placeholder="Why, in your words (required)" aria-label="Reason" required minLength={5} />
                    <div><Submit className="btn btn-sm btn-primary">Save decision</Submit></div>
                  </ActionForm>
                );
                return (
                  <li key={s.id} className="grid gap-1.5 px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <span className="mono text-muted">{s.code} · {logDate(s.eventDate)}</span>
                      <Link className="loc" href={`${base}/sources#${lineAnchor(s.locator)}`}>{s.locator}</Link>
                      {dec && <span className={`pill ${REL_PILL[dec.relation]}`}>{RELATION_LABELS[dec.relation]}</span>}
                      {s.needsReassessment && <span className="pill pill-bad">Re-check first</span>}
                    </div>
                    <p className="text-[14px]">{s.text}{s.conditions && <span className="text-muted"> ({s.conditions})</span>}</p>
                    {dec && <p className="text-[13.5px]"><span className="text-muted">Your reason:</span> {dec.reason} <span className="caption">({dec.decidedByName})</span></p>}
                    {sug && !dec && (
                      <p className="text-[13px] text-muted">
                        Model suggests <span className="font-medium">{RELATION_LABELS[sug.relation].toLowerCase()}</span>: {sug.rationale}{sug.caveat && ` ${sug.caveat}`}
                      </p>
                    )}
                    {canDecide && usable && (dec ? (
                      <div className="flex flex-wrap items-start gap-3">
                        <details>
                          <summary className="cursor-pointer text-[12.5px] text-muted hover:text-accent">Change</summary>
                          {form}
                        </details>
                        <ActionForm action={clearDecisionAction} quiet>
                          {hidden}
                          <input type="hidden" name="hypothesisId" value={selected.id} />
                          <input type="hidden" name="statementId" value={s.id} />
                          <Submit className="text-[12.5px] text-muted hover:text-bad" pendingText="…">Clear</Submit>
                        </ActionForm>
                      </div>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-[13px] font-medium text-accent hover:underline">Decide</summary>
                        {form}
                      </details>
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>

          {ev.gaps.length > 0 && (
            <div className="card">
              <div className="border-b border-line px-5 py-3"><h3 className="h-section">Evidence that would help and isn&apos;t in the record</h3></div>
              <ul className="divide-y divide-line">
                {ev.gaps.map((g) => (
                  <li key={g.id} className="grid gap-1 px-5 py-3">
                    <span className="text-[14px]">{g.text}</span>
                    {can(role, "question.write") && writable && (
                      <ActionForm action={gapAction} className="flex gap-3" quiet>
                        {hidden}
                        <input type="hidden" name="gapId" value={g.id} />
                        <Submit className="text-[12.5px] font-medium text-accent hover:underline" name="decision" value="question" pendingText="…">Add to questions</Submit>
                        <Submit className="text-[12.5px] text-muted hover:underline" name="decision" value="dismiss" pendingText="…">Dismiss</Submit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="caption">A citation shows where a statement came from, not that it is physically correct.</p>
        </section>
      ) : (
        <section className="card p-8 text-center caption">Add an explanation to start testing it against the evidence.</section>
      )}
    </div>
  );
}
