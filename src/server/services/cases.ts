import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import {
  aiRuns, ASSESSMENTS, auditEvents, cases, comparisons, decisions, evidenceGaps, flags, handoverVersions, hypotheses, memberships,
  organizations, proposals, questions, RELATIONS, segments, SOURCE_KINDS, sources, statements, STATEMENT_KINDS, suggestions, users,
  type Assessment, type Relation, type StatementKind,
} from "../db/schema";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import { assertCan, can, type Action } from "../permissions";
import { audit } from "../audit";
import { PLANS, withinLimit } from "../plans";
import { parseSourceWithReport, detectFormat } from "../sources/parse";
import { putOriginal } from "../sources/storage";
import { sha256 } from "../auth/crypto";
import { readiness, renderHandover, type HandoverData } from "@/lib/handover";

type CaseRow = typeof cases.$inferSelect;

/* ---------- helpers ---------- */

export async function loadCase(ctx: Ctx, caseId: string): Promise<CaseRow> {
  assertCan(ctx.role, "case.read");
  const [c] = await ctx.db.select().from(cases).where(and(eq(cases.id, caseId), eq(cases.orgId, ctx.orgId)));
  if (!c) throw new AppError("not_found", "That case does not exist in this organization.");
  return c;
}

/** Run a change to a case in one transaction, then mark the case updated (and changed since approval). */
async function mutate<T>(ctx: Ctx, caseId: string, action: Action, fn: (tx: Ctx, c: CaseRow) => Promise<T>): Promise<T> {
  assertCan(ctx.role, action);
  const c = await loadCase(ctx, caseId);
  if (c.status === "closed" && action !== "handover.approve") throw new AppError("conflict", "This case is closed. Reopen it to make changes.");
  return ctx.db.transaction(async (tx) => {
    const txCtx: Ctx = { ...ctx, db: tx as unknown as Db };
    const result = await fn(txCtx, c);
    await tx.update(cases).set({
      updatedAt: new Date(),
      changedSinceApproval: sql`exists (select 1 from ${handoverVersions} where ${handoverVersions.caseId} = ${caseId})`,
    }).where(eq(cases.id, caseId));
    return result;
  });
}

async function nextCode(db: Db, table: typeof statements | typeof flags | typeof hypotheses | typeof questions | typeof sources | typeof comparisons | typeof proposals, caseId: string, prefix: string) {
  const rows = await db.select({ code: table.code }).from(table).where(eq(table.caseId, caseId));
  const max = rows.reduce((m, r) => (r.code.startsWith(prefix) ? Math.max(m, Number(r.code.slice(prefix.length)) || 0) : m), 0);
  return `${prefix}${max + 1}`;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* ---------- cases ---------- */

const caseInput = z.object({
  title: z.string().trim().min(3, "Give the case a short title.").max(160),
  aircraft: z.string().trim().min(1, "Enter the aircraft or equipment identity.").max(120),
  system: z.string().trim().max(120).default(""),
  question: z.string().trim().min(10, "State the unresolved question in a sentence.").max(1000),
  evidenceCutoff: z.union([isoDate, z.literal("")]).optional(),
});

export async function createCase(ctx: Ctx, input: z.input<typeof caseInput>, opts: { isDemo?: boolean } = {}) {
  assertCan(ctx.role, "case.create");
  const parsed = caseInput.safeParse(input);
  if (!parsed.success) throw new AppError("invalid", parsed.error.issues[0].message);
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  const [{ open }] = await ctx.db.select({ open: sql<number>`count(*)::int` }).from(cases).where(and(eq(cases.orgId, ctx.orgId), eq(cases.status, "open")));
  if (!withinLimit(PLANS[org.plan].openCases, open)) throw new AppError("limit", `The ${PLANS[org.plan].label} plan allows ${PLANS[org.plan].openCases} open cases. Close a case or upgrade.`);

  const year = new Date().getUTCFullYear();
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(cases).where(eq(cases.orgId, ctx.orgId));
  const ref = `CASE-${year}-${String(n + 1).padStart(3, "0")}`;
  const [c] = await ctx.db.insert(cases).values({
    orgId: ctx.orgId, ref, createdBy: ctx.userId, responsibleEngineerId: ctx.userId, isDemo: !!opts.isDemo,
    ...parsed.data, evidenceCutoff: parsed.data.evidenceCutoff || null,
  }).returning();
  await audit(ctx.db, ctx, "case.created", "case", c.id, c.id, { ref, title: c.title });
  return c;
}

export async function listCases(ctx: Ctx) {
  assertCan(ctx.role, "case.read");
  const rows = await ctx.db.select().from(cases).where(eq(cases.orgId, ctx.orgId)).orderBy(desc(cases.updatedAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const stats = await ctx.db
    .select({ caseId: statements.caseId, unreviewed: sql<number>`count(*) filter (where ${statements.status} = 'unreviewed')::int`, total: sql<number>`count(*)::int` })
    .from(statements).where(inArray(statements.caseId, ids)).groupBy(statements.caseId);
  const versions = await ctx.db
    .select({ caseId: handoverVersions.caseId, latest: sql<number>`max(${handoverVersions.version})::int` })
    .from(handoverVersions).where(inArray(handoverVersions.caseId, ids)).groupBy(handoverVersions.caseId);
  return rows.map((r) => ({
    ...r,
    unreviewed: stats.find((s) => s.caseId === r.id)?.unreviewed ?? 0,
    statements: stats.find((s) => s.caseId === r.id)?.total ?? 0,
    latestVersion: versions.find((v) => v.caseId === r.id)?.latest ?? 0,
  }));
}

export async function setCaseStatus(ctx: Ctx, caseId: string, status: "open" | "closed") {
  assertCan(ctx.role, "handover.approve");
  const c = await loadCase(ctx, caseId);
  if (status === "open" && c.status === "closed") {
    const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
    const [{ open }] = await ctx.db.select({ open: sql<number>`count(*)::int` }).from(cases).where(and(eq(cases.orgId, ctx.orgId), eq(cases.status, "open")));
    if (!withinLimit(PLANS[org.plan].openCases, open)) throw new AppError("limit", `The ${PLANS[org.plan].label} plan allows ${PLANS[org.plan].openCases} open cases.`);
  }
  await ctx.db.update(cases).set({ status, updatedAt: new Date() }).where(eq(cases.id, caseId));
  await audit(ctx.db, ctx, status === "closed" ? "case.closed" : "case.reopened", "case", caseId, caseId);
}

/** Change the case framing. A changed question or cutoff sends assessed explanations back for review. */
export async function updateCaseDetails(ctx: Ctx, caseId: string, input: z.input<typeof caseInput>) {
  const parsed = caseInput.safeParse(input);
  if (!parsed.success) throw new AppError("invalid", parsed.error.issues[0].message);
  return mutate(ctx, caseId, "case.edit", async (tx, c) => {
    const next = { ...parsed.data, evidenceCutoff: parsed.data.evidenceCutoff || null };
    await tx.db.update(cases).set(next).where(eq(cases.id, caseId));
    const reasons: string[] = [];
    if (next.question !== c.question) reasons.push("the case question changed");
    if (next.evidenceCutoff !== c.evidenceCutoff) reasons.push("the evidence cutoff changed");
    if (reasons.length) await flagAssessedHypotheses(tx.db, caseId, `Reassess: ${reasons.join(" and ")} on ${today()}.`);
    await audit(tx.db, ctx, "case.details_changed", "case", caseId, caseId, {
      ...(next.question !== c.question ? { questionFrom: c.question, questionTo: next.question } : {}),
      ...(next.evidenceCutoff !== c.evidenceCutoff ? { cutoffFrom: c.evidenceCutoff, cutoffTo: next.evidenceCutoff } : {}),
      ...(next.title !== c.title ? { title: next.title } : {}),
    });
  });
}

export async function assignResponsibleEngineer(ctx: Ctx, caseId: string, userId: string) {
  return mutate(ctx, caseId, "case.assign", async (tx) => {
    const [m] = await tx.db.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)));
    if (!m || !can(m.role, "statement.review")) throw new AppError("invalid", "The responsible engineer must be a member who can do engineering work.");
    await tx.db.update(cases).set({ responsibleEngineerId: userId }).where(eq(cases.id, caseId));
    await audit(tx.db, ctx, "case.responsible_changed", "case", caseId, caseId, { userId });
  });
}

