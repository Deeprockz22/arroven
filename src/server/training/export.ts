import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db";
import {
  cases, comparisons, decisions, flags, hypotheses, proposals, segments, sources, statements, suggestions, trainingExports, users,
} from "../db/schema";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import { assertCan } from "../permissions";
import { audit } from "../audit";
import { sha256 } from "../auth/crypto";
import { deleteStored, putOriginal, readOriginal } from "../sources/storage";
import { CONTRACT_VERSION } from "../ai/contract";

/*
 * Training datasets for ARROVEN's own models (agreement clause 6). Only cases with a recorded training
 * permission are included, only from current, authorised records, and only labels an engineer has decided.
 * Each export is stored once, hashed, logged, and can be deleted at the end of a pilot.
 */

export const EXPORT_SCHEMA_VERSION = 1;

/** Last-line defence for contact details left in free text. Names cannot be found reliably this way;
 *  partners pseudonymise people before transfer (agreement clause 5.1). */
export function scrub(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    // Indian-format phone numbers only, so dates, part numbers and serial numbers survive.
    .replace(/(?<![\w-])(?:\+\d{1,3}[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?![\w-])/g, "[number removed]");
}

export async function setCaseTrainingPermission(ctx: Ctx, caseId: string, permitted: boolean, basis: string) {
  assertCan(ctx.role, "training.manage");
  const b = basis.trim();
  if (permitted && b.length < 5) throw new AppError("invalid", "Record the basis for training use, such as the agreement and clause that permits it.");
  const [c] = await ctx.db.select().from(cases).where(and(eq(cases.id, caseId), eq(cases.orgId, ctx.orgId)));
  if (!c) throw new AppError("not_found", "That case does not exist in this organization.");
  await ctx.db.update(cases).set({
    trainingPermitted: permitted, trainingBasis: permitted ? b : (b || null), trainingPermittedBy: ctx.userId, trainingPermittedAt: new Date(),
  }).where(eq(cases.id, caseId));
  await audit(ctx.db, ctx, permitted ? "training.permitted" : "training.withdrawn", "case", caseId, caseId, { basis: b });
}

type Line = Record<string, unknown> & { type: string };

/** Build the JSONL lines for one case. Exported for tests. */
export async function caseTrainingLines(db: Db, c: typeof cases.$inferSelect): Promise<{ lines: Line[]; counts: Record<string, number> }> {
  const [srcs, segs, stmts, hs, ds, sugs, props, cmps, fls] = await Promise.all([
    db.select().from(sources).where(eq(sources.caseId, c.id)),
    db.select().from(segments).where(eq(segments.caseId, c.id)).orderBy(asc(segments.ordinal)),
    db.select().from(statements).where(eq(statements.caseId, c.id)),
    db.select().from(hypotheses).where(eq(hypotheses.caseId, c.id)).orderBy(asc(hypotheses.createdAt)),
    db.select().from(decisions).where(eq(decisions.caseId, c.id)),
    db.select().from(suggestions).where(eq(suggestions.caseId, c.id)),
    db.select().from(proposals).where(eq(proposals.caseId, c.id)),
    db.select().from(comparisons).where(eq(comparisons.caseId, c.id)),
    db.select().from(flags).where(eq(flags.caseId, c.id)),
  ]);
  // Only current, authorised records: a superseded copy is replaced by its correction; a withdrawn one may not be used.
  const usable = new Map(srcs.filter((s) => s.available && s.authorisation === "confirmed" && !s.supersededAt).map((s) => [s.id, s]));
  const usableSegs = segs.filter((g) => usable.has(g.sourceId));
  const segIds = new Set(usableSegs.map((g) => g.id));
  // A label counts only when an engineer decided it and its basis has not changed since.
  const labelled = stmts.filter((s) => s.status !== "unreviewed" && !s.needsReassessment && segIds.has(s.segmentId));
  const byId = new Map(stmts.map((s) => [s.id, s]));
  const reviewedAll = stmts.every((s) => s.status !== "unreviewed" || !segIds.has(s.segmentId));
  const lines: Line[] = [];
  const counts: Record<string, number> = { extraction: 0, extraction_negative: 0, evidence_decision: 0, assessment: 0, proposal_decision: 0, comparison_decision: 0, flag_decision: 0 };

  lines.push({ type: "case", case: c.ref, system: c.system, question: scrub(c.question), evidence_cutoff: c.evidenceCutoff, chronology_fully_reviewed: reviewedAll });

  for (const g of usableSegs) {
    const onLine = stmts.filter((s) => s.segmentId === g.id);
    const decided = labelled.filter((s) => s.segmentId === g.id);
    if (onLine.length && !decided.length) continue; // only undecided drafts on this line: no label yet
    const src = usable.get(g.sourceId)!;
    if (!decided.length) {
      if (!reviewedAll) continue; // a negative example is only trustworthy once the whole chronology was reviewed
      lines.push({ type: "extraction", case: c.ref, locator: g.locator, source_kind: src.kind, line: scrub(g.text), statements: [] });
      counts.extraction_negative++;
      continue;
    }
    lines.push({
      type: "extraction", case: c.ref, locator: g.locator, source_kind: src.kind, line: scrub(g.text),
      statements: decided.map((s) => ({
        origin: s.origin, verdict: s.status, draft: s.origin === "ai" ? scrub(s.draftText) : null, final: s.status === "rejected" ? null : scrub(s.text),
        kind: s.kind, event_date: s.eventDate, conditions: scrub(s.conditions), uncertain: s.uncertain, uncertain_note: scrub(s.uncertainNote),
      })),
    });
    counts.extraction++;
  }

  const stmtView = (id: string) => {
    const s = byId.get(id)!;
    return { code: s.code, locator: s.locator, kind: s.kind, text: scrub(s.text), conditions: scrub(s.conditions), event_date: s.eventDate };
  };
  const labelledIds = new Set(labelled.map((s) => s.id));
  for (const d of ds) {
    if (!labelledIds.has(d.statementId)) continue;
    const h = hs.find((x) => x.id === d.hypothesisId)!;
    const sug = sugs.find((x) => x.hypothesisId === d.hypothesisId && x.statementId === d.statementId);
    lines.push({
      type: "evidence_decision", case: c.ref, explanation: { code: h.code, title: scrub(h.title), text: scrub(h.text), origin: h.origin },
      statement: stmtView(d.statementId), relation: d.relation, reason: scrub(d.reason),
      model_suggestion: sug ? { relation: sug.relation, rationale: scrub(sug.rationale) } : null,
    });
    counts.evidence_decision++;
  }
  for (const h of hs) {
    if (h.assessment === "not_assessed" || h.needsReassessment) continue;
    lines.push({ type: "assessment", case: c.ref, explanation: { code: h.code, title: scrub(h.title), text: scrub(h.text), origin: h.origin }, assessment: h.assessment, note: scrub(h.assessmentNote ?? "") });
    counts.assessment++;
  }
  for (const p of props) {
    if (p.status === "proposed") continue;
    lines.push({ type: "proposal_decision", case: c.ref, kind: p.kind, title: scrub(p.title), text: scrub(p.text), basis: p.basis, uncertainty: scrub(p.uncertainty), decision: p.status, note: scrub(p.decisionNote ?? "") });
    counts.proposal_decision++;
  }
  for (const x of cmps) {
    if (x.status === "open") continue;
    lines.push({ type: "comparison_decision", case: c.ref, title: scrub(x.title), finding: x.finding, note: scrub(x.note), statements: x.statements, decision: x.status });
    counts.comparison_decision++;
  }
  for (const f of fls) {
    if (f.status === "open") continue;
    lines.push({ type: "flag_decision", case: c.ref, flag_type: f.type, text: scrub(f.text), refs: f.refs, decision: f.status });
    counts.flag_decision++;
  }
  return { lines, counts };
}

export async function createTrainingExport(ctx: Ctx, purposeInput: string) {
  assertCan(ctx.role, "training.manage");
  const purpose = purposeInput.trim();
  if (purpose.length < 5) throw new AppError("invalid", "Say what the export is for, such as the model and version it will train.");
  const all = await ctx.db.select().from(cases).where(eq(cases.orgId, ctx.orgId)).orderBy(asc(cases.ref));
  const eligible = all.filter((c) => c.trainingPermitted);
  if (!eligible.length) throw new AppError("conflict", "No case has a recorded training permission. Record it on a case's Overview tab first.");

  const exportId = crypto.randomUUID();
  const createdAt = new Date();
  const body: Line[] = [];
  const counts: Record<string, number> = {};
  for (const c of eligible) {
    const r = await caseTrainingLines(ctx.db, c);
    body.push(...r.lines);
    for (const [k, v] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + v;
  }
  const bodyText = body.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const manifest = {
    type: "manifest", export_id: exportId, created_at: createdAt.toISOString(), purpose, schema_version: EXPORT_SCHEMA_VERSION,
    model_contract: CONTRACT_VERSION, cases: eligible.map((c) => c.ref), excluded_cases: all.filter((c) => !c.trainingPermitted).length,
    counts, body_sha256: sha256(bodyText),
    note: "De-identified at source by the partner; contact details scrubbed. Use only for training ARROVEN's own models under the governing agreement.",
  };
  const file = new TextEncoder().encode(JSON.stringify(manifest) + "\n" + bodyText);
  const stored = await putOriginal(ctx.orgId, file);
  const [row] = await ctx.db.insert(trainingExports).values({
    id: exportId, orgId: ctx.orgId, purpose, caseRefs: manifest.cases, counts, sha256: stored.sha256, storageKey: stored.key, byteSize: file.byteLength,
    createdBy: ctx.userId, createdAt,
  }).returning();
  await audit(ctx.db, ctx, "training.export_created", "training_export", row.id, null, { purpose, cases: manifest.cases, counts, sha256: stored.sha256 });
  for (const c of eligible) await audit(ctx.db, ctx, "training.case_exported", "training_export", row.id, c.id, { purpose, sha256: stored.sha256 });
  return row;
}

export async function listTrainingExports(ctx: Ctx) {
  assertCan(ctx.role, "training.manage");
  return ctx.db
    .select({ e: trainingExports, by: users.name })
    .from(trainingExports).innerJoin(users, eq(users.id, trainingExports.createdBy))
    .where(eq(trainingExports.orgId, ctx.orgId)).orderBy(desc(trainingExports.createdAt));
}

export async function trainingEligibility(ctx: Ctx) {
  assertCan(ctx.role, "training.manage");
  return ctx.db.select({ id: cases.id, ref: cases.ref, title: cases.title, permitted: cases.trainingPermitted, basis: cases.trainingBasis })
    .from(cases).where(eq(cases.orgId, ctx.orgId)).orderBy(asc(cases.ref));
}

export async function readTrainingExport(ctx: Ctx, exportId: string) {
  assertCan(ctx.role, "training.manage");
  const [row] = await ctx.db.select().from(trainingExports).where(and(eq(trainingExports.id, exportId), eq(trainingExports.orgId, ctx.orgId), isNull(trainingExports.deletedAt)));
  if (!row || !row.storageKey) throw new AppError("not_found", "That export does not exist or was deleted.");
  return { row, bytes: await readOriginal(row.storageKey) };
}

/** Delete the dataset file (for example at the end of a pilot). The log row stays as evidence. */
export async function deleteTrainingExport(ctx: Ctx, exportId: string) {
  assertCan(ctx.role, "training.manage");
  const [row] = await ctx.db.select().from(trainingExports).where(and(eq(trainingExports.id, exportId), eq(trainingExports.orgId, ctx.orgId)));
  if (!row) throw new AppError("not_found", "That export does not exist.");
  if (row.deletedAt) throw new AppError("conflict", "That export was already deleted.");
  if (row.storageKey) await deleteStored(row.storageKey);
  await ctx.db.update(trainingExports).set({ deletedAt: new Date(), deletedBy: ctx.userId, storageKey: null }).where(eq(trainingExports.id, row.id));
  await audit(ctx.db, ctx, "training.export_deleted", "training_export", row.id, null, { sha256: row.sha256, cases: row.caseRefs });
  const caseIds = (await ctx.db.select({ id: cases.id }).from(cases).where(and(eq(cases.orgId, ctx.orgId), inArray(cases.ref, row.caseRefs.length ? row.caseRefs : ["-"])))).map((c) => c.id);
  for (const id of caseIds) await audit(ctx.db, ctx, "training.case_export_deleted", "training_export", row.id, id, { sha256: row.sha256 });
}
