import { and, asc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db";
import {
  aiRuns, cases, comparisons, evidenceGaps, flags, handoverVersions, hypotheses, organizations, proposals, questions, segments, sources, statements, suggestions,
} from "../db/schema";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import { assertCan } from "../permissions";
import { audit } from "../audit";
import { PLANS, withinLimit } from "../plans";
import { loadCase } from "../services/cases";
import { getProvider } from "./provider";
import { acceptAnalysis, acceptChronology, acceptEvidence } from "./validate";
import { AiError, type AiProvider } from "./types";

const STALE_MS = 15 * 60 * 1000;

export type RunKind = "chronology" | "evidence" | "analysis";
type SourceRow = typeof sources.$inferSelect;
type RunRow = typeof aiRuns.$inferSelect;
type CaseRow = typeof cases.$inferSelect;

export async function aiRunsThisMonth(db: Db, orgId: string) {
  const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [r] = await db.select({
    runs: sql<number>`count(*)::int`,
    tokens: sql<number>`coalesce(sum(${aiRuns.inputTokens} + ${aiRuns.outputTokens}), 0)::int`,
  }).from(aiRuns).where(and(eq(aiRuns.orgId, orgId), gte(aiRuns.createdAt, start), ne(aiRuns.status, "failed")));
  return r;
}

/**
 * Which records the AI may read. Unconfirmed permission does not permit use, and a superseded copy is replaced by
 * its correction. Everything left out is reported so incomplete coverage is never shown as complete.
 */
export function eligibleSources(srcs: SourceRow[]) {
  const included: SourceRow[] = [];
  const excluded: { code: string; reason: string }[] = [];
  for (const s of srcs) {
    if (!s.available) continue;
    if (s.supersededAt) excluded.push({ code: s.code, reason: `superseded by ${srcs.find((x) => x.supersedesId === s.id)?.code ?? "a corrected copy"}` });
    else if (s.authorisation === "withdrawn") excluded.push({ code: s.code, reason: "authorisation withdrawn" });
    else if (s.authorisation !== "confirmed") excluded.push({ code: s.code, reason: "authorisation not confirmed" });
    else included.push(s);
  }
  return { included, excluded };
}

/** Checked statements that rest on a current, authorised record and are not waiting for a re-check. */
async function usableStatements(db: Db, caseId: string) {
  const rows = await db.select({ s: statements, src: sources }).from(statements)
    .innerJoin(segments, eq(segments.id, statements.segmentId)).innerJoin(sources, eq(sources.id, segments.sourceId))
    .where(and(eq(statements.caseId, caseId), inArray(statements.status, ["accepted", "edited"]), eq(statements.needsReassessment, false)));
  return rows.filter((r) => r.src.authorisation === "confirmed" && !r.src.supersededAt).map((r) => r.s);
}

/** Queue an AI run. The caller schedules `executeRun` after responding, and the page polls the run. */
export async function startRun(ctx: Ctx, caseId: string, kind: RunKind, hypothesisId?: string) {
  assertCan(ctx.role, "ai.run");
  const c = await loadCase(ctx, caseId);
  if (c.status === "closed") throw new AppError("conflict", "This case is closed. Reopen it to draft.");
  if (kind === "evidence") {
    const [h] = await ctx.db.select().from(hypotheses).where(and(eq(hypotheses.id, hypothesisId ?? ""), eq(hypotheses.caseId, caseId)));
    if (!h) throw new AppError("not_found", "That explanation does not exist.");
  }
  if (kind === "chronology") {
    const { included } = eligibleSources(await ctx.db.select().from(sources).where(eq(sources.caseId, caseId)));
    if (!included.length) throw new AppError("conflict", "No record is cleared for AI processing. Import a record and confirm its authorisation on the Sources tab.");
  } else if (!(await usableStatements(ctx.db, caseId)).length) {
    throw new AppError("conflict", "No checked statements from authorised records yet. Check the chronology first.");
  }
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  const used = await aiRunsThisMonth(ctx.db, ctx.orgId);
  if (!withinLimit(PLANS[org.plan].aiRunsPerMonth, used.runs)) throw new AppError("limit", `This month's ${PLANS[org.plan].aiRunsPerMonth} AI drafting runs on the ${PLANS[org.plan].label} plan are used.`);

  const active = await ctx.db.select().from(aiRuns).where(and(
    eq(aiRuns.caseId, caseId), eq(aiRuns.kind, kind), inArray(aiRuns.status, ["queued", "running"]),
    kind === "evidence" ? eq(aiRuns.targetId, hypothesisId!) : sql`true`,
  ));
  if (active.some((r) => Date.now() - r.createdAt.getTime() < STALE_MS)) throw new AppError("conflict", "This is already running. Wait for it to finish.");

  const provider = getProvider();
  const [run] = await ctx.db.insert(aiRuns).values({
    orgId: ctx.orgId, caseId, kind, targetId: hypothesisId ?? null, provider: provider.name, model: provider.model, createdBy: ctx.userId,
  }).returning();
  await audit(ctx.db, ctx, "ai.run_started", "ai_run", run.id, caseId, { kind, provider: provider.name, model: provider.model });
  return run;
}

export async function getRun(ctx: Ctx, runId: string) {
  const [run] = await ctx.db.select().from(aiRuns).where(and(eq(aiRuns.id, runId), eq(aiRuns.orgId, ctx.orgId)));
  if (!run) throw new AppError("not_found", "That run does not exist.");
  if ((run.status === "queued" || run.status === "running") && Date.now() - run.createdAt.getTime() > STALE_MS) {
    await ctx.db.update(aiRuns).set({ status: "failed", error: "The run did not finish. Start it again.", finishedAt: new Date() }).where(eq(aiRuns.id, run.id));
    return { ...run, status: "failed" as const, error: "The run did not finish. Start it again." };
  }
  return run;
}

export async function latestRuns(ctx: Ctx, caseId: string) {
  return ctx.db.select().from(aiRuns).where(eq(aiRuns.caseId, caseId)).orderBy(sql`${aiRuns.createdAt} desc`).limit(20);
}

/** Do the work for a queued run. Never throws; failures are recorded on the run and stay visible. */
export async function executeRun(db: Db, runId: string, provider: AiProvider = getProvider()) {
  const [run] = await db.select().from(aiRuns).where(eq(aiRuns.id, runId));
  if (!run || run.status !== "queued") return;
  await db.update(aiRuns).set({ status: "running" }).where(eq(aiRuns.id, run.id));
  const actor = { orgId: run.orgId, userId: run.createdBy };
  try {
    const [c] = await db.select().from(cases).where(eq(cases.id, run.caseId));
    const result = run.kind === "chronology" ? await runChronology(db, run, c, provider)
      : run.kind === "evidence" ? await runEvidence(db, run, c, provider)
      : await runAnalysis(db, run, c, provider);
    await db.update(aiRuns).set({ status: "succeeded", finishedAt: new Date(), ...result }).where(eq(aiRuns.id, run.id));
    await audit(db, actor, "ai.run_succeeded", "ai_run", run.id, run.caseId, { kind: run.kind, produced: result.produced, dropped: result.dropped, coverage: result.coverage });
  } catch (e) {
    const message = e instanceof AiError || e instanceof AppError ? e.message : "The draft could not be completed. Nothing was changed. Try again.";
    if (!(e instanceof AiError) && !(e instanceof AppError)) console.error("[ai run]", run.id, e);
    await db.update(aiRuns).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(aiRuns.id, run.id));
    await audit(db, actor, "ai.run_failed", "ai_run", run.id, run.caseId, { kind: run.kind, error: message });
  }
}