export async function caseEngineers(ctx: Ctx) {
  const rows = await ctx.db.select({ id: users.id, name: users.name, role: memberships.role }).from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, ctx.orgId)).orderBy(users.name);
  return rows.filter((r) => can(r.role, "statement.review"));
}

const today = () => new Date().toISOString().slice(0, 10);

/** Explanations that have been assessed or have evidence decisions need another review. */
async function flagAssessedHypotheses(db: Db, caseId: string, reason: string, onlyIds?: string[]) {
  const hs = await db.select({ id: hypotheses.id, assessment: hypotheses.assessment }).from(hypotheses).where(eq(hypotheses.caseId, caseId));
  const withDecisions = new Set((await db.select({ h: decisions.hypothesisId }).from(decisions).where(eq(decisions.caseId, caseId))).map((d) => d.h));
  const ids = hs.filter((h) => (h.assessment !== "not_assessed" || withDecisions.has(h.id)) && (!onlyIds || onlyIds.includes(h.id))).map((h) => h.id);
  if (ids.length) await db.update(hypotheses).set({ needsReassessment: true, reassessReason: reason }).where(inArray(hypotheses.id, ids));
  return ids.length;
}

/** Flag every live statement citing a source, and the explanations whose decisions rely on them. */
async function flagSourceDependents(db: Db, caseId: string, sourceId: string, reason: string) {
  const segIds = (await db.select({ id: segments.id }).from(segments).where(eq(segments.sourceId, sourceId))).map((s) => s.id);
  if (!segIds.length) return { statements: 0, hypotheses: 0 };
  const affected = await db.select({ id: statements.id, code: statements.code }).from(statements)
    .where(and(eq(statements.caseId, caseId), inArray(statements.segmentId, segIds), ne(statements.status, "rejected")));
  if (!affected.length) return { statements: 0, hypotheses: 0 };
  await db.update(statements).set({ needsReassessment: true, reassessReason: reason }).where(inArray(statements.id, affected.map((a) => a.id)));
  const hypIds = [...new Set((await db.select({ h: decisions.hypothesisId }).from(decisions).where(inArray(decisions.statementId, affected.map((a) => a.id)))).map((d) => d.h))];
  const n = hypIds.length ? await flagAssessedHypotheses(db, caseId, `Reassess: evidence ${affected.map((a) => a.code).join(", ")} changed basis. ${reason}`, hypIds) : 0;
  return { statements: affected.length, hypotheses: n };
}

/* ---------- sources ---------- */

const sourceMeta = z.object({
  title: z.string().trim().min(2, "Give the source a title, such as its page or document number.").max(200),
  custodian: z.string().trim().max(200).default(""),
  kind: z.enum(SOURCE_KINDS).default("other"),
});

