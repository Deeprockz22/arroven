import { requireOrg } from "@/server/session";
import { caseSources, caseStatements, loadCase } from "@/server/services/cases";
import { latestRuns } from "@/server/ai/runs";
import { can } from "@/server/permissions";
import { SOURCE_KINDS } from "@/server/db/schema";
import { AUTHORISATION_LABELS, SOURCE_KIND_LABELS, lineAnchor, utcStamp } from "@/lib/labels";
import { ActionForm, ConfirmSubmit, Submit } from "@/components/forms";
import { Drop } from "@/components/drop";
import { OpenTarget } from "@/components/open-target";
import { authorisationAction, importSourceAction, unavailableSourceAction } from "@/app/actions";

export const metadata = { title: "Sources" };

const AUTH_PILL: Record<string, string> = { unconfirmed: "pill-amber", confirmed: "pill-good", withdrawn: "pill-bad" };

export default async function Sources({ params }: { params: Promise<{ org: string; caseId: string }> }) {
  const { org: slug, caseId } = await params;
  const { ctx, role } = await requireOrg(slug);
  const [c, srcs, stmts, runs] = await Promise.all([loadCase(ctx, caseId), caseSources(ctx, caseId), caseStatements(ctx, caseId), latestRuns(ctx, caseId)]);
  const cited = new Map<string, string[]>();
  for (const s of stmts) if (s.status !== "rejected") cited.set(s.locator, [...(cited.get(s.locator) ?? []), s.code]);
  const lastChron = runs.find((r) => r.kind === "chronology" && r.status === "succeeded");
  const available = srcs.filter((s) => s.available);
  const missing = srcs.filter((s) => !s.available);
  const writable = c.status === "open";
  const canImport = can(role, "source.import") && writable;
  const canAuthorise = can(role, "source.authorise") && writable;
  const byId = new Map(srcs.map((s) => [s.id, s]));
  const hidden = (<><input type="hidden" name="org" value={slug} /><input type="hidden" name="caseId" value={caseId} /></>);
  const needAuth = available.filter((s) => s.authorisation === "unconfirmed" && !s.supersededAt).length;

  return (
    <div className="grid gap-4">
      <OpenTarget />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="caption">
          {available.length} record{available.length === 1 ? "" : "s"}{missing.length ? ` · ${missing.length} unavailable` : ""}
          {needAuth ? <span className="text-amber"> · {needAuth} awaiting authorisation</span> : null} · click a record to read it
        </p>
        {canImport && (
          <div className="flex flex-wrap gap-2">
            <Drop label="Record a missing source">
              <ActionForm action={unavailableSourceAction} className="grid gap-3" reset>
                {hidden}
                <p className="caption">A record you need but don&apos;t have stays visible, so nobody fills the gap by assumption.</p>
                <label className="field"><span>Record</span><input className="input" name="title" placeholder="BMC fault history download, 29 MAR" required /></label>
                <label className="field"><span>Why it is unavailable</span><input className="input" name="reason" placeholder="Requested from line station 30 MAR, not received" required /></label>
                <div><Submit className="btn btn-sm btn-primary" pendingText="Saving…">Record as unavailable</Submit></div>
              </ActionForm>
            </Drop>
            <Drop label="Import a record" primary>
              <ActionForm action={importSourceAction} className="grid gap-3" reset>
                {hidden}
                <label className="field"><span>Title</span><input className="input" name="title" placeholder="Technical log page TLB-4471" required /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="field"><span>Record type</span>
                    <select className="input" name="kind" defaultValue="tech_log">
                      {SOURCE_KINDS.map((k) => <option key={k} value={k}>{SOURCE_KIND_LABELS[k]}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Custodian</span><input className="input" name="custodian" placeholder="Who holds the original" /></label>
                </div>
                <label className="field"><span>File (text, CSV or PDF)</span><input className="input" type="file" name="file" accept=".txt,.csv,.pdf,.md,text/plain,text/csv,application/pdf" /></label>
                <label className="field"><span>Or paste the record text</span><textarea className="input" name="pasted" rows={3} /></label>
                {canAuthorise
                  ? <label className="field"><span>Authorisation basis</span><input className="input" name="authorisationBasis" placeholder="Agreement and clause that permits this use" /><small className="caption">Leave empty to import as unconfirmed. The models only read authorised records.</small></label>
                  : <p className="caption">Imported as unconfirmed until a reviewing engineer or admin confirms authorisation.</p>}
                <div><Submit className="btn btn-sm btn-primary" pendingText="Importing…">Import</Submit></div>
              </ActionForm>
            </Drop>
          </div>
        )}
      </div>

      {!srcs.length && <div className="card p-8 text-center caption">No records yet. Import a tech log page, work order, shop report, message log or engineering note.</div>}

      {available.length > 0 && (
        <div className="card divide-y divide-line">
          {available.map((s) => {
            const successor = srcs.find((x) => x.supersedesId === s.id);
            const predecessor = s.supersedesId ? byId.get(s.supersedesId) : undefined;
            const citedLines = s.segments.filter((g) => cited.has(g.locator)).length;
            const readByAi = lastChron?.coverage?.included.includes(s.code);
            const notRead = lastChron?.coverage?.excluded.find((x) => x.code === s.code);
            return (
              <details key={s.id} id={s.code} className={`group scroll-mt-24 ${s.supersededAt ? "opacity-60" : ""}`}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-sunk">
                  <span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span>
                  <span className="mono text-[12.5px] font-medium text-accent">{s.code}</span>
                  <span className="font-medium">{s.title}</span>
                  {s.authorisation !== "confirmed" && <span className={`pill ${AUTH_PILL[s.authorisation]}`}>{AUTHORISATION_LABELS[s.authorisation]}</span>}
                  {s.supersededAt && <span className="pill pill-inc">Superseded by {successor?.code ?? "a corrected copy"}</span>}
                  {predecessor && <span className="pill pill-accent">Corrects {predecessor.code}</span>}
                  <span className="caption ml-auto">
                    {s.segments.length} lines{readByAi ? ` · ${citedLines} cited` : notRead ? " · not read by the models" : ""}
                    {s.processing?.emptyPages?.length ? ` · page ${s.processing.emptyPages.join(", ")} has no text` : ""}
                  </span>
                </summary>

                <div className="grid gap-3 border-t border-line bg-sunk/50 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
                    <span className="text-muted">{SOURCE_KIND_LABELS[s.kind]}{s.custodian && ` · ${s.custodian}`} · imported {utcStamp(s.importedAt)} · <span className="mono" title={s.sha256 ?? ""}>sha256 {s.sha256?.slice(0, 12)}…</span></span>
                    {s.authorisation === "confirmed" && <span className="text-muted">Authorised: {s.authorisationBasis}</span>}
                    {notRead && <span className="text-amber">Not read by the last draft: {notRead.reason}</span>}
                    <span className="ml-auto flex flex-wrap items-center gap-4">
                      {s.authorisation !== "withdrawn" && <a className="font-medium text-accent hover:underline" href={`/api/orgs/${slug}/sources/${s.id}`}>Download original</a>}
                      {canAuthorise && !s.supersededAt && s.authorisation !== "confirmed" && (
                        <Drop label="Confirm authorisation" small primary>
                          <ActionForm action={authorisationAction} className="grid gap-2" quiet>
                            {hidden}
                            <input type="hidden" name="sourceId" value={s.id} />
                            <input className="input" name="basis" placeholder="Basis, e.g. data agreement DSA-12 §3" aria-label={`Authorisation basis for ${s.code}`} required />
                            <div><Submit className="btn btn-sm btn-primary" name="status" value="confirmed" pendingText="…">Confirm</Submit></div>
                          </ActionForm>
                        </Drop>
                      )}
                      {canImport && !s.supersededAt && (
                        <Drop label="Corrected copy" small>
                          <ActionForm action={importSourceAction} className="grid gap-2" reset>
                            {hidden}
                            <input type="hidden" name="supersedes" value={s.id} />
                            <input type="hidden" name="kind" value={s.kind} />
                            <input type="hidden" name="custodian" value={s.custodian} />
                            <p className="caption">Statements citing {s.code} will be flagged for a re-check.</p>
                            <input className="input" name="title" defaultValue={`${s.title} (corrected)`} aria-label="Title of the corrected copy" required />
                            <input className="input" type="file" name="file" accept=".txt,.csv,.pdf,.md,text/plain,text/csv,application/pdf" aria-label="Corrected file" />
                            <textarea className="input" name="pasted" rows={2} placeholder="Or paste the corrected text" aria-label="Corrected text" />
                            {canAuthorise && <input className="input" name="authorisationBasis" defaultValue={s.authorisationBasis ?? ""} aria-label="Authorisation basis" />}
                            <div><Submit className="btn btn-sm btn-primary" pendingText="Importing…">Import corrected copy</Submit></div>
                          </ActionForm>
                        </Drop>
                      )}
                      {canAuthorise && s.authorisation === "confirmed" && (
                        <Drop label="Withdraw" small>
                          <ActionForm action={authorisationAction} className="grid gap-2" quiet>
                            {hidden}
                            <input type="hidden" name="sourceId" value={s.id} />
                            <p className="caption">Statements citing {s.code} will be flagged, and the models will stop reading it.</p>
                            <input className="input" name="basis" placeholder="Why authorisation is withdrawn" aria-label={`Reason for withdrawing ${s.code}`} required />
                            <div><ConfirmSubmit className="btn btn-sm btn-bad" confirmText="Withdraw" name="status" value="withdrawn">Withdraw authorisation</ConfirmSubmit></div>
                          </ActionForm>
                        </Drop>
                      )}
                    </span>
                  </div>
                  <ol className="card py-1.5">
                    {s.segments.map((g) => (
                      <li key={g.id} id={lineAnchor(g.locator)} className="seg-line grid grid-cols-[64px_minmax(0,1fr)_auto] gap-3 px-3 py-[3px] font-mono text-[12.5px] leading-[1.6]">
                        <span className={`text-right text-[11px] ${cited.has(g.locator) ? "font-medium text-accent" : "text-muted"}`}>{g.locator}</span>
                        <span className="break-words">{g.text}</span>
                        <span className="text-[11px] text-accent">{cited.get(g.locator)?.join(" ")}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            );
          })}
        </div>
      )}

      {missing.length > 0 && (
        <div className="card">
          <div className="border-b border-line px-5 py-3"><h2 className="h-section">Unavailable records</h2></div>
          <ul className="divide-y divide-line">
            {missing.map((s) => (
              <li key={s.id} id={s.code} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5 scroll-mt-24">
                <span className="mono text-[12.5px] font-medium text-accent">{s.code}</span>
                <span className="text-[14px]">{s.title}</span>
                <span className="caption">{s.unavailableReason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
