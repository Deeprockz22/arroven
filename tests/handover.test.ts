import { describe, expect, it } from "vitest";
import { readiness, renderHandover, type HandoverData } from "@/lib/handover";

const data: HandoverData = {
  case: { ref: "CASE-2026-001", title: "Test case", aircraft: "ZZ-TST", system: "ATA 36", question: "Why does it recur?", evidenceCutoff: "2026-03-31", isDemo: false, responsibleEngineer: "E. Engineer" },
  sources: [
    { code: "S1", title: "Tech log", custodian: "Operator", available: true, unavailableReason: null, sha256: "a".repeat(64), importedAt: "2026-04-01T00:00:00.000Z",
      authorisation: "confirmed", authorisationBasis: "DSA-1 §2", supersededBy: null, supersedes: null, processing: { lines: 4 } },
    { code: "U1", title: "BMC history", custodian: "", available: false, unavailableReason: "Not received", sha256: null, importedAt: "2026-04-01T00:00:00.000Z",
      authorisation: "unconfirmed", authorisationBasis: null, supersededBy: null, supersedes: null, processing: null },
  ],
  statements: [
    st("C1", "S1:2", "2026-03-02", "accepted", "Checked fact", { conditions: "FL370" }),
    st("C2", "S1:3", null, "unreviewed", "Unchecked draft"),
    st("C3", "S1:4", null, "rejected", "Rejected draft"),
    st("C4", "S1:5", "2026-04-02", "accepted", "Late fact"),
  ],
  flags: [{ code: "F1", type: "gap", text: "No cold test", refs: ["S1:2"], status: "open" }, { code: "F2", type: "gap", text: "Dismissed one", refs: [], status: "dismissed" }],
  hypotheses: [{ code: "H1", title: "Valve", text: "The valve sticks.", origin: "engineer", assessment: "unresolved", assessmentNote: "Needs a cold test.", needsReassessment: false, reassessReason: null,
    decisions: [{ statement: "C1", relation: "supports", reason: "Because." }] }],
  comparisons: [{ code: "X1", title: "Ground vs flight", finding: "differ", note: "Different temperatures.", statements: ["C1", "C4"], status: "open" }],
  proposals: [
    { code: "P1", kind: "explanation", title: "Wiring", text: "A wiring fault.", basis: ["C1"], uncertainty: "", status: "rejected", decisionNote: "No basis." },
    { code: "P2", kind: "question", title: "Pending", text: "Pending?", basis: [], uncertainty: "", status: "proposed", decisionNote: null },
  ],
  questions: [{ code: "Q1", text: "Open one?", status: "open", answer: null }],
};

function st(code: string, locator: string, eventDate: string | null, status: string, text: string, extra: Partial<HandoverData["statements"][number]> = {}): HandoverData["statements"][number] {
  return { code, locator, source: locator.split(":")[0], eventDate, kind: "report", text, conditions: "", uncertain: false, uncertainNote: "", status, origin: "ai",
    needsReassessment: false, reassessReason: null, afterCutoff: !!(eventDate && eventDate > "2026-03-31"), ...extra };
}

describe("renderHandover", () => {
  const md = renderHandover(data, { version: 2, approvedBy: "R. Reviewer", approvedAt: "2026-04-02T10:00:00.000Z", sharingScope: "Operator engineering only" });
  it("includes only checked statements", () => {
    expect(md).toContain("Checked fact");
    expect(md).not.toContain("Unchecked draft");
    expect(md).not.toContain("Rejected draft");
    expect(md).toContain("1 AI-drafted statement(s) not yet checked; 1 statement(s) rejected");
  });
  it("states its limits and version", () => {
    expect(md).toContain("does not state a root cause");
    expect(md).toContain("Version v2 · approved by R. Reviewer · 2026-04-02 10:00 UTC");
    expect(md).toContain("U1 BMC history · UNAVAILABLE: Not received");
  });
  it("keeps engineer reasons and drops dismissed flags", () => {
    expect(md).toContain("SUPPORTS · C1 [S1:2] Checked fact");
    expect(md).toContain("Why: Because.");
    expect(md).not.toContain("Dismissed one");
  });
  it("records assessment, responsible engineer, scope, proposals and the cutoff", () => {
    expect(md).toContain("Responsible engineer: E. Engineer");
    expect(md).toContain("Sharing scope: Operator engineering only");
    expect(md).toContain("Assessment: Left unresolved. Needs a cold test.");
    expect(md).toContain("P1 Explanation · REJECTED · Wiring");
    expect(md).toContain("1 AI proposal(s) have not been reviewed");
    expect(md).toMatch(/## Recorded after the evidence cutoff[\s\S]*Late fact/);
    expect(md.split("## Recorded after")[0]).not.toContain("Late fact");
  });
  it("marks drafts as unapproved", () => {
    expect(renderHandover(data, null)).toContain("UNAPPROVED DRAFT");
  });
});

describe("readiness", () => {
  it("passes the blocking checks for a clean case", () => {
    expect(readiness(data).filter((r) => r.block && !r.ok)).toEqual([]);
  });
  it("blocks on re-checks, reassessments and unauthorised evidence", () => {
    const d: HandoverData = {
      ...data,
      sources: data.sources.map((s) => (s.code === "S1" ? { ...s, authorisation: "unconfirmed" } : s)),
      statements: data.statements.map((s) => (s.code === "C1" ? { ...s, needsReassessment: true, reassessReason: "S1 superseded" } : s)),
      hypotheses: data.hypotheses.map((h) => ({ ...h, needsReassessment: true })),
    };
    const blockers = readiness(d).filter((r) => r.block && !r.ok).map((r) => r.text);
    expect(blockers).toHaveLength(3);
    expect(blockers[0]).toContain("C1 must be re-checked");
  });
});