export async function importSource(
  ctx: Ctx, caseId: string,
  input: z.input<typeof sourceMeta> & { fileName: string; mimeType: string; bytes: Uint8Array; supersedesSourceId?: string; authorisationBasis?: string },
) {
  const meta = sourceMeta.safeParse(input);
  if (!meta.success) throw new AppError("invalid", meta.error.issues[0].message);
  if (!input.bytes.byteLength) throw new AppError("invalid", "Choose a file or paste the record text.");
  if (input.bytes.byteLength > 10 * 1024 * 1024) throw new AppError("invalid", "Files are limited to 10 MB.");

  return mutate(ctx, caseId, "source.import", async (tx) => {
    let old: typeof sources.$inferSelect | undefined;
    if (input.supersedesSourceId) {
      [old] = await tx.db.select().from(sources).where(and(eq(sources.id, input.supersedesSourceId), eq(sources.caseId, caseId)));
      if (!old || !old.available) throw new AppError("not_found", "The record being corrected does not exist in this case.");
      if (old.supersededAt) throw new AppError("conflict", `${old.code} has already been superseded. Correct the latest version instead.`);
    }
    const code = await nextCode(tx.db, sources, caseId, "S");
    const { segments: segs, report } = await parseSourceWithReport(code, input.bytes, detectFormat(input.fileName, input.mimeType));
    const stored = await putOriginal(ctx.orgId, input.bytes);
    const basis = input.authorisationBasis?.trim();
    const confirm = !!basis && can(ctx.role, "source.authorise");
    const [src] = await tx.db.insert(sources).values({
      orgId: ctx.orgId, caseId, code, ...meta.data, available: true,
      fileName: input.fileName, mimeType: input.mimeType, byteSize: input.bytes.byteLength,
      sha256: stored.sha256, storageKey: stored.key, importedBy: ctx.userId, processing: report, supersedesId: old?.id ?? null,
      ...(confirm ? { authorisation: "confirmed" as const, authorisationBasis: basis, authorisedBy: ctx.userId, authorisedAt: new Date() } : {}),
    }).returning();
    if (old) {
      await tx.db.update(sources).set({ supersededAt: new Date() }).where(eq(sources.id, old.id));
      const hit = await flagSourceDependents(tx.db, caseId, old.id, `${old.code} was superseded by corrected copy ${code} on ${today()}. Re-check against ${code}.`);
      await audit(tx.db, ctx, "source.superseded", "source", old.id, caseId, { old: old.code, new: code, ...hit });
    }
    for (let i = 0; i < segs.length; i += 500) {
      await tx.db.insert(segments).values(segs.slice(i, i + 500).map((s) => ({ ...s, orgId: ctx.orgId, caseId, sourceId: src.id })));
    }
    await audit(tx.db, ctx, "source.imported", "source", src.id, caseId, { code, title: src.title, sha256: stored.sha256, segments: segs.length });
    return { source: src, segmentCount: segs.length };
  });
}

export async function addUnavailableSource(ctx: Ctx, caseId: string, input: { title: string; reason: string; custodian?: string }) {
  const title = input.title.trim(), reason = input.reason.trim();
  if (title.length < 2) throw new AppError("invalid", "Name the record that is unavailable.");
  if (reason.length < 3) throw new AppError("invalid", "Say why it is unavailable, for example who it was requested from and when.");
  return mutate(ctx, caseId, "source.import", async (tx) => {
    const code = await nextCode(tx.db, sources, caseId, "U");
    const [src] = await tx.db.insert(sources).values({
      orgId: ctx.orgId, caseId, code, title, custodian: input.custodian?.trim() ?? "", available: false, unavailableReason: reason, importedBy: ctx.userId,
    }).returning();
    await audit(tx.db, ctx, "source.marked_unavailable", "source", src.id, caseId, { code, title, reason });
    return src;
  });
}

export async function setSourceAuthorisation(ctx: Ctx, caseId: string, sourceId: string, status: "confirmed" | "withdrawn" | "unconfirmed", basis: string) {
  const b = basis.trim();
  if (status !== "unconfirmed" && b.length < 5) throw new AppError("invalid", status === "confirmed"
    ? "Record the basis for authorisation, such as the agreement and section that permits this use."
    : "Record why authorisation was withdrawn.");
  return mutate(ctx, caseId, "source.authorise", async (tx) => {
    const [s] = await tx.db.select().from(sources).where(and(eq(sources.id, sourceId), eq(sources.caseId, caseId)));
    if (!s || !s.available) throw new AppError("not_found", "That source does not exist in this case.");
    await tx.db.update(sources).set({ authorisation: status, authorisationBasis: b || null, authorisedBy: ctx.userId, authorisedAt: new Date() }).where(eq(sources.id, s.id));
    let hit = { statements: 0, hypotheses: 0 };
    if (status === "withdrawn") hit = await flagSourceDependents(tx.db, caseId, s.id, `Authorisation for ${s.code} was withdrawn on ${today()}: ${b}`);
    await audit(tx.db, ctx, `source.authorisation_${status}`, "source", s.id, caseId, { code: s.code, basis: b, ...hit });
  });
}

export async function caseSources(ctx: Ctx, caseId: string) {
  await loadCase(ctx, caseId);
  const srcs = await ctx.db.select().from(sources).where(eq(sources.caseId, caseId)).orderBy(asc(sources.importedAt));
  const segs = await ctx.db.select().from(segments).where(eq(segments.caseId, caseId)).orderBy(asc(segments.ordinal));
  return srcs.map((s) => ({ ...s, segments: segs.filter((g) => g.sourceId === s.id) }));
}

export async function getSource(ctx: Ctx, sourceId: string) {
  assertCan(ctx.role, "case.read");
  const [s] = await ctx.db.select().from(sources).where(and(eq(sources.id, sourceId), eq(sources.orgId, ctx.orgId)));
  if (!s) throw new AppError("not_found", "That source does not exist.");
  return s;
}

/* ---------- statements ---------- */

export async function caseStatements(ctx: Ctx, caseId: string) {
  await loadCase(ctx, caseId);
  const rows = await ctx.db.select().from(statements).where(eq(statements.caseId, caseId));
  return rows.sort((a, b) => (a.eventDate ?? "9").localeCompare(b.eventDate ?? "9") || a.locator.localeCompare(b.locator, undefined, { numeric: true }));
}

async function statementInCase(db: Db, caseId: string, statementId: string) {
  const [s] = await db.select().from(statements).where(and(eq(statements.id, statementId), eq(statements.caseId, caseId)));
  if (!s) throw new AppError("not_found", "That statement does not exist in this case.");
  return s;
}

async function assertNoDecisions(db: Db, statementId: string, code: string) {
  const ds = await db.select({ h: hypotheses.code }).from(decisions).innerJoin(hypotheses, eq(hypotheses.id, decisions.hypothesisId)).where(eq(decisions.statementId, statementId));
  if (ds.length) throw new AppError("conflict", `${code} is used in evidence decisions for ${ds.map((d) => d.h).join(", ")}. Clear those decisions first.`);
}

