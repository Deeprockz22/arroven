import Link from "next/link";
import { requireOrg } from "@/server/session";
import { caseActivity } from "@/server/services/cases";
import { logDate } from "@/lib/labels";

export const metadata = { title: "Activity" };

type Kind = "records" | "review" | "reasoning" | "models" | "handover" | "case";

/** Plain-language label and filter group for every audited action. */
const ACTIONS: Record<string, [string, Kind]> = {
  "case.created": ["Opened the case", "case"],
  "case.closed": ["Closed the case", "case"],
  "case.reopened": ["Reopened the case", "case"],
  "case.details_changed": ["Changed the case details", "case"],
  "case.responsible_changed": ["Changed the responsible engineer", "case"],
  "demo.loaded": ["Loaded the demo case", "case"],
  "training.permitted": ["Recorded training permission", "case"],
  "training.withdrawn": ["Withdrew training permission", "case"],
  "training.case_exported": ["Included in a training export", "case"],
  "training.case_export_deleted": ["Training export deleted", "case"],
  "source.imported": ["Imported a record", "records"],
  "source.marked_unavailable": ["Recorded a missing record", "records"],
  "source.superseded": ["Replaced a record with a corrected copy", "records"],
  "source.authorisation_confirmed": ["Confirmed a record's authorisation", "records"],
  "source.authorisation_withdrawn": ["Withdrew a record's authorisation", "records"],
  "source.authorisation_unconfirmed": ["Marked a record's authorisation unconfirmed", "records"],
  "statement.accepted": ["Accepted a statement", "review"],
  "statement.edited": ["Corrected a statement", "review"],
  "statement.rejected": ["Rejected a statement", "review"],
  "statement.unreviewed": ["Returned a statement to unreviewed", "review"],
  "statement.added": ["Added a statement", "review"],
  "statement.rechecked": ["Re-checked a statement", "review"],
  "flag.question": ["Turned a flag into a question", "review"],
  "flag.dismiss": ["Dismissed a flag", "review"],
  "flag.reopen": ["Reopened a flag", "review"],
  "hypothesis.created": ["Added an explanation", "reasoning"],
  "hypothesis.assessed": ["Assessed an explanation", "reasoning"],
  "decision.recorded": ["Recorded an evidence decision", "reasoning"],
  "decision.cleared": ["Cleared an evidence decision", "reasoning"],
  "evidence_gap.question": ["Turned an evidence gap into a question", "reasoning"],
  "evidence_gap.dismiss": ["Dismissed an evidence gap", "reasoning"],
  "comparison.question": ["Turned a comparison into a question", "reasoning"],
  "comparison.dismiss": ["Dismissed a comparison", "reasoning"],
  "comparison.reopen": ["Reopened a comparison", "reasoning"],
  "proposal.adopted": ["Adopted a proposal", "reasoning"],
  "proposal.rejected": ["Rejected a proposal", "reasoning"],
  "proposal.unresolved": ["Left a proposal unresolved", "reasoning"],
  "question.added": ["Added a question", "reasoning"],
  "question.answered": ["Answered a question", "reasoning"],
  "question.reopened": ["Reopened a question", "reasoning"],
  "ai.run_started": ["Started a model run", "models"],
  "ai.run_succeeded": ["Model run finished", "models"],
  "ai.run_failed": ["Model run failed", "models"],
  "handover.approved": ["Approved the handover", "handover"],
};

const FILTERS: [string, string][] = [["all", "All"], ["review", "Statement review"], ["reasoning", "Explanations and questions"], ["records", "Records"], ["models", "Model runs"], ["handover", "Approvals"], ["case", "Case"]];
const DOT: Record<Kind, string> = { records: "bg-accent", review: "bg-good", reasoning: "bg-amber", models: "bg-inc", handover: "bg-good", case: "bg-inc" };

