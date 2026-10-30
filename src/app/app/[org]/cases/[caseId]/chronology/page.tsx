import Link from "next/link";
import { requireOrg } from "@/server/session";
import { caseFlags, caseStatements, loadCase, openRunsForCase } from "@/server/services/cases";
import { can } from "@/server/permissions";
import { STATEMENT_KINDS } from "@/server/db/schema";
import { KIND_LABELS, STATUS_LABELS, lineAnchor, logDate } from "@/lib/labels";
import { providerLabel } from "@/server/ai/label";
import { latestRuns } from "@/server/ai/runs";
import { ActionForm, Submit } from "@/components/forms";
import { AiRunButton } from "@/components/ai-run";
import { addStatementAction, flagAction, recheckAction, reviewAction } from "@/app/actions";

export const metadata = { title: "Chronology" };

const STATUS_PILL: Record<string, string> = { unreviewed: "pill-amber", accepted: "pill-good", edited: "pill-accent", rejected: "pill-bad" };
const STATUS_EDGE: Record<string, string> = { unreviewed: "border-l-amber", accepted: "border-l-good", edited: "border-l-accent", rejected: "border-l-bad opacity-60" };

export default async function Chronology({ params, searchParams }: { params: Promise<{ org: string; caseId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { org: slug, caseId } = await params;
  const { status: filter = "all" } = await searchParams;
  const { ctx, role } = await requireOrg(slug);
  const [c, stmts, fl, active, runs] = await Promise.all([loadCase(ctx, caseId), caseStatements(ctx, caseId), caseFlags(ctx, caseId), openRunsForCase(ctx, caseId), latestRuns(ctx, caseId)]);
  const lastChron = runs.find((r) => r.kind === "chronology" && r.status === "succeeded");
  const base = `/app/${slug}/cases/${caseId}`;
  const canReview = can(role, "statement.review") && c.status === "open";
  const shown = filter === "all" ? stmts : filter === "recheck" ? stmts.filter((s) => s.needsReassessment && s.status !== "rejected") : stmts.filter((s) => s.status === filter);
  const recheckCount = stmts.filter((s) => s.needsReassessment && s.status !== "rejected").length;
  const afterCutoff = (d: string | null) => !!(c.evidenceCutoff && d && d > c.evidenceCutoff);
  const count = (st: string) => stmts.filter((s) => s.status === st).length;
  const hidden = (<><input type="hidden" name="org" value={slug} /><input type="hidden" name="caseId" value={caseId} /></>);
  const activeRun = active.find((r) => r.kind === "chronology");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="grid content-start gap-4">
        {can(role, "ai.run") && c.status === "open" && (
          <div className="card grid gap-1.5 px-5 py-4">
            <AiRunButton org={slug} caseId={caseId} kind="chronology" label={stmts.length ? "Redraft unreviewed statements" : "Draft chronology with AI"} activeRunId={activeRun?.id} providerLabel={providerLabel()} />
            <p className="caption">Reads only current, authorised records. A redraft never touches checked statements.</p>
            {lastChron?.coverage?.excluded.length ? (
              <p className="msg-info">The last draft did not read {lastChron.coverage.excluded.map((x) => `${x.code} (${x.reason})`).join(", ")}. This chronology is incomplete for those records.</p>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <h2 className="h-section mr-3">Draft chronology</h2>
          {[["all", `All ${stmts.length}`], ...(recheckCount ? [["recheck", `To re-check ${recheckCount}`]] : []), ["unreviewed", `Unreviewed ${count("unreviewed")}`], ["accepted", `Accepted ${count("accepted")}`], ["edited", `Edited ${count("edited")}`], ["rejected", `Rejected ${count("rejected")}`]].map(([k, label]) => (
            <Link key={k} href={k === "all" ? `${base}/chronology` : `${base}/chronology?status=${k}`} className={`btn btn-sm ${filter === k ? "border-accent text-accent" : ""}`}>{label}</Link>
          ))}
        </div>

        {!stmts.length && <div className="card p-6 caption">No statements yet. Import records on the Sources tab, then draft the chronology.</div>}
        {stmts.length > 0 && !shown.length && <p className="caption">No statements match this filter.</p>}

        <ol className="grid gap-3">
          {shown.map((s) => (
            <li key={s.id} id={s.code} className={`card grid gap-2 border-l-4 px-4 py-3 ${STATUS_EDGE[s.status]}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="mono text-[12.5px] font-medium">{logDate(s.eventDate)}</span>
                <span className={`eyebrow ${s.kind === "action_planned" ? "text-amber" : ""}`}>{KIND_LABELS[s.kind]}</span>
                <Link className="loc" href={`${base}/sources#${lineAnchor(s.locator)}`} title="Show the original line">{s.locator}</Link>
                <span className={`pill ${STATUS_PILL[s.status]}`}>{STATUS_LABELS[s.status]}</span>
                {s.needsReassessment && s.status !== "rejected" && <span className="pill pill-bad">Re-check</span>}
                {afterCutoff(s.eventDate) && <span className="pill pill-inc" title="Dated after the case's evidence cutoff">After cutoff</span>}
                <span className="caption ml-auto">{s.code} · {s.origin === "ai" ? "AI draft" : "added by engineer"}</span>
              </div>
              <p className={`text-[14px] ${s.status === "rejected" ? "line-through" : ""}`}>{s.text}</p>
              {s.conditions && <p className="caption">Conditions: {s.conditions}</p>}
              {s.uncertain && <p className="text-[12.5px] text-amber">Uncertain reading: {s.uncertainNote}</p>}
              {s.text !== s.draftText && <p className="caption">AI draft read: “{s.draftText}”</p>}
              {s.needsReassessment && s.status !== "rejected" && <p className="text-[12.5px] font-medium text-bad">{s.reassessReason}</p>}
              {canReview && s.needsReassessment && s.status !== "rejected" && (
                <ActionForm action={recheckAction} className="grid gap-2 rounded-md border border-line bg-sunk p-2" quiet>
                  {hidden}
                  <input type="hidden" name="statementId" value={s.id} />
                  <span className="eyebrow">Re-check against the current record</span>
                  <div className="flex flex-wrap gap-2">
                    <input className="input mono w-32" name="locator" defaultValue={s.locator} aria-label="Locator in the current record" required />
                    <input className="input min-w-0 flex-1" name="text" defaultValue={s.text} aria-label="Statement as it reads in the current record" required />
                  </div>
                  <input className="input" name="conditions" defaultValue={s.conditions} placeholder="Conditions, if the record states them" aria-label="Conditions as stated in the current record" />
                  <p className="caption">Cite the matching line in the current copy, and correct the wording and conditions if the record changed. If nothing matches any more, reject the statement instead.</p>
                  <div><Submit className="btn btn-sm btn-primary">Confirm re-check</Submit></div>
                </ActionForm>
              )}
              {canReview && (() => {
                const correct = (
                  <ActionForm action={reviewAction} className="mt-2 grid gap-2" quiet>
                    {hidden}
                    <input type="hidden" name="statementId" value={s.id} />
                    <input type="hidden" name="verdict" value="accept" />
                    <textarea className="input" name="text" defaultValue={s.text} aria-label={`Corrected wording for ${s.code}`} />
                    <div><Submit className="btn btn-sm btn-primary">Save corrected wording</Submit></div>
                  </ActionForm>
                );
                return s.status === "unreviewed" ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <ActionForm action={reviewAction} className="flex flex-wrap gap-2" quiet>
                      {hidden}
                      <input type="hidden" name="statementId" value={s.id} />
                      <Submit className="btn btn-sm btn-primary" name="verdict" value="accept" pendingText="…">Accept</Submit>
                      <Submit className="btn btn-sm" name="verdict" value="reject" pendingText="…">Reject</Submit>
                    </ActionForm>
                    <details className="basis-full sm:basis-auto">
                      <summary className="btn btn-sm list-none">Correct wording</summary>
                      {correct}
                    </details>
                  </div>
                ) : (
                  <details>
                    <summary className="cursor-pointer list-none text-[12.5px] text-muted hover:text-accent">Change decision</summary>
                    <div className="mt-2 grid gap-2">
                      <ActionForm action={reviewAction} className="flex flex-wrap gap-2" quiet>
                        {hidden}
                        <input type="hidden" name="statementId" value={s.id} />
                        {s.status !== "rejected" && <Submit className="btn btn-sm btn-bad" name="verdict" value="reject" pendingText="…">Reject</Submit>}
                        <Submit className="btn btn-sm" name="verdict" value="reset" pendingText="…">Back to unreviewed</Submit>
                      </ActionForm>
                      {s.status !== "rejected" && correct}
                    </div>
                  </details>
                );
              })()}
            </li>
          ))}
        </ol>
      </section>

      <aside className="grid content-start gap-3">
        {(() => {
          const open = fl.filter((f) => f.status === "open");
          const decided = fl.filter((f) => f.status !== "open");
          const canDecide = can(role, "question.write") && c.status === "open";
          const refs = (f: (typeof fl)[number]) => (
            <span className="flex flex-wrap gap-1">
              {f.refs.map((r) => <Link key={r} className="loc" href={r.includes(":") ? `${base}/sources#${lineAnchor(r)}` : `${base}/sources#${r}`}>{r}</Link>)}
            </span>
          );
          return (
            <div className="card">
              <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                <h2 className="h-section">Conflicts and gaps</h2>
                <span className="caption">{open.length} to decide</span>
              </div>
              {!fl.length && <p className="caption px-4 py-3">None yet. The models flag records that disagree and evidence that is missing or untested.</p>}
              {fl.length > 0 && !open.length && <p className="px-4 py-3 text-[13.5px] text-good">All flags decided.</p>}
              <ul className="divide-y divide-line">
                {open.map((f) => (
                  <li key={f.id} className="grid gap-1.5 px-4 py-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`pill ${f.type === "conflict" ? "pill-bad" : "pill-amber"}`}>{f.type === "conflict" ? "Conflict" : "Gap"}</span>
                      {refs(f)}
                    </span>
                    <p className="text-[13.5px]">{f.text}</p>
                    {canDecide && (
                      <ActionForm action={flagAction} className="flex gap-3" quiet>
                        {hidden}
                        <input type="hidden" name="flagId" value={f.id} />
                        <Submit className="text-[12.5px] font-medium text-accent hover:underline" name="decision" value="question" pendingText="…">Add to questions</Submit>
                        <Submit className="text-[12.5px] text-muted hover:underline" name="decision" value="dismiss" pendingText="…">Dismiss</Submit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
              {decided.length > 0 && (
                <details className="border-t border-line">
                  <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-muted hover:text-accent">Decided ({decided.length}) ›</summary>
                  <ul className="divide-y divide-line">
                    {decided.map((f) => (
                      <li key={f.id} className="grid gap-1 px-4 py-2.5 text-[13px] text-muted">
                        <span>{f.text}</span>
                        <span className="flex flex-wrap items-center gap-3 text-[12px]">
                          {f.status === "question" ? "Added to questions" : "Dismissed"}
                          {canDecide && (
                            <ActionForm action={flagAction} quiet>
                              {hidden}
                              <input type="hidden" name="flagId" value={f.id} />
                              <Submit className="text-accent hover:underline" name="decision" value="reopen" pendingText="…">Reopen</Submit>
                            </ActionForm>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })()}

        {canReview && (
          <details className="card px-4 py-3">
            <summary className="cursor-pointer text-[13.5px] font-medium">Add a statement yourself ›</summary>
            <ActionForm action={addStatementAction} className="mt-3 grid gap-2" reset>
              {hidden}
              <div className="grid grid-cols-2 gap-2">
                <label className="field"><span>Locator</span><input className="input mono" name="locator" placeholder="S2:3" required /></label>
                <label className="field"><span>Date</span><input className="input" type="date" name="eventDate" /></label>
              </div>
              <label className="field"><span>Type</span>
                <select className="input" name="kind" defaultValue="report">{STATEMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select>
              </label>
              <label className="field"><span>Statement</span><textarea className="input" name="text" required /></label>
              <label className="field"><span>Conditions</span><input className="input" name="conditions" placeholder="Ground, +16 C, idle" /></label>
              <div><Submit>Add checked statement</Submit></div>
            </ActionForm>
          </details>
        )}
      </aside>
    </div>
  );
}