export async function reviewStatement(ctx: Ctx, caseId: string, statementId: string, verdict: "accept" | "reject" | "reset", editedText?: string) {
  return mutate(ctx, caseId, "statement.review", async (tx) => {
    const s = await statementInCase(tx.db, caseId, statementId);
    let patch: Partial<typeof statements.$inferInsert>;
    if (verdict === "accept") {
      if (s.needsReassessment) {
        const src = await sourceOfSegment(tx.db, s.segmentId);
        if (src.supersededAt || src.authorisation === "withdrawn")
          throw new AppError("conflict", `${s.code} cites ${src.code}, which ${src.supersededAt ? "has been superseded" : "can no longer be used"}. Re-check it against a current record line.`);
      }
      const text = editedText !== undefined ? editedText.trim() : s.text;
      if (!text) throw new AppError("invalid", "The statement cannot be empty.");
      if (text.length > 1000) throw new AppError("invalid", "Keep a statement under 1,000 characters.");
      patch = { text, status: text === s.draftText ? "accepted" : "edited", reviewedBy: ctx.userId, reviewedAt: new Date(), needsReassessment: false, reassessReason: null };
    } else {
      await assertNoDecisions(tx.db, s.id, s.code);
      patch = verdict === "reject"
        ? { status: "rejected", reviewedBy: ctx.userId, reviewedAt: new Date() }
        : { status: "unreviewed", reviewedBy: null, reviewedAt: null };
    }
    await tx.db.update(statements).set(patch).where(eq(statements.id, s.id));
    await audit(tx.db, ctx, `statement.${patch.status}`, "statement", s.id, caseId, { code: s.code, ...(patch.text && patch.text !== s.text ? { from: s.text, to: patch.text } : {}) });
  });
}

async function sourceOfSegment(db: Db, segmentId: string) {
  const [row] = await db.select({ src: sources }).from(segments).innerJoin(sources, eq(sources.id, segments.sourceId)).where(eq(segments.id, segmentId));
  return row.src;
}

/** Re-check a flagged statement against a current record line. The engineer may also correct the wording. */
export async function recheckStatement(ctx: Ctx, caseId: string, statementId: string, input: { locator: string; text: string; conditions?: string }) {
  return mutate(ctx, caseId, "statement.review", async (tx) => {
    const s = await statementInCase(tx.db, caseId, statementId);
    const loc = input.locator.trim(), text = input.text.trim();
    if (text.length < 3) throw new AppError("invalid", "The statement cannot be empty.");
    const [row] = await tx.db.select({ seg: segments, src: sources }).from(segments).innerJoin(sources, eq(sources.id, segments.sourceId))
      .where(and(eq(segments.caseId, caseId), eq(segments.locator, loc)));
    if (!row) throw new AppError("invalid", `No line ${loc} exists in this case.`);
    if (row.src.supersededAt) throw new AppError("invalid", `${row.src.code} has been superseded. Cite a line in the latest version.`);
    if (row.src.authorisation === "withdrawn") throw new AppError("invalid", `Authorisation for ${row.src.code} was withdrawn.`);
    await tx.db.update(statements).set({
      segmentId: row.seg.id, locator: row.seg.locator, text, conditions: input.conditions !== undefined ? input.conditions.trim().slice(0, 300) : s.conditions,
      status: text === s.draftText && row.seg.locator === s.locator ? "accepted" : "edited",
      needsReassessment: false, reassessReason: null, reviewedBy: ctx.userId, reviewedAt: new Date(),
    }).where(eq(statements.id, s.id));
    await audit(tx.db, ctx, "statement.rechecked", "statement", s.id, caseId, { code: s.code, fromLocator: s.locator, toLocator: row.seg.locator, ...(text !== s.text ? { from: s.text, to: text } : {}), ...(input.conditions !== undefined && input.conditions.trim() !== s.conditions ? { conditionsFrom: s.conditions, conditionsTo: input.conditions.trim() } : {}) });
  });
}

const manualStatement = z.object({
  locator: z.string().trim().min(3),
  kind: z.enum(STATEMENT_KINDS),
  text: z.string().trim().min(3, "Write the statement.").max(1000),
  eventDate: z.union([isoDate, z.literal("")]).optional(),
  conditions: z.string().trim().max(300).default(""),
});

export async function addStatement(ctx: Ctx, caseId: string, input: z.input<typeof manualStatement>) {
  const p = manualStatement.safeParse(input);
  if (!p.success) throw new AppError("invalid", p.error.issues[0].message);
  return mutate(ctx, caseId, "statement.review", async (tx) => {
    const [seg] = await tx.db.select().from(segments).where(and(eq(segments.caseId, caseId), eq(segments.locator, p.data.locator)));
    if (!seg) throw new AppError("invalid", `No line ${p.data.locator} exists in this case's sources. Use a locator shown beside the original record.`);
    const code = await nextCode(tx.db, statements, caseId, "C");
    const [s] = await tx.db.insert(statements).values({
      orgId: ctx.orgId, caseId, code, segmentId: seg.id, locator: seg.locator, kind: p.data.kind as StatementKind,
      text: p.data.text, draftText: p.data.text, conditions: p.data.conditions, eventDate: p.data.eventDate || null,
      status: "accepted", origin: "engineer", reviewedBy: ctx.userId, reviewedAt: new Date(),
    }).returning();
    await audit(tx.db, ctx, "statement.added", "statement", s.id, caseId, { code, locator: seg.locator });
    return s;
  });
}

/* ---------- flags ---------- */

export async function caseFlags(ctx: Ctx, caseId: string) {
  await loadCase(ctx, caseId);
  return ctx.db.select().from(flags).where(eq(flags.caseId, caseId)).orderBy(asc(flags.createdAt), asc(flags.code));
}

