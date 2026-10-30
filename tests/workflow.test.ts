import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { openPgliteDb, type Db } from "@/server/db";
import { aiRuns, decisions, statements } from "@/server/db/schema";
import type { Ctx } from "@/server/context";
import { createInvite, membershipBySlug, signUp, updateOrgSettings, acceptInvite, authenticate } from "@/server/services/accounts";
import {
  addQuestion, approveHandover, caseStatements, handoverVersionsFor, importSource, loadCase, recordDecision, reviewStatement, caseHypotheses,
} from "@/server/services/cases";
import { loadDemoCase } from "@/server/services/demo";
import { executeRun, startRun } from "@/server/ai/runs";
import type { AiProvider } from "@/server/ai/types";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arroven-test-"));
delete process.env.MODEL_SERVICE_URL;

let db: Db;
let engineer: Ctx;
let reviewer: Ctx;
let viewer: Ctx;
let caseId: string;

async function ctxFor(userId: string, slug: string): Promise<Ctx> {
  const m = await membershipBySlug(db, userId, slug);
  if (!m) throw new Error("no membership");
  return { db, userId, orgId: m.org.id, role: m.role };
}

beforeAll(async () => {
  db = await openPgliteDb();
  const a = await signUp(db, { name: "Eng One", email: "eng@example.test", password: "correct horse battery", orgName: "Demo Air Technical Services" });
  engineer = await ctxFor(a.user.id, a.orgSlug);
  // the owner is an engineer for this test's purposes; invite a reviewer and a viewer
  const rToken = await createInvite(engineer, { email: "rev@example.test", role: "reviewer" });
  const vToken = await createInvite(engineer, { email: "view@example.test", role: "viewer" });
  const r = await signUp(db, { name: "Rev Two", email: "rev@example.test", password: "correct horse battery", inviteToken: rToken });
  const v = await signUp(db, { name: "View Three", email: "view@example.test", password: "correct horse battery", inviteToken: vToken });
  reviewer = await ctxFor(r.user.id, a.orgSlug);
  viewer = await ctxFor(v.user.id, a.orgSlug);
  caseId = (await loadDemoCase(engineer)).id;
});

describe("accounts", () => {
  it("authenticates with the right password only", async () => {
    await expect(authenticate(db, "ENG@example.test", "correct horse battery")).resolves.toMatchObject({ name: "Eng One" });
    await expect(authenticate(db, "eng@example.test", "wrong password!!")).rejects.toThrow(/do not match/);
    await expect(authenticate(db, "nobody@example.test", "whatever123")).rejects.toThrow(/do not match/);
  });

  it("will not let an invite be used by a different address", async () => {
    const token = await createInvite(engineer, { email: "someone@example.test", role: "engineer" });
    await expect(acceptInvite(db, reviewer.userId, "rev@example.test", token)).rejects.toThrow(/sent to someone@example.test/);
  });

  it("isolates organizations", async () => {
    const other = await signUp(db, { name: "Other", email: "other@example.test", password: "correct horse battery", orgName: "Other Airline" });
    const otherCtx = await ctxFor(other.user.id, other.orgSlug);
    await expect(loadCase(otherCtx, caseId)).rejects.toThrow(/does not exist/);
  });
});

describe("demo case", () => {
  it("imports records with stable locators and the example draft", async () => {
    const stmts = await caseStatements(engineer, caseId);
    expect(stmts).toHaveLength(13);
    expect(stmts.find((s) => s.code === "C4")).toMatchObject({ status: "edited", locator: "S2:2" });
    expect((await caseHypotheses(engineer, caseId)).map((h) => h.code)).toEqual(["H1", "H2", "H3"]);
  });
});

describe("review rules", () => {
  it("does not let a viewer review", async () => {
    const [s] = await caseStatements(viewer, caseId);
    await expect(reviewStatement(viewer, caseId, s.id, "accept")).rejects.toThrow(/role/);
  });

  it("records an edit and keeps the original draft wording", async () => {
    const s = (await caseStatements(engineer, caseId)).find((x) => x.code === "C8")!;
    await reviewStatement(engineer, caseId, s.id, "accept", "Ground run at idle and 70% N1 with PRV 1 ops test satisfactory; no ECAM.");
    const after = (await caseStatements(engineer, caseId)).find((x) => x.code === "C8")!;
    expect(after.status).toBe("edited");
    expect(after.draftText).toContain("Engine 1 ground run");
  });

  it("requires a checked statement and a reason for an evidence decision", async () => {
    const stmts = await caseStatements(engineer, caseId);
    const h = (await caseHypotheses(engineer, caseId)).find((x) => x.code === "H2")!;
    const unchecked = stmts.find((x) => x.code === "C5")!;
    await expect(recordDecision(engineer, caseId, { hypothesisId: h.id, statementId: unchecked.id, relation: "inconclusive", reason: "Never done." })).rejects.toThrow(/Check C5/);
    const checked = stmts.find((x) => x.code === "C11")!;
    await expect(recordDecision(engineer, caseId, { hypothesisId: h.id, statementId: checked.id, relation: "supports", reason: "" })).rejects.toThrow(/Write why/);
    await recordDecision(engineer, caseId, { hypothesisId: h.id, statementId: checked.id, relation: "supports", reason: "Recurred after the valve change." });
  });

  it("blocks rejecting a statement that a decision relies on", async () => {
    const s = (await caseStatements(engineer, caseId)).find((x) => x.code === "C11")!;
    await expect(reviewStatement(engineer, caseId, s.id, "reject")).rejects.toThrow(/Clear those decisions first/);
  });
});