const nextNumber = (codes: string[], prefix: string) =>
  codes.reduce((m, c) => (c.startsWith(prefix) ? Math.max(m, Number(c.slice(prefix.length)) || 0) : m), 0) + 1;

async function touch(db: Db, caseId: string) {
  await db.update(cases).set({
    updatedAt: new Date(),
    changedSinceApproval: sql`exists (select 1 from ${handoverVersions} where ${handoverVersions.caseId} = ${caseId})`,
  }).where(eq(cases.id, caseId));
}

async function runChronology(db: Db, run: RunRow, c: CaseRow, provider: AiProvider) {
  const srcs = await db.select().from(sources).where(eq(sources.caseId, c.id)).orderBy(asc(sources.importedAt));
  const segs = await db.select().from(segments).where(eq(segments.caseId, c.id)).orderBy(asc(segments.ordinal));
  const { included, excluded } = eligibleSources(srcs);
  if (!included.length) throw new AiError("No record is cleared for AI processing. Confirm authorisation on the Sources tab.");
  const unavailable = srcs.filter((s) => !s.available);
  const includedIds = new Set(included.map((s) => s.id));
  const usableSegs = segs.filter((g) => includedIds.has(g.sourceId));
  const out = await provider.chronology({
    case: { ref: c.ref, aircraft: c.aircraft, system: c.system, question: c.question, evidenceCutoff: c.evidenceCutoff },
    sources: included.map((s) => ({ code: s.code, title: s.title, custodian: s.custodian, segments: usableSegs.filter((g) => g.sourceId === s.id).map((g) => ({ locator: g.locator, text: g.text })) })),
    unavailable: [
      ...unavailable.map((s) => ({ code: s.code, title: s.title, reason: s.unavailableReason ?? "" })),
      ...excluded.map((x) => ({ code: x.code, title: srcs.find((s) => s.code === x.code)!.title, reason: `not available to this analysis: ${x.reason}` })),
    ],
  });
  const segByLoc = new Map(usableSegs.map((g) => [g.locator, g]));
  const refCodes = new Set([...unavailable.map((s) => s.code), ...excluded.map((x) => x.code)]);
  const { statements: drafts, flags: draftFlags, dropped } = acceptChronology(out.data, new Set(segByLoc.keys()), refCodes);
  const coverage = { included: included.map((s) => s.code), excluded };

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    // Replace only what nobody has reviewed. Checked statements and decided flags are never touched.
    const existing = await tx.select().from(statements).where(eq(statements.caseId, c.id));
    const reviewedLocators = new Set(existing.filter((s) => s.status !== "unreviewed").map((s) => s.locator));
    await tx.delete(statements).where(and(eq(statements.caseId, c.id), eq(statements.status, "unreviewed"), eq(statements.origin, "ai")));
    await tx.delete(flags).where(and(eq(flags.caseId, c.id), eq(flags.status, "open"), isNotNull(flags.aiRunId)));

    let n = nextNumber(existing.map((s) => s.code), "C");
    const fresh = drafts.filter((d) => !reviewedLocators.has(d.locator));
    if (fresh.length) {
      await tx.insert(statements).values(fresh.map((d) => ({
        orgId: c.orgId, caseId: c.id, code: `C${n++}`, segmentId: segByLoc.get(d.locator)!.id, locator: d.locator, eventDate: d.eventDate,
        kind: d.kind, text: d.text, draftText: d.text, conditions: d.conditions, uncertain: d.uncertain, uncertainNote: d.uncertainNote,
        status: "unreviewed" as const, origin: "ai" as const, aiRunId: run.id,
      })));
    }
    const existingFlags = await tx.select({ code: flags.code }).from(flags).where(eq(flags.caseId, c.id));
    let f = nextNumber(existingFlags.map((x) => x.code), "F");
    const allFlags = [
      ...draftFlags,
      ...excluded.map((x) => ({ type: "gap" as const, text: `${x.code} was not read by the AI drafting run: ${x.reason}. Its content is not in this draft.`, refs: [x.code] })),
    ];
    if (allFlags.length) {
      await tx.insert(flags).values(allFlags.map((d) => ({ orgId: c.orgId, caseId: c.id, code: `F${f++}`, type: d.type, text: d.text, refs: d.refs, aiRunId: run.id })));
    }
    await touch(tx, c.id);
    return { produced: fresh.length, dropped, inputTokens: out.inputTokens, outputTokens: out.outputTokens, model: out.model, coverage };
  });
}