export async function decideFlag(ctx: Ctx, caseId: string, flagId: string, decision: "question" | "dismiss" | "reopen") {
  return mutate(ctx, caseId, "question.write", async (tx) => {
    const [f] = await tx.db.select().from(flags).where(and(eq(flags.id, flagId), eq(flags.caseId, caseId)));
    if (!f) throw new AppError("not_found", "That flag does not exist.");
    if (decision === "question") {
      if (f.status !== "open") throw new AppError("conflict", "That flag was already decided.");
      const code = await nextCode(tx.db, questions, caseId, "Q");
      await tx.db.insert(questions).values({ orgId: ctx.orgId, caseId, code, text: f.text, origin: "flag", originRef: f.code, createdBy: ctx.userId });
      await tx.db.update(flags).set({ status: "question", decidedBy: ctx.userId }).where(eq(flags.id, f.id));
    } else if (decision === "dismiss") {
      await tx.db.update(flags).set({ status: "dismissed", decidedBy: ctx.userId }).where(eq(flags.id, f.id));
    } else {
      await tx.db.delete(questions).where(and(eq(questions.caseId, caseId), eq(questions.origin, "flag"), eq(questions.originRef, f.code), eq(questions.status, "open")));
      await tx.db.update(flags).set({ status: "open", decidedBy: null }).where(eq(flags.id, f.id));
    }
    await audit(tx.db, ctx, `flag.${decision}`, "flag", f.id, caseId, { code: f.code });
  });
}

/* ---------- explanations and decisions ---------- */

const hypothesisInput = z.object({
  title: z.string().trim().min(3, "Give the explanation a short title.").max(120),
  text: z.string().trim().min(10, "Write the explanation in a sentence or two.").max(2000),
});

export async function createHypothesis(ctx: Ctx, caseId: string, input: z.input<typeof hypothesisInput>) {
  const p = hypothesisInput.safeParse(input);
  if (!p.success) throw new AppError("invalid", p.error.issues[0].message);
  return mutate(ctx, caseId, "hypothesis.write", async (tx) => {
    const code = await nextCode(tx.db, hypotheses, caseId, "H");
    const [h] = await tx.db.insert(hypotheses).values({ orgId: ctx.orgId, caseId, code, ...p.data, createdBy: ctx.userId }).returning();
    await audit(tx.db, ctx, "hypothesis.created", "hypothesis", h.id, caseId, { code, title: h.title });
    return h;
  });
}

export async function caseHypotheses(ctx: Ctx, caseId: string) {
  await loadCase(ctx, caseId);
  const hs = await ctx.db.select().from(hypotheses).where(eq(hypotheses.caseId, caseId)).orderBy(asc(hypotheses.createdAt));
  const ds = await ctx.db.select().from(decisions).where(eq(decisions.caseId, caseId));
  return hs.map((h) => {
    const mine = ds.filter((d) => d.hypothesisId === h.id);
    const n = (r: Relation) => mine.filter((d) => d.relation === r).length;
    return { ...h, tally: { supports: n("supports"), challenges: n("challenges"), inconclusive: n("inconclusive") }, decisionCount: mine.length };
  });
}

export async function hypothesisEvidence(ctx: Ctx, caseId: string, hypothesisId: string) {
  await loadCase(ctx, caseId);
  const [h] = await ctx.db.select().from(hypotheses).where(and(eq(hypotheses.id, hypothesisId), eq(hypotheses.caseId, caseId)));
  if (!h) throw new AppError("not_found", "That explanation does not exist.");
  const [sugs, decs, gaps] = await Promise.all([
    ctx.db.select().from(suggestions).where(eq(suggestions.hypothesisId, h.id)),
    ctx.db.select({ d: decisions, by: users.name }).from(decisions).innerJoin(users, eq(users.id, decisions.decidedBy)).where(eq(decisions.hypothesisId, h.id)),
    ctx.db.select().from(evidenceGaps).where(and(eq(evidenceGaps.hypothesisId, h.id), eq(evidenceGaps.status, "open"))),
  ]);
  return { hypothesis: h, suggestions: sugs, decisions: decs.map((x) => ({ ...x.d, decidedByName: x.by })), gaps };
}

export async function recordDecision(ctx: Ctx, caseId: string, input: { hypothesisId: string; statementId: string; relation: string; reason: string }) {
  if (!RELATIONS.includes(input.relation as Relation)) throw new AppError("invalid", "Choose Supports, Challenges, Inconclusive or Not relevant.");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new AppError("invalid", "Write why. The reason is what the next engineer reads.");
  return mutate(ctx, caseId, "decision.write", async (tx) => {
    const [h] = await tx.db.select().from(hypotheses).where(and(eq(hypotheses.id, input.hypothesisId), eq(hypotheses.caseId, caseId)));
    if (!h) throw new AppError("not_found", "That explanation does not exist.");
    const s = await statementInCase(tx.db, caseId, input.statementId);
    if (s.status !== "accepted" && s.status !== "edited") throw new AppError("conflict", `Check ${s.code} against its original record before using it as evidence.`);
    if (s.needsReassessment) throw new AppError("conflict", `${s.code} needs to be re-checked first: ${s.reassessReason}`);
    if (h.assessment !== "not_assessed") await tx.db.update(hypotheses).set({ needsReassessment: true, reassessReason: `Reassess: the evidence decision on ${s.code} changed after the last assessment.` }).where(eq(hypotheses.id, h.id));
    const values = { relation: input.relation as Relation, reason: reason.slice(0, 1000), decidedBy: ctx.userId, decidedAt: new Date() };
    await tx.db.insert(decisions).values({ orgId: ctx.orgId, caseId, hypothesisId: h.id, statementId: s.id, ...values })
      .onConflictDoUpdate({ target: [decisions.hypothesisId, decisions.statementId], set: values });
    await audit(tx.db, ctx, "decision.recorded", "decision", null, caseId, { hypothesis: h.code, statement: s.code, relation: input.relation, reason });
  });
}

export async function clearDecision(ctx: Ctx, caseId: string, hypothesisId: string, statementId: string) {
  return mutate(ctx, caseId, "decision.write", async (tx) => {
    const del = await tx.db.delete(decisions).where(and(eq(decisions.caseId, caseId), eq(decisions.hypothesisId, hypothesisId), eq(decisions.statementId, statementId))).returning();
    if (del.length) {
      await tx.db.update(hypotheses).set({ needsReassessment: true, reassessReason: "Reassess: an evidence decision was cleared after the last assessment." })
        .where(and(eq(hypotheses.id, hypothesisId), ne(hypotheses.assessment, "not_assessed")));
      await audit(tx.db, ctx, "decision.cleared", "decision", del[0].id, caseId, { relation: del[0].relation });
    }
  });
}

