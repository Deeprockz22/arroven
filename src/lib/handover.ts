import { ASSESSMENT_LABELS, KIND_LABELS, RELATION_LABELS, logDate, utcStamp } from "./labels";

export interface HandoverData {
  case: { ref: string; title: string; aircraft: string; system: string; question: string; evidenceCutoff: string | null; isDemo: boolean; responsibleEngineer: string | null };
  sources: {
    code: string; title: string; custodian: string; available: boolean; unavailableReason: string | null; sha256: string | null; importedAt: string;
    authorisation: string; authorisationBasis: string | null; supersededBy: string | null; supersedes: string | null;
    processing: { lines: number; pages?: number; emptyPages?: number[]; truncated?: number } | null;
  }[];
  statements: {
    code: string; locator: string; source: string; eventDate: string | null; kind: string; text: string; conditions: string; uncertain: boolean; uncertainNote: string;
    status: string; origin: string; needsReassessment: boolean; reassessReason: string | null; afterCutoff: boolean;
  }[];
  flags: { code: string; type: string; text: string; refs: string[]; status: string }[];
  hypotheses: {
    code: string; title: string; text: string; origin: string; assessment: string; assessmentNote: string | null; needsReassessment: boolean; reassessReason: string | null;
    decisions: { statement: string; relation: string; reason: string }[];
  }[];
  comparisons: { code: string; title: string; finding: string; note: string; statements: string[]; status: string }[];
  proposals: { code: string; kind: string; title: string; text: string; basis: string[]; uncertainty: string; status: string; decisionNote: string | null }[];
  questions: { code: string; text: string; status: string; answer: string | null }[];
}

export interface VersionInfo {
  version: number;
  approvedBy: string;
  approvedAt: string;
  sharingScope: string;
}

const DISCLAIMER =
  "This record supports investigation reasoning. It does not state a root cause, direct maintenance or make an airworthiness decision. A citation shows where a statement came from, not that the statement is physically correct. Completing this review does not prove a repair or authorise aircraft release.";

const FINDING_LABELS: Record<string, string> = { agree: "Records agree", differ: "Records differ", cannot_compare: "Cannot be compared" };

const isChecked = (s: { status: string }) => s.status === "accepted" || s.status === "edited";