async function runEvidence(db: Db, run: RunRow, c: CaseRow, provider: AiProvider) {
  const hs = await db.select().from(hypotheses).where(eq(hypotheses.caseId, c.id));
  const h = hs.find((x) => x.id === run.targetId);
  if (!h) throw new AiError("The explanation was deleted before drafting finished.");
  const checked = await usableStatements(db, c.id);
  if (!checked.length) throw new AiError("No checked statements from authorised records yet. Check the chronology first.");
  const out = await provider.evidence({
    case: { ref: c.ref, aircraft: c.aircraft, system: c.system, question: c.question },
    hypothesis: { code: h.code, title: h.title, text: h.text },
    others: hs.filter((x) => x.id !== h.id).map((x) => ({ code: x.code, title: x.title, text: x.text })),
    statements: checked.map(toAiStatement),
  });
  const byCode = new Map(checked.map((s) => [s.code, s]));
  const { links, gaps, dropped } = acceptEvidence(out.data, new Set(byCode.keys()));

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx.delete(suggestions).where(eq(suggestions.hypothesisId, h.id));
    await tx.delete(evidenceGaps).where(and(eq(evidenceGaps.hypothesisId, h.id), eq(evidenceGaps.status, "open")));
    if (links.length) {
      await tx.insert(suggestions).values(links.map((l) => ({
        orgId: c.orgId, caseId: c.id, hypothesisId: h.id, statementId: byCode.get(l.statement)!.id, relation: l.relation, rationale: l.rationale, caveat: l.caveat, aiRunId: run.id,
      })));
    }
    if (gaps.length) await tx.insert(evidenceGaps).values(gaps.map((text) => ({ orgId: c.orgId, caseId: c.id, hypothesisId: h.id, text, aiRunId: run.id })));
    return { produced: links.length, dropped, inputTokens: out.inputTokens, outputTokens: out.outputTokens, model: out.model, coverage: null };
  });
}