/** One readable line from the event's detail, leaving hashes and ids to the expandable view. */
function summary(action: string, d: Record<string, unknown>): string {
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : undefined);
  const parts: (string | undefined)[] = [];
  if (action === "decision.recorded") parts.push(`${s("statement")} ${s("relation")?.replace("_", " ")} ${s("hypothesis")}`, s("reason") && `“${s("reason")}”`);
  else if (action === "statement.rechecked") parts.push(s("code"), s("fromLocator") && `${s("fromLocator")} → ${s("toLocator")}`);
  else if (action.startsWith("statement.")) parts.push(s("code"), s("to") && `now reads “${s("to")}”`);
  else if (action === "hypothesis.assessed") parts.push(s("code"), s("assessment")?.replace("_", " "), s("note") && `“${s("note")}”`);
  else if (action === "source.superseded") parts.push(`${s("old")} replaced by ${s("new")}`, typeof d.statements === "number" && d.statements ? `${d.statements} statements flagged` : undefined);
  else if (action.startsWith("source.")) parts.push(s("code"), s("title"), s("reason") ?? s("basis"));
  else if (action.startsWith("ai.run")) parts.push(s("kind"), typeof d.produced === "number" ? `${d.produced} produced, ${d.dropped ?? 0} dropped` : undefined, s("error"));
  else if (action === "handover.approved") parts.push(`v${d.version}`, s("sharingScope") && `shared with ${s("sharingScope")}`);
  else if (action === "case.created") parts.push(s("ref"), s("title"));
  else parts.push(s("code"), s("title"), s("text"), s("note"), s("purpose"), s("basis"));
  return parts.filter(Boolean).join(" · ").slice(0, 220);
}

export default async function Activity({ params, searchParams }: { params: Promise<{ org: string; caseId: string }>; searchParams: Promise<{ show?: string }> }) {
  const { org: slug, caseId } = await params;
  const { show = "all" } = await searchParams;
  const { ctx } = await requireOrg(slug);
  const rows = await caseActivity(ctx, caseId, 500);
  const base = `/app/${slug}/cases/${caseId}/activity`;
  const kindOf = (a: string): Kind => ACTIONS[a]?.[1] ?? "case";
  const shown = show === "all" ? rows : rows.filter((r) => kindOf(r.action) === show);
  const days = new Map<string, typeof shown>();
  for (const r of shown) {
    const day = r.at.toISOString().slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), r]);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 rounded-lg bg-sunk p-1" aria-label="Filter activity">
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={k === "all" ? base : `${base}?show=${k}`} className={`rounded-md px-3 py-1 text-[13px] font-medium ${show === k ? "bg-surface text-accent shadow-sm" : "text-muted hover:text-ink"}`}>{label}</Link>
          ))}
        </nav>
        <span className="caption">Every change to this case, newest first. Entries can&apos;t be edited.</span>
      </div>

      {!shown.length && <div className="card p-8 text-center caption">Nothing here yet.</div>}

      {[...days.entries()].map(([day, items]) => (
        <section key={day} className="card">
          <h2 className="border-b border-line px-5 py-2.5 text-[13px] font-semibold text-muted">{logDate(day)}</h2>
          <ol className="divide-y divide-line">
            {items.map((r) => {
              const line = summary(r.action, r.detail);
              return (
                <li key={r.id} className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 px-5 py-2.5">
                  <span className="mono pt-[2px] text-[12px] text-muted">{r.at.toISOString().slice(11, 16)}</span>
                  <div className="grid gap-0.5">
                    <p className="flex items-center gap-2 text-[14px]">
                      <span aria-hidden className={`h-1.5 w-1.5 flex-none rounded-full ${DOT[kindOf(r.action)]}`} />
                      <span><span className="font-medium">{r.actor ?? "System"}</span> <span className="text-muted">{(ACTIONS[r.action]?.[0] ?? r.action).replace(/^./, (c) => c.toLowerCase())}</span></span>
                    </p>
                    {line && <p className="pl-3.5 text-[13px] text-muted">{line}</p>}
                    {Object.keys(r.detail).length > 0 && (
                      <details className="pl-3.5">
                        <summary className="cursor-pointer text-[12px] text-muted hover:text-accent">Full record</summary>
                        <pre className="mono mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-sunk p-2 text-[11.5px]">{JSON.stringify(r.detail, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <p className="caption">Times are UTC.</p>
    </div>
  );
}
