import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openPgliteDb, type Db } from "@/server/db";
import { aiRuns, flags } from "@/server/db/schema";
import type { Ctx } from "@/server/context";
import { createInvite, membershipBySlug, signUp } from "@/server/services/accounts";
import {
  approveHandover, assessHypothesis, caseComparisons, caseHypotheses, caseProposals, caseQuestions, caseSources, caseStatements, decideProposal,
  handoverData, importSource, loadCase, recheckStatement, recordDecision, reviewStatement, setSourceAuthorisation, updateCaseDetails,
} from "@/server/services/cases";
import { loadDemoCase } from "@/server/services/demo";
import { executeRun, startRun } from "@/server/ai/runs";
import type { AiProvider } from "@/server/ai/types";
import { readiness } from "@/lib/handover";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arroven-test-"));
delete process.env.MODEL_SERVICE_URL;

let db: Db;
let owner: Ctx;
let reviewer: Ctx;
let engineer: Ctx;
let caseId: string;
const enc = (s: string) => new TextEncoder().encode(s);

async function ctxFor(userId: string, slug: string): Promise<Ctx> {
  const m = (await membershipBySlug(db, userId, slug))!;
  return { db, userId, orgId: m.org.id, role: m.role };
}

const quiet: AiProvider = {
  name: "mock", model: "test",
  chronology: async (input) => ({ inputTokens: 0, outputTokens: 0, model: "test", data: {
    statements: input.sources.flatMap((s) => s.segments.slice(1).map((g) => ({ locator: g.locator, event_date: "", kind: "report", text: g.text, conditions: "", uncertain: false, uncertain_note: "" }))),
    flags: [],
  } }),
  evidence: async () => ({ inputTokens: 0, outputTokens: 0, model: "test", data: { links: [], missing_evidence: [] } }),
  analysis: async () => ({ inputTokens: 0, outputTokens: 0, model: "test", data: {
    comparisons: [
      { title: "Ground vs cruise", finding: "differ", note: "Different temperatures.", statements: ["C3", "C1"] },
      { title: "Invented", finding: "agree", note: "Cites nothing real.", statements: ["C999", "C998"] },
    ],
    explanations: [{ title: "Connector contact", text: "An intermittent connector contact opens in the cold.", basis: ["C1", "C6"], uncertainty: "Never inspected." }],
    questions: [{ text: "Was the harness ever inspected?", basis: ["C5"] }],
  } }),
};

beforeAll(async () => {
  db = await openPgliteDb();
  const a = await signUp(db, { name: "Owner Eng", email: "owner@example.test", password: "correct horse battery", orgName: "Explainer Test Org" });
  owner = await ctxFor(a.user.id, a.orgSlug);
  const rt = await createInvite(owner, { email: "rev@example.test", role: "reviewer" });
  const et = await createInvite(owner, { email: "eng@example.test", role: "engineer" });
  reviewer = await ctxFor((await signUp(db, { name: "Rev", email: "rev@example.test", password: "correct horse battery", inviteToken: rt })).user.id, a.orgSlug);
  engineer = await ctxFor((await signUp(db, { name: "Eng", email: "eng@example.test", password: "correct horse battery", inviteToken: et })).user.id, a.orgSlug);
  caseId = (await loadDemoCase(owner)).id;
});