/** Stages 5 and 6: compare findings, then propose explanations and questions for engineering review. */
async function runAnalysis(db: Db, run: RunRow, c: CaseRow, provider: AiProvider) {
  const checked = await usableStatements(db, c.id);
  if (!checked.length) throw new AiError("No checked statements from authorised records yet. Check the chronology first.");
  const [hs, qs] = await Promise.all([
    db.select().from(hypotheses).where(eq(hypotheses.caseId, c.id)),
    db.select().from(questions).where(and(eq(questions.caseId, c.id), eq(questions.status, "open"))),
  ]);
  const out = await provider.analysis({
    case: { ref: c.ref, aircraft: c.aircraft, system: c.system, question: c.question },
    statements: checked.map(toAiStatement),
    explanations: hs.map((h) => ({ code: h.code, title: h.title, text: h.text, assessment: h.assessment })),
    openQuestions: qs.map((q) => q.text),
  });
  const r = acceptAnalysis(out.data, new Set(checked.map((s) => s.code)));

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    // Earlier undecided output is replaced; anything an engineer decided stays.
    await tx.delete(comparisons).where(and(eq(comparisons.caseId, c.id), eq(comparisons.status, "open")));
    await tx.delete(proposals).where(and(eq(proposals.caseId, c.id), eq(proposals.status, "proposed")));
    const [cc, pc] = await Promise.all([
      tx.select({ code: comparisons.code }).from(comparisons).where(eq(comparisons.caseId, c.id)),
      tx.select({ code: proposals.code }).from(proposals).where(eq(proposals.caseId, c.id)),
    ]);
    let x = nextNumber(cc.map((v) => v.code), "X");
    let p = nextNumber(pc.map((v) => v.code), "P");
    if (r.comparisons.length) await tx.insert(comparisons).values(r.comparisons.map((v) => ({ orgId: c.orgId, caseId: c.id, code: `X${x++}`, ...v, aiRunId: run.id })));
    const props = [
      ...r.explanations.map((e) => ({ kind: "explanation" as const, title: e.title, text: e.text, basis: e.basis, uncertainty: e.uncertainty })),
      ...r.questions.map((q) => ({ kind: "question" as const, title: q.text.slice(0, 120), text: q.text, basis: q.basis, uncertainty: "" })),
    ];
    if (props.length) await tx.insert(proposals).values(props.map((v) => ({ orgId: c.orgId, caseId: c.id, code: `P${p++}`, ...v, aiRunId: run.id })));
    return { produced: r.comparisons.length + props.length, dropped: r.dropped, inputTokens: out.inputTokens, outputTokens: out.outputTokens, model: out.model, coverage: null };
  });
}

function toAiStatement(s: typeof statements.$inferSelect) {
  return { code: s.code, eventDate: s.eventDate, kind: s.kind, locator: s.locator, text: s.text, conditions: s.conditions, uncertain: s.uncertain, uncertainNote: s.uncertainNote };
}