/** The engineer's reviewed interpretation of one explanation. It is never a root-cause finding. */
export async function assessHypothesis(ctx: Ctx, caseId: string, hypothesisId: string, assessment: string, note: string) {
  if (!(ASSESSMENTS as readonly string[]).includes(assessment) || assessment === "not_assessed") throw new AppError("invalid", "Choose an assessment.");
  const n = note.trim();
  if (n.length < 10) throw new AppError("invalid", "Explain the assessment in a sentence. It is what the reviewer and the next engineer read.");
  return mutate(ctx, caseId, "decision.write", async (tx) => {
    const [h] = await tx.db.select().from(hypotheses).where(and(eq(hypotheses.id, hypothesisId), eq(hypotheses.caseId, caseId)));
    if (!h) throw new AppError("not_found", "That explanation does not exist.");
    const pending = await tx.db.select({ code: statements.code }).from(decisions).innerJoin(statements, eq(statements.id, decisions.statementId))
      .where(and(eq(decisions.hypothesisId, h.id), eq(statements.needsReassessment, true)));
    if (pending.length) throw new AppError("conflict", `Re-check ${pending.map((p) => p.code).join(", ")} before assessing ${h.code}.`);
    if (assessment !== "unresolved") {
      const [{ n: count }] = await tx.db.select({ n: sql<number>`count(*)::int` }).from(decisions).where(and(eq(decisions.hypothesisId, h.id), ne(decisions.relation, "not_relevant")));
      if (!count) throw new AppError("conflict", `Record at least one evidence decision for ${h.code} before assessing it as consistent or not consistent. You can leave it unresolved.`);
    }
    await tx.db.update(hypotheses).set({ assessment: assessment as Assessment, assessmentNote: n.slice(0, 2000), assessedBy: ctx.userId, assessedAt: new Date(), needsReassessment: false, reassessReason: null }).where(eq(hypotheses.id, h.id));
    await audit(tx.db, ctx, "hypothesis.assessed", "hypothesis", h.id, caseId, { code: h.code, assessment, note: n });
  });
}

export async function decideGap(ctx: Ctx, caseId: string, gapId: string, decision: "question" | "dismiss") {
  return mutate(ctx, caseId, "question.write", async (tx) => {
    const [g] = await tx.db.select().from(evidenceGaps).where(and(eq(evidenceGaps.id, gapId), eq(evidenceGaps.caseId, caseId)));
    if (!g) throw new AppError("not_found", "That item does not exist.");
    if (decision === "question") {
      const [h] = await tx.db.select({ code: hypotheses.code }).from(hypotheses).where(eq(hypotheses.id, g.hypothesisId));
      const code = await nextCode(tx.db, questions, caseId, "Q");
      await tx.db.insert(questions).values({ orgId: ctx.orgId, caseId, code, text: g.text, origin: "evidence_gap", originRef: h?.code ?? null, createdBy: ctx.userId });
    }
    await tx.db.update(evidenceGaps).set({ status: decision === "question" ? "question" : "dismissed" }).where(eq(evidenceGaps.id, g.id));
    await audit(tx.db, ctx, `evidence_gap.${decision}`, "evidence_gap", g.id, caseId, { text: g.text });
  });
}

/* ---------- comparisons and proposals ---------- */

export async function caseComparisons(ctx: Ctx, caseId: string) {
  await loadCase(ctx, caseId);
  return ctx.db.select().from(comparisons).where(eq(comparisons.caseId, caseId)).orderBy(asc(comparisons.createdAt), asc(comparisons.code));
}

export async function caseProposals(ctx: Ctx, caseId: string) {
  await loadCase(ctx, caseId);
  return ctx.db.select().from(proposals).where(eq(proposals.caseId, caseId)).orderBy(asc(proposals.createdAt), asc(proposals.code));
}

export async function decideComparison(ctx: Ctx, caseId: string, comparisonId: string, decision: "question" | "dismiss" | "reopen") {
  return mutate(ctx, caseId, "question.write", async (tx) => {
    const [cmp] = await tx.db.select().from(comparisons).where(and(eq(comparisons.id, comparisonId), eq(comparisons.caseId, caseId)));
    if (!cmp) throw new AppError("not_found", "That comparison does not exist.");
    if (decision === "question") {
      if (cmp.status !== "open") throw new AppError("conflict", "That comparison was already decided.");
      const code = await nextCode(tx.db, questions, caseId, "Q");
      await tx.db.insert(questions).values({ orgId: ctx.orgId, caseId, code, text: `${cmp.title}: ${cmp.note}`, origin: "comparison", originRef: cmp.code, createdBy: ctx.userId });
    }
    if (decision === "reopen") await tx.db.delete(questions).where(and(eq(questions.caseId, caseId), eq(questions.origin, "comparison"), eq(questions.originRef, cmp.code), eq(questions.status, "open")));
    await tx.db.update(comparisons).set({ status: decision === "question" ? "question" : decision === "dismiss" ? "dismissed" : "open" }).where(eq(comparisons.id, cmp.id));
    await audit(tx.db, ctx, `comparison.${decision}`, "comparison", cmp.id, caseId, { code: cmp.code });
  });
}