/** Render the investigation handover as Markdown. Only engineer-checked statements and engineer decisions count as evidence. */
export function renderHandover(d: HandoverData, v: VersionInfo | null, now = new Date()): string {
  const L: string[] = [];
  const checked = d.statements.filter(isChecked);
  const inBasis = checked.filter((s) => !s.afterCutoff);
  const late = checked.filter((s) => s.afterCutoff);
  const byCode = new Map(d.statements.map((s) => [s.code, s]));

  L.push(`# Investigation handover · ${d.case.ref}`, d.case.title);
  L.push(`Aircraft: ${d.case.aircraft}${d.case.system ? ` · System: ${d.case.system}` : ""}${d.case.evidenceCutoff ? ` · Evidence cutoff: ${logDate(d.case.evidenceCutoff)}` : ""}`);
  L.push(`Responsible engineer: ${d.case.responsibleEngineer ?? "not assigned"}`);
  L.push(v ? `Version v${v.version} · approved by ${v.approvedBy} · ${utcStamp(v.approvedAt)}` : `UNAPPROVED DRAFT · generated ${utcStamp(now)}`);
  if (v) L.push(`Sharing scope: ${v.sharingScope}`);
  if (d.case.isDemo) L.push("Fictional demonstration case. No real operator, aircraft or records.");
  L.push("", DISCLAIMER, "", "## Question", d.case.question, "", "## Sources");
  for (const s of d.sources) {
    if (!s.available) { L.push(`- ${s.code} ${s.title} · UNAVAILABLE: ${s.unavailableReason ?? "reason not recorded"}. Missing access does not prove missing evidence.`); continue; }
    const notes = [
      s.authorisation === "confirmed" ? `authorised (${s.authorisationBasis})` : s.authorisation === "withdrawn" ? `AUTHORISATION WITHDRAWN (${s.authorisationBasis})` : "AUTHORISATION NOT CONFIRMED",
      s.supersededBy ? `superseded by ${s.supersededBy}` : "",
      s.supersedes ? `corrected copy of ${s.supersedes}` : "",
      s.processing?.emptyPages?.length ? `no text extracted from page(s) ${s.processing.emptyPages.join(", ")}` : "",
    ].filter(Boolean);
    L.push(`- ${s.code} ${s.title}${s.custodian ? ` (${s.custodian})` : ""} · imported ${utcStamp(s.importedAt)} · sha256 ${s.sha256?.slice(0, 12)}… · ${notes.join(" · ")}`);
  }
  if (!d.sources.length) L.push("- No sources imported.");

  L.push("", "## Checked chronology");
  if (!inBasis.length) L.push("- No statements have been checked against their original records yet.");
  for (const s of inBasis) L.push(...statementLines(s));

  if (late.length) {
    L.push("", "## Recorded after the evidence cutoff", "These statements are outside the case's evidence basis and are listed for visibility only.");
    for (const s of late) L.push(...statementLines(s));
  }

  L.push("", "## Explanations, evidence and assessment");
  if (!d.hypotheses.length) L.push("- No explanations recorded.");
  for (const h of d.hypotheses) {
    const rel = (r: string) => h.decisions.filter((x) => x.relation === r);
    L.push("", `### ${h.code} ${h.title}${h.origin === "ai_proposal" ? " (adopted from an AI proposal)" : ""}`, h.text);
    L.push(`Assessment: ${ASSESSMENT_LABELS[h.assessment] ?? h.assessment}${h.assessmentNote ? `. ${h.assessmentNote}` : ""}`);
    if (h.needsReassessment) L.push(`NEEDS REASSESSMENT: ${h.reassessReason}`);
    L.push(`Supports ${rel("supports").length} · Challenges ${rel("challenges").length} · Inconclusive ${rel("inconclusive").length}`);
    if (!h.decisions.filter((x) => x.relation !== "not_relevant").length) L.push("- No engineer decisions recorded for this explanation.");
    for (const r of ["supports", "challenges", "inconclusive"]) {
      for (const x of rel(r)) {
        const s = byCode.get(x.statement);
        L.push(`- ${RELATION_LABELS[r].toUpperCase()} · ${x.statement}${s ? ` [${s.locator}] ${s.text}` : ""}`, `    Why: ${x.reason}`);
      }
    }
  }

  const cmps = d.comparisons.filter((c) => c.status !== "dismissed");
  if (cmps.length) {
    L.push("", "## Comparisons of findings (AI-prepared, reviewed for relevance)");
    for (const c of cmps) L.push(`- ${c.code} ${FINDING_LABELS[c.finding] ?? c.finding} · ${c.title} [${c.statements.join(", ")}]`, `    ${c.note}`);
  }

  const props = d.proposals.filter((p) => p.status !== "proposed");
  if (props.length) {
    L.push("", "## AI proposals and engineering decisions");
    for (const p of props) {
      L.push(`- ${p.code} ${p.kind === "explanation" ? "Explanation" : "Question"} · ${p.status.toUpperCase()} · ${p.title}${p.basis.length ? ` [basis ${p.basis.join(", ")}]` : ""}`);
      if (p.decisionNote) L.push(`    Engineer: ${p.decisionNote}`);
    }
  }
  const pending = d.proposals.filter((p) => p.status === "proposed").length;
  if (pending) L.push("", `${pending} AI proposal(s) have not been reviewed and are not part of this record.`);

  L.push("", "## Conflicts and gaps");
  const flags = d.flags.filter((f) => f.status !== "dismissed");
  if (!flags.length) L.push("- None recorded.");
  for (const f of flags) L.push(`- ${f.type.toUpperCase()} ${f.code}${f.refs.length ? ` [${f.refs.join(", ")}]` : ""} ${f.text}`);

  L.push("", "## Open questions");
  const open = d.questions.filter((q) => q.status === "open");
  if (!open.length) L.push("- None.");
  for (const q of open) L.push(`- ${q.code} ${q.text}`);
  const answered = d.questions.filter((q) => q.status === "answered");
  if (answered.length) {
    L.push("", "## Answered questions");
    for (const q of answered) L.push(`- ${q.code} ${q.text}`, `    Answer: ${q.answer}`);
  }

  const unreviewed = d.statements.filter((s) => s.status === "unreviewed").length;
  const rejected = d.statements.filter((s) => s.status === "rejected").length;
  L.push("", "## Not included", `- ${unreviewed} AI-drafted statement(s) not yet checked; ${rejected} statement(s) rejected by an engineer.`);
  return L.join("\n") + "\n";
}