describe("authorisation", () => {
  it("imports demo records as confirmed and an engineer's import as unconfirmed", async () => {
    const srcs = await caseSources(owner, caseId);
    expect(srcs.filter((s) => s.available).every((s) => s.authorisation === "confirmed")).toBe(true);
    const r = await importSource(engineer, caseId, { title: "Extra log", kind: "tech_log", fileName: "x.txt", mimeType: "text/plain", bytes: enc("Header\nExtra fault report"), authorisationBasis: "I say so" });
    expect(r.source.authorisation).toBe("unconfirmed");
  });

  it("does not let an engineer confirm authorisation", async () => {
    const s = (await caseSources(owner, caseId)).find((x) => x.title === "Extra log")!;
    await expect(setSourceAuthorisation(engineer, caseId, s.id, "confirmed", "Agreement DSA-1")).rejects.toThrow(/role/);
  });

  it("leaves unconfirmed records out of an AI run and records that coverage", async () => {
    const run = await startRun(owner, caseId, "chronology");
    await executeRun(db, run.id, quiet);
    const [done] = await db.select().from(aiRuns).where(eq(aiRuns.id, run.id));
    expect(done.status).toBe("succeeded");
    expect(done.coverage?.excluded).toEqual([{ code: "S9", reason: "authorisation not confirmed" }]);
    expect(done.coverage?.included).toContain("S1");
    const gap = (await db.select().from(flags).where(eq(flags.caseId, caseId))).find((f) => f.refs.includes("S9"));
    expect(gap?.text).toContain("not read by the AI drafting run");
    expect((await caseStatements(owner, caseId)).some((s) => s.locator.startsWith("S9:"))).toBe(false);
  });

  it("requires a basis to confirm", async () => {
    const s = (await caseSources(owner, caseId)).find((x) => x.code === "S9")!;
    await expect(setSourceAuthorisation(reviewer, caseId, s.id, "confirmed", "")).rejects.toThrow(/basis/);
    await setSourceAuthorisation(reviewer, caseId, s.id, "confirmed", "Data agreement DSA-1 §3");
  });
});

describe("corrected copies and reassessment", () => {
  it("flags statements and assessed explanations when a record is superseded", async () => {
    const s2 = (await caseSources(owner, caseId)).find((x) => x.code === "S2")!;
    const h1Before = (await caseHypotheses(owner, caseId)).find((h) => h.code === "H1")!;
    expect(h1Before.assessment).toBe("unresolved");
    // H1 has a decision on C3 (S2:4) once we add one; record it first so the supersede reaches H1.
    const c3 = (await caseStatements(owner, caseId)).find((x) => x.code === "C3")!;
    await recordDecision(owner, caseId, { hypothesisId: h1Before.id, statementId: c3.id, relation: "inconclusive", reason: "Ground test at +16 C." });

    const corrected = s2.segments.map((g) => g.text).join("\n").replace("ambient +16 C", "ambient +12 C");
    await importSource(owner, caseId, { title: "Work order WO-0912 (corrected)", kind: "work_order", fileName: "wo.txt", mimeType: "text/plain", bytes: enc(corrected), supersedesSourceId: s2.id, authorisationBasis: "Fictional demo data" });

    const c3After = (await caseStatements(owner, caseId)).find((x) => x.code === "C3")!;
    expect(c3After.needsReassessment).toBe(true);
    expect(c3After.reassessReason).toContain("S2 was superseded by corrected copy S10");
    expect((await caseHypotheses(owner, caseId)).find((h) => h.code === "H1")!.needsReassessment).toBe(true);
  });

  it("blocks approval until the changed basis is reviewed", async () => {
    const blockers = readiness(await handoverData(owner, caseId)).filter((r) => r.block && !r.ok);
    expect(blockers.length).toBeGreaterThan(0);
    await expect(approveHandover(reviewer, caseId, "Internal")).rejects.toThrow(/Resolve before approving/);
  });

  it("will not accept a flagged statement that still cites the superseded copy", async () => {
    const c3 = (await caseStatements(owner, caseId)).find((x) => x.code === "C3")!;
    await expect(reviewStatement(owner, caseId, c3.id, "accept")).rejects.toThrow(/has been superseded/);
    await expect(recheckStatement(owner, caseId, c3.id, { locator: "S2:4", text: c3.text })).rejects.toThrow(/superseded/);
  });

  it("clears flags only through re-check and reassessment", async () => {
    const all = await caseStatements(owner, caseId);
    for (const s of all.filter((x) => x.needsReassessment && x.status !== "rejected")) {
      const loc = s.locator.replace(/^S2:/, "S10:");
      await recheckStatement(owner, caseId, s.id, { locator: loc, text: s.text, conditions: s.conditions.replace("+16 C", "+12 C") });
    }
    const c3 = (await caseStatements(owner, caseId)).find((x) => x.code === "C3")!;
    expect(c3).toMatchObject({ locator: "S10:4", needsReassessment: false, status: "edited", conditions: "Ground, ambient +12 C, engine 1 idle" });

    const h1 = (await caseHypotheses(owner, caseId)).find((h) => h.code === "H1")!;
    await expect(assessHypothesis(owner, caseId, h1.id, "unresolved", "short")).rejects.toThrow(/Explain/);
    await assessHypothesis(owner, caseId, h1.id, "unresolved", "Still no test at cruise temperature; corrected ground test was at +12 C.");
    expect((await caseHypotheses(owner, caseId)).find((h) => h.code === "H1")!.needsReassessment).toBe(false);

    // A remaining unreviewed AI draft does not block; approve as the independent reviewer.
    const v = await approveHandover(reviewer, caseId, "Demo Air engineering only");
    expect(v.markdown).toContain("Sharing scope: Demo Air engineering only");
    expect(v.markdown).toContain("S2 Work order WO-0912");
    expect(v.markdown).toContain("superseded by S10");
  });

  it("sends assessed explanations back when the question changes", async () => {
    const c = await loadCase(owner, caseId);
    await updateCaseDetails(owner, caseId, { title: c.title, aircraft: c.aircraft, system: c.system, question: c.question + " Include the 29 MAR events.", evidenceCutoff: c.evidenceCutoff ?? "" });
    const h1 = (await caseHypotheses(owner, caseId)).find((h) => h.code === "H1")!;
    expect(h1.needsReassessment).toBe(true);
    expect(h1.reassessReason).toContain("the case question changed");
  });

  it("requires an evidence decision before assessing an explanation as consistent", async () => {
    const h3 = (await caseHypotheses(owner, caseId)).find((h) => h.code === "H3")!;
    await expect(assessHypothesis(owner, caseId, h3.id, "consistent", "Looks consistent to me overall.")).rejects.toThrow(/at least one evidence decision/);
  });
});