/** Adopt, reject or leave unresolved an AI proposal. Adopting creates an engineer-owned explanation or question. */
export async function decideProposal(ctx: Ctx, caseId: string, proposalId: string, input: { decision: string; title?: string; text?: string; note?: string }) {
  const decision = input.decision;
  if (!["adopted", "rejected", "unresolved"].includes(decision)) throw new AppError("invalid", "Choose adopt, reject or leave unresolved.");
  const note = input.note?.trim() ?? "";
  if (decision !== "adopted" && note.length < 5) throw new AppError("invalid", "Say why, so the next engineer understands the decision.");
  return mutate(ctx, caseId, decision === "adopted" ? "hypothesis.write" : "question.write", async (tx) => {
    const [p] = await tx.db.select().from(proposals).where(and(eq(proposals.id, proposalId), eq(proposals.caseId, caseId)));
    if (!p) throw new AppError("not_found", "That proposal does not exist.");
    if (p.status === "adopted") throw new AppError("conflict", `${p.code} was already adopted.`);
    let created: string | undefined;
    if (decision === "adopted") {
      const title = (input.title ?? p.title).trim(), text = (input.text ?? p.text).trim();
      if (p.kind === "explanation") {
        const parsed = z.object({ title: z.string().min(3).max(120), text: z.string().min(10).max(2000) }).safeParse({ title, text });
        if (!parsed.success) throw new AppError("invalid", "Give the explanation a title and a sentence or two of text.");
        const code = await nextCode(tx.db, hypotheses, caseId, "H");
        await tx.db.insert(hypotheses).values({ orgId: ctx.orgId, caseId, code, title, text, origin: "ai_proposal", createdBy: ctx.userId });
        created = code;
      } else {
        if (text.length < 5) throw new AppError("invalid", "Write the question.");
        const code = await nextCode(tx.db, questions, caseId, "Q");
        await tx.db.insert(questions).values({ orgId: ctx.orgId, caseId, code, text: text.slice(0, 1000), origin: "ai_proposal", originRef: p.code, createdBy: ctx.userId });
        created = code;
      }
    }
    await tx.db.update(proposals).set({ status: decision as "adopted" | "rejected" | "unresolved", decisionNote: note || null, decidedBy: ctx.userId }).where(eq(proposals.id, p.id));
    await audit(tx.db, ctx, `proposal.${decision}`, "proposal", p.id, caseId, { code: p.code, note, ...(created ? { created } : {}) });
    return created;
  });
}

/* ---------- questions ---------- */

export async function caseQuestions(ctx: Ctx, caseId: string) {
  await loadCase(ctx, caseId);
  return ctx.db.select().from(questions).where(eq(questions.caseId, caseId)).orderBy(asc(questions.createdAt));
}

export async function addQuestion(ctx: Ctx, caseId: string, text: string) {
  const t = text.trim();
  if (t.length < 5) throw new AppError("invalid", "Write the question in a sentence.");
  return mutate(ctx, caseId, "question.write", async (tx) => {
    const code = await nextCode(tx.db, questions, caseId, "Q");
    await tx.db.insert(questions).values({ orgId: ctx.orgId, caseId, code, text: t.slice(0, 1000), origin: "engineer", createdBy: ctx.userId });
    await audit(tx.db, ctx, "question.added", "question", null, caseId, { code });
  });
}

export async function answerQuestion(ctx: Ctx, caseId: string, questionId: string, answer: string | null) {
  return mutate(ctx, caseId, "question.write", async (tx) => {
    const [q] = await tx.db.select().from(questions).where(and(eq(questions.id, questionId), eq(questions.caseId, caseId)));
    if (!q) throw new AppError("not_found", "That question does not exist.");
    const a = answer?.trim() ?? "";
    if (answer !== null && a.length < 3) throw new AppError("invalid", "Record the answer, or where it can be found.");
    await tx.db.update(questions).set(answer === null ? { status: "open", answer: null } : { status: "answered", answer: a.slice(0, 2000) }).where(eq(questions.id, q.id));
    await audit(tx.db, ctx, answer === null ? "question.reopened" : "question.answered", "question", q.id, caseId, { code: q.code });
  });
}

/* ---------- handover ---------- */

export async function handoverData(ctx: Ctx, caseId: string): Promise<HandoverData> {
  const c = await loadCase(ctx, caseId);
  const [srcs, segs, stmts, fl, hs, ds, qs, cmps, props, resp] = await Promise.all([
    ctx.db.select().from(sources).where(eq(sources.caseId, caseId)).orderBy(asc(sources.importedAt)),
    ctx.db.select({ id: segments.id, sourceId: segments.sourceId }).from(segments).where(eq(segments.caseId, caseId)),
    caseStatements(ctx, caseId),
    ctx.db.select().from(flags).where(eq(flags.caseId, caseId)).orderBy(asc(flags.createdAt)),
    ctx.db.select().from(hypotheses).where(eq(hypotheses.caseId, caseId)).orderBy(asc(hypotheses.createdAt)),
    ctx.db.select().from(decisions).where(eq(decisions.caseId, caseId)),
    ctx.db.select().from(questions).where(eq(questions.caseId, caseId)).orderBy(asc(questions.createdAt)),
    ctx.db.select().from(comparisons).where(eq(comparisons.caseId, caseId)).orderBy(asc(comparisons.createdAt), asc(comparisons.code)),
    ctx.db.select().from(proposals).where(eq(proposals.caseId, caseId)).orderBy(asc(proposals.createdAt), asc(proposals.code)),
    c.responsibleEngineerId ? ctx.db.select({ name: users.name }).from(users).where(eq(users.id, c.responsibleEngineerId)) : Promise.resolve([]),
  ]);
  const srcById = new Map(srcs.map((s) => [s.id, s]));
  const srcOfSeg = new Map(segs.map((g) => [g.id, srcById.get(g.sourceId)?.code ?? "?"]));
  return {
    case: { ref: c.ref, title: c.title, aircraft: c.aircraft, system: c.system, question: c.question, evidenceCutoff: c.evidenceCutoff, isDemo: c.isDemo, responsibleEngineer: resp[0]?.name ?? null },
    sources: srcs.map((s) => ({
      code: s.code, title: s.title, custodian: s.custodian, available: s.available, unavailableReason: s.unavailableReason, sha256: s.sha256, importedAt: s.importedAt.toISOString(),
      authorisation: s.authorisation, authorisationBasis: s.authorisationBasis,
      supersededBy: s.supersededAt ? srcs.find((x) => x.supersedesId === s.id)?.code ?? "a later copy" : null,
      supersedes: s.supersedesId ? srcById.get(s.supersedesId)?.code ?? null : null,
      processing: s.processing ?? null,
    })),
    statements: stmts.map((s) => ({
      code: s.code, locator: s.locator, source: srcOfSeg.get(s.segmentId) ?? "?", eventDate: s.eventDate, kind: s.kind, text: s.text, conditions: s.conditions,
      uncertain: s.uncertain, uncertainNote: s.uncertainNote, status: s.status, origin: s.origin, needsReassessment: s.needsReassessment, reassessReason: s.reassessReason,
      afterCutoff: !!(c.evidenceCutoff && s.eventDate && s.eventDate > c.evidenceCutoff),
    })),
    flags: fl.map((f) => ({ code: f.code, type: f.type, text: f.text, refs: f.refs, status: f.status })),
    hypotheses: hs.map((h) => ({
      code: h.code, title: h.title, text: h.text, origin: h.origin, assessment: h.assessment, assessmentNote: h.assessmentNote,
      needsReassessment: h.needsReassessment, reassessReason: h.reassessReason,
      decisions: ds.filter((d) => d.hypothesisId === h.id).map((d) => ({ statement: stmts.find((s) => s.id === d.statementId)?.code ?? "?", relation: d.relation, reason: d.reason })),
    })),
    comparisons: cmps.map((x) => ({ code: x.code, title: x.title, finding: x.finding, note: x.note, statements: x.statements, status: x.status })),
    proposals: props.map((p) => ({ code: p.code, kind: p.kind, title: p.title, text: p.text, basis: p.basis, uncertainty: p.uncertainty, status: p.status, decisionNote: p.decisionNote })),
    questions: qs.map((q) => ({ code: q.code, text: q.text, status: q.status, answer: q.answer })),
  };
}