function statementLines(s: HandoverData["statements"][number]) {
  const tags = [s.status === "edited" ? "wording corrected by engineer" : "", s.origin === "engineer" ? "added by engineer" : ""].filter(Boolean);
  const out = [`- ${logDate(s.eventDate)} [${s.locator}] ${s.code} ${KIND_LABELS[s.kind] ?? s.kind}: ${s.text}${s.conditions ? ` (Conditions: ${s.conditions})` : ""}${tags.length ? ` [${tags.join("; ")}]` : ""}`];
  if (s.uncertain) out.push(`    Uncertain reading: ${s.uncertainNote}`);
  if (s.needsReassessment) out.push(`    NEEDS RE-CHECK: ${s.reassessReason}`);
  return out;
}

export interface Readiness {
  ok: boolean;
  /** A blocking item prevents approval until resolved. */
  block?: boolean;
  text: string;
}

export function readiness(d: HandoverData): Readiness[] {
  const live = d.statements.filter((s) => s.status !== "rejected");
  const recheck = live.filter((s) => s.needsReassessment).map((s) => s.code);
  const reassess = d.hypotheses.filter((h) => h.needsReassessment).map((h) => h.code);
  const notAuthorised = new Set(d.sources.filter((s) => s.available && s.authorisation !== "confirmed").map((s) => s.code));
  const unauthorisedEvidence = d.statements.filter(isChecked).filter((s) => notAuthorised.has(s.source)).map((s) => s.code);
  const unreviewed = d.statements.filter((s) => s.status === "unreviewed").length;
  const noDecisions = d.hypotheses.filter((h) => !h.decisions.length).map((h) => h.code);
  const unassessed = d.hypotheses.filter((h) => h.assessment === "not_assessed").map((h) => h.code);
  const openFlags = d.flags.filter((f) => f.status === "open").length;
  const pendingProposals = d.proposals.filter((p) => p.status === "proposed").length;
  const openQ = d.questions.filter((q) => q.status === "open").length;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return [
    { ok: !recheck.length, block: true, text: recheck.length ? `${recheck.join(", ")} must be re-checked because the record ${plural(recheck.length, "it cites", "they cite")} changed.` : "No statement is waiting for a re-check." },
    { ok: !reassess.length, block: true, text: reassess.length ? `${reassess.join(", ")} must be reassessed after a change to the evidence or the question.` : "No explanation is waiting for reassessment." },
    { ok: !unauthorisedEvidence.length, block: true, text: unauthorisedEvidence.length ? `${unauthorisedEvidence.join(", ")} ${plural(unauthorisedEvidence.length, "cites a record", "cite records")} whose authorisation is not confirmed.` : "Every checked statement cites an authorised record." },
    { ok: unreviewed === 0, text: unreviewed ? `${unreviewed} drafted ${plural(unreviewed, "statement is", "statements are")} unreviewed and will be left out.` : "Every drafted statement has been checked against its original." },
    { ok: d.hypotheses.length > 0 && noDecisions.length === 0, text: !d.hypotheses.length ? "No explanations have been written yet." : noDecisions.length ? `${noDecisions.join(", ")} ${plural(noDecisions.length, "has", "have")} no evidence decisions yet.` : "Every explanation has at least one evidence decision." },
    { ok: d.hypotheses.length > 0 && unassessed.length === 0, text: unassessed.length ? `${unassessed.join(", ")} ${plural(unassessed.length, "has", "have")} not been assessed. ${plural(unassessed.length, "It", "They")} will appear as not yet assessed.` : d.hypotheses.length ? "Every explanation has an engineer assessment." : "Nothing to assess yet." },
    { ok: openFlags === 0 && pendingProposals === 0, text: openFlags || pendingProposals ? `${openFlags} undecided flag${plural(openFlags, "", "s")} and ${pendingProposals} unreviewed AI proposal${plural(pendingProposals, "", "s")}.` : "Every flag and AI proposal has been decided." },
    { ok: true, text: `${openQ} open question${plural(openQ, "", "s")} will be carried into the handover.` },
  ];
}