describe("compare and propose", () => {
  it("stores comparisons and proposals, dropping ones that cite nothing real", async () => {
    const run = await startRun(owner, caseId, "analysis");
    await executeRun(db, run.id, quiet);
    const [done] = await db.select().from(aiRuns).where(eq(aiRuns.id, run.id));
    expect(done).toMatchObject({ status: "succeeded", dropped: 1 });
    const cmps = await caseComparisons(owner, caseId);
    expect(cmps.map((x) => x.title)).toContain("Ground vs cruise");
    expect(cmps.map((x) => x.title)).not.toContain("Invented");
    // Demo proposals P1 and P2 were undecided, so the run replaced them.
    const props = await caseProposals(owner, caseId);
    expect(props.map((p) => p.title)).toEqual(["Connector contact", "Was the harness ever inspected?"]);
  });

  it("adopts an explanation as an engineer-owned hypothesis and requires a reason to reject", async () => {
    const [expl, question] = await caseProposals(owner, caseId);
    const created = await decideProposal(engineer, caseId, expl.id, { decision: "adopted", title: "Connector contact in the cold", text: expl.text });
    const h = (await caseHypotheses(owner, caseId)).find((x) => x.code === created)!;
    expect(h).toMatchObject({ origin: "ai_proposal", title: "Connector contact in the cold", assessment: "not_assessed" });
    await expect(decideProposal(engineer, caseId, question.id, { decision: "rejected" })).rejects.toThrow(/Say why/);
    await decideProposal(engineer, caseId, question.id, { decision: "unresolved", note: "Covered by Q2 already." });
    expect((await caseQuestions(owner, caseId)).some((q) => q.origin === "ai_proposal")).toBe(false);
  });
});