export async function handoverVersionsFor(ctx: Ctx, caseId: string) {
  await loadCase(ctx, caseId);
  return ctx.db
    .select({ id: handoverVersions.id, version: handoverVersions.version, markdown: handoverVersions.markdown, sha256: handoverVersions.sha256, sharingScope: handoverVersions.sharingScope, approvedAt: handoverVersions.approvedAt, approvedBy: users.name })
    .from(handoverVersions).innerJoin(users, eq(users.id, handoverVersions.approvedBy))
    .where(eq(handoverVersions.caseId, caseId)).orderBy(desc(handoverVersions.version));
}

export async function approveHandover(ctx: Ctx, caseId: string, sharingScope = "Internal to the organization") {
  assertCan(ctx.role, "handover.approve");
  const scope = sharingScope.trim();
  if (scope.length < 3) throw new AppError("invalid", "State who this handover may be shared with.");
  const c = await loadCase(ctx, caseId);
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  if (org.requireIndependentReview && (c.responsibleEngineerId ?? c.createdBy) === ctx.userId)
    throw new AppError("forbidden", "Your organization requires an independent reviewer. Someone other than the case's responsible engineer must approve the handover.");
  const [approver] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId));

  return ctx.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    const [{ latest }] = await db.select({ latest: sql<number>`coalesce(max(${handoverVersions.version}), 0)::int` }).from(handoverVersions).where(eq(handoverVersions.caseId, caseId));
    if (latest > 0 && !c.changedSinceApproval) throw new AppError("conflict", `Nothing has changed since v${latest} was approved.`);
    const data = await handoverData({ ...ctx, db }, caseId);
    // A recomputation or change is not acceptance: anything whose basis changed must be reviewed first.
    const blockers = readiness(data).filter((r) => r.block && !r.ok);
    if (blockers.length) throw new AppError("conflict", `Resolve before approving: ${blockers.map((b) => b.text).join(" ")}`);
    const version = latest + 1;
    const approvedAt = new Date();
    const markdown = renderHandover(data, { version, approvedBy: approver.name, approvedAt: approvedAt.toISOString(), sharingScope: scope.slice(0, 300) });
    const [v] = await db.insert(handoverVersions).values({
      orgId: ctx.orgId, caseId, version, markdown, snapshot: data, sha256: sha256(markdown), sharingScope: scope.slice(0, 300), approvedBy: ctx.userId, approvedAt,
    }).returning();
    await db.update(cases).set({ changedSinceApproval: false, updatedAt: approvedAt }).where(eq(cases.id, caseId));
    await audit(db, ctx, "handover.approved", "handover", v.id, caseId, { version, sha256: v.sha256, sharingScope: scope });
    return v;
  });
}

/* ---------- measurements and activity ---------- */

export async function caseMetrics(ctx: Ctx, caseId: string) {
  await loadCase(ctx, caseId);
  const [m] = await ctx.db.select({
    total: sql<number>`count(*) filter (where ${statements.origin} = 'ai')::int`,
    unreviewed: sql<number>`count(*) filter (where ${statements.origin} = 'ai' and ${statements.status} = 'unreviewed')::int`,
    accepted: sql<number>`count(*) filter (where ${statements.origin} = 'ai' and ${statements.status} = 'accepted')::int`,
    edited: sql<number>`count(*) filter (where ${statements.origin} = 'ai' and ${statements.status} = 'edited')::int`,
    rejected: sql<number>`count(*) filter (where ${statements.origin} = 'ai' and ${statements.status} = 'rejected')::int`,
    manual: sql<number>`count(*) filter (where ${statements.origin} = 'engineer')::int`,
    medianReviewSeconds: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${statements.reviewedAt} - ${statements.createdAt}))) filter (where ${statements.origin} = 'ai' and ${statements.reviewedAt} is not null)`,
  }).from(statements).where(eq(statements.caseId, caseId));
  const [r] = await ctx.db.select({
    runs: sql<number>`count(*)::int`,
    dropped: sql<number>`coalesce(sum(${aiRuns.dropped}), 0)::int`,
    tokens: sql<number>`coalesce(sum(${aiRuns.inputTokens} + ${aiRuns.outputTokens}), 0)::int`,
  }).from(aiRuns).where(and(eq(aiRuns.caseId, caseId), eq(aiRuns.status, "succeeded")));
  return { ...m, ...r };
}

export async function caseActivity(ctx: Ctx, caseId: string, limit = 200) {
  await loadCase(ctx, caseId);
  return ctx.db
    .select({ id: auditEvents.id, action: auditEvents.action, entity: auditEvents.entity, detail: auditEvents.detail, at: auditEvents.createdAt, actor: users.name })
    .from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(eq(auditEvents.orgId, ctx.orgId), eq(auditEvents.caseId, caseId)))
    .orderBy(desc(auditEvents.createdAt)).limit(limit);
}

export async function openRunsForCase(ctx: Ctx, caseId: string) {
  return ctx.db.select().from(aiRuns).where(and(eq(aiRuns.caseId, caseId), ne(aiRuns.status, "succeeded"), ne(aiRuns.status, "failed")));
}