describe("AI runs", () => {
  it("replaces unreviewed drafts, keeps checked ones and drops invented locators", async () => {
    const fake: AiProvider = {
      name: "mock", model: "test",
      chronology: async () => ({ inputTokens: 10, outputTokens: 20, model: "test", data: {
        statements: [
          { locator: "S1:2", event_date: "2026-03-02", kind: "report", text: "Duplicate of a checked line", conditions: "", uncertain: false, uncertain_note: "" },
          { locator: "S2:3", event_date: "2026-03-03", kind: "action_planned", text: "Harness inspection not performed.", conditions: "", uncertain: false, uncertain_note: "" },
          { locator: "S99:1", event_date: "", kind: "report", text: "Made up", conditions: "", uncertain: false, uncertain_note: "" },
        ],
        flags: [{ type: "gap", text: "Harness never inspected.", refs: ["S2:3"] }],
      } }),
      evidence: async () => ({ inputTokens: 0, outputTokens: 0, model: "test", data: { links: [], missing_evidence: [] } }),
      analysis: async () => ({ inputTokens: 0, outputTokens: 0, model: "test", data: { comparisons: [], explanations: [], questions: [] } }),
    };
    const before = await caseStatements(engineer, caseId);
    const checkedBefore = before.filter((s) => s.status !== "unreviewed").length;
    const run = await startRun(engineer, caseId, "chronology");
    await executeRun(db, run.id, fake);
    const [done] = await db.select().from(aiRuns).where(eq(aiRuns.id, run.id));
    expect(done).toMatchObject({ status: "succeeded", produced: 1, dropped: 1 });
    const after = await caseStatements(engineer, caseId);
    expect(after.filter((s) => s.status !== "unreviewed").length).toBe(checkedBefore);
    expect(after.filter((s) => s.status === "unreviewed").map((s) => s.text)).toEqual(["Harness inspection not performed."]);
    expect(after.find((s) => s.status === "unreviewed")!.code).toBe("C14");
  });

  it("does not let a viewer start a run", async () => {
    await expect(startRun(viewer, caseId, "chronology")).rejects.toThrow(/role/);
  });
});

describe("handover approval", () => {
  it("requires an independent reviewer when the organization says so", async () => {
    await expect(approveHandover(engineer, caseId)).rejects.toThrow(/independent reviewer/);
  });

  it("freezes v1, refuses an unchanged re-approval and issues v2 after a change", async () => {
    const v1 = await approveHandover(reviewer, caseId);
    expect(v1.version).toBe(1);
    expect(v1.markdown).toContain("Version v1 · approved by Rev Two");
    await expect(approveHandover(reviewer, caseId)).rejects.toThrow(/Nothing has changed since v1/);

    const s = (await caseStatements(engineer, caseId)).find((x) => x.status === "unreviewed")!;
    await reviewStatement(engineer, caseId, s.id, "accept");
    expect((await loadCase(engineer, caseId)).changedSinceApproval).toBe(true);

    const v2 = await approveHandover(reviewer, caseId);
    expect(v2.version).toBe(2);
    const versions = await handoverVersionsFor(engineer, caseId);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1].markdown).toBe(v1.markdown);
  });

  it("lets the owner approve once the rule is turned off", async () => {
    await updateOrgSettings(engineer, { requireIndependentReview: false });
    await addQuestion(engineer, caseId, "Has the BMC history for 29 MAR arrived?");
    const v3 = await approveHandover(engineer, caseId);
    expect(v3.version).toBe(3);
  });
});

describe("imports", () => {
  it("stores the original once and numbers sources in order", async () => {
    const r = await importSource(engineer, caseId, { title: "Extra note", custodian: "", kind: "other", fileName: "n.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("Line one\nLine two\n") });
    expect(r.source.code).toBe("S9");
    expect(r.segmentCount).toBe(2);
    const ds = await db.select().from(decisions).where(and(eq(decisions.caseId, caseId)));
    expect(ds.length).toBeGreaterThan(0);
    void statements;
  });
});
