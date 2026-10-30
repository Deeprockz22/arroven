import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireOrg } from "@/server/session";
import { caseQuestions, handoverData, handoverVersionsFor, loadCase } from "@/server/services/cases";
import { organizations } from "@/server/db/schema";
import { can } from "@/server/permissions";
import { readiness, renderHandover } from "@/lib/handover";
import { utcStamp } from "@/lib/labels";
import { ActionForm, CopyButton, Submit } from "@/components/forms";
import { addQuestionAction, answerQuestionAction, approveAction } from "@/app/actions";

export const metadata = { title: "Review" };

export default async function Review({ params, searchParams }: { params: Promise<{ org: string; caseId: string }>; searchParams: Promise<{ v?: string }> }) {
  const { org: slug, caseId } = await params;
  const { v } = await searchParams;
  const { ctx, role, org } = await requireOrg(slug);
  const [c, qs, data, versions] = await Promise.all([loadCase(ctx, caseId), caseQuestions(ctx, caseId), handoverData(ctx, caseId), handoverVersionsFor(ctx, caseId)]);
  const [orgRow] = await ctx.db.select().from(organizations).where(eq(organizations.id, org.id));
  const hidden = (<><input type="hidden" name="org" value={slug} /><input type="hidden" name="caseId" value={caseId} /></>);
  const writable = c.status === "open";
  const latest = versions[0]?.version ?? 0;
  const viewing = v ? versions.find((x) => String(x.version) === v) : undefined;
  const doc = viewing ? viewing.markdown : renderHandover(data, null);
  const independentBlock = orgRow.requireIndependentReview && (c.responsibleEngineerId ?? c.createdBy) === ctx.userId;
  const checks = readiness(data);
  const blocked = checks.some((r) => r.block && !r.ok);
  const nothingChanged = latest > 0 && !c.changedSinceApproval;

  const todo = checks.filter((r) => !r.ok);
  const openQs = qs.filter((q) => q.status === "open");
  const answered = qs.filter((q) => q.status === "answered");
  const canWrite = can(role, "question.write") && writable;
  const origin = (q: (typeof qs)[number]) =>
    q.origin === "engineer" ? "Added by an engineer" : q.origin === "flag" ? `From flag ${q.originRef}` : q.origin === "comparison" ? `From comparison ${q.originRef}` : q.origin === "ai_proposal" ? `From proposal ${q.originRef}` : `From the evidence search on ${q.originRef}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section className="grid content-start gap-4">
        <div className="card grid gap-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="h-section">Approve the handover</h2>
            <span className="caption">{checks.length - todo.length} of {checks.length} checks pass</span>
          </div>
          {latest > 0 && c.changedSinceApproval && <p className="text-[13.5px]">The case changed after v{latest} was approved. Approving issues v{latest + 1}; v{latest} stays as it was.</p>}
          {todo.length > 0 && (
            <ul className="grid gap-2">
              {todo.map((r) => (
                <li key={r.text} className="flex gap-2.5 text-[13.5px]">
                  <span aria-hidden className={`mt-[7px] h-2 w-2 flex-none rounded-full ${r.block ? "bg-bad" : "bg-amber"}`} />
                  <span>{r.text}{r.block && <span className="text-bad"> Blocks approval.</span>}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line pt-3">
            {!can(role, "handover.approve") ? (
              <p className="caption">Only a reviewing engineer, admin or owner can approve.</p>
            ) : independentBlock ? (
              <p className="caption">You are this case&apos;s responsible engineer, so another reviewing engineer must approve. An admin can change this rule in Settings.</p>
            ) : nothingChanged ? (
              <p className="caption">v{latest} is current. Any change to the case starts v{latest + 1}.</p>
            ) : blocked ? (
              <p className="caption">Resolve the items marked red, then approve here.</p>
            ) : (
              <ActionForm action={approveAction} className="grid gap-3">
                {hidden}
                <label className="field"><span>May be shared with</span>
                  <input className="input" name="sharingScope" defaultValue={`Internal to ${org.name}`} required />
                </label>
                <label className="flex items-start gap-2 text-[13.5px]">
                  <input type="checkbox" name="confirm" className="mt-1" required />
                  <span>I have read this handover. It records what was known now; it is not a root-cause finding or a release decision.</span>
                </label>
                <div><Submit pendingText="Approving…">Approve as v{latest + 1}</Submit></div>
              </ActionForm>
            )}
          </div>
        </div>

        <div className="card">
          <div className="flex items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="h-section">Open questions</h2>
            <span className="caption">{openQs.length} open</span>
          </div>
          {!openQs.length && <p className="caption px-5 py-3">No open questions.</p>}
          <ul className="divide-y divide-line">
            {openQs.map((q) => (
              <li key={q.id} className="grid gap-1 px-5 py-3">
                <p className="text-[14px]">{q.text}</p>
                <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
                  <span>{q.code} · {origin(q)}</span>
                  {canWrite && (
                    <details className="basis-full">
                      <summary className="cursor-pointer font-medium text-accent hover:underline">Record the answer</summary>
                      <ActionForm action={answerQuestionAction} className="mt-2 grid gap-2" quiet>
                        {hidden}
                        <input type="hidden" name="questionId" value={q.id} />
                        <textarea className="input" name="answer" placeholder="The answer, or the record where it can be found" required />
                        <div><Submit className="btn btn-sm btn-primary">Mark answered</Submit></div>
                      </ActionForm>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {canWrite && (
            <ActionForm action={addQuestionAction} className="flex flex-wrap gap-2 border-t border-line px-5 py-3" reset>
              {hidden}
              <input className="input min-w-0 flex-1" name="text" placeholder="Add a question: what still needs to be found out?" aria-label="New question" required />
              <Submit className="btn btn-primary">Add</Submit>
            </ActionForm>
          )}
          {answered.length > 0 && (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-5 py-2.5 text-[13px] text-muted hover:text-accent">Answered ({answered.length}) ›</summary>
              <ul className="divide-y divide-line">
                {answered.map((q) => (
                  <li key={q.id} className="grid gap-1 px-5 py-2.5 text-[13px]">
                    <span className="text-muted">{q.text}</span>
                    <span><span className="font-medium">Answer:</span> {q.answer}</span>
                    {canWrite && (
                      <ActionForm action={answerQuestionAction} quiet>
                        {hidden}
                        <input type="hidden" name="questionId" value={q.id} />
                        <input type="hidden" name="reopen" value="1" />
                        <Submit className="text-[12px] text-accent hover:underline" pendingText="…">Reopen</Submit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </section>

      <section className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav className="flex flex-wrap gap-1 rounded-lg bg-sunk p-1" aria-label="Handover versions">
            <Link href={`/app/${slug}/cases/${caseId}/review`} className={`rounded-md px-3 py-1 text-[13px] font-medium ${!viewing ? "bg-surface text-accent shadow-sm" : "text-muted hover:text-ink"}`}>Current draft</Link>
            {versions.map((x) => (
              <Link key={x.id} href={`/app/${slug}/cases/${caseId}/review?v=${x.version}`} className={`rounded-md px-3 py-1 text-[13px] font-medium ${viewing?.id === x.id ? "bg-surface text-accent shadow-sm" : "text-muted hover:text-ink"}`}>v{x.version}</Link>
            ))}
          </nav>
          <div className="flex gap-1">
            <CopyButton text={doc} label="Copy" />
            <a className="btn btn-sm" href={`/api/orgs/${slug}/cases/${caseId}/handover?v=${viewing ? viewing.version : "draft"}`}>Download</a>
          </div>
        </div>
        <p className="caption">
          {viewing
            ? <>Approved by {viewing.approvedBy}, {utcStamp(viewing.approvedAt)} · shared with: {viewing.sharingScope} · frozen</>
            : "Live draft: it updates as the case changes and becomes a frozen version when approved."}
        </p>
        <pre className="doc max-h-[78vh] overflow-auto bg-surface">{doc}</pre>
      </section>
    </div>
  );
}
