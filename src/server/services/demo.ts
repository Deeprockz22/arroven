import { and, eq } from "drizzle-orm";
import type { Ctx } from "../context";
import type { Db } from "../db";
import { cases, comparisons, decisions, evidenceGaps, flags, hypotheses, proposals, questions, segments, statements, suggestions, type Relation, type StatementKind } from "../db/schema";
import { audit } from "../audit";
import { addUnavailableSource, createCase, importSource } from "./cases";

/*
 * A fictional recurring-fault case used to try the workflow without customer data.
 * Records are imported through the normal import path, so they are hashed, stored and segmented like any upload.
 * The draft statements, flags and suggestions are a pre-written example of AI output and are labelled as such.
 */

const RECORDS: { title: string; custodian: string; kind: "tech_log" | "work_order" | "shop_report" | "message_log" | "engineering_note"; lines: string[] }[] = [
  { title: "Technical log page TLB-4471", custodian: "Operator technical log · Demo Air (fictional)", kind: "tech_log", lines: [
    "Page TLB-4471 · ZZ-DMO · sector DMA-DMB · 02 MAR 2026",
    "Entry 2 (crew): BLEED 1 FAULT ECAM in cruise FL370, approx 40 min after top of climb. SAT -56. Bleed 1 lost. Reset per QRH unsuccessful. Continued on bleed 2.",
    "Entry 3 (MX, 03 MAR 2026): BMC 1 BITE interrogated. Fault message: PRV 1 POSITION DISAGREE. PRV 1 operational test on ground per AMM: satisfactory. NFF. Aircraft released.",
  ]},
  { title: "Work order WO-0912", custodian: "Line maintenance system · contracted MRO (fictional)", kind: "work_order", lines: [
    "Work order WO-0912 · raised 03 MAR 2026 · ZZ-DMO · ref TLB-4471/3",
    "Task 1: Replace PRV 1 (P/N 3291-A). Status: PLANNED. Deferred, no serviceable spare at station.",
    "Task 2: Inspect pylon harness connector at PRV 1 for chafe / moisture. Status: NOT PERFORMED. Insufficient ground time. Carried forward.",
    "Task 3: PRV 1 operational test. Status: COMPLETED 03 MAR 2026, ambient +16 C, engine 1 at idle. Result: satisfactory.",
  ]},
  { title: "Technical log page TLB-4472", custodian: "Operator technical log · Demo Air (fictional)", kind: "tech_log", lines: [
    "Page TLB-4472 · ZZ-DMO · 11 MAR 2026",
    "Entry 1 (crew): BLEED 1 FAULT recurred, cruise FL360, approx 55 min after TOC. Same as TLB-4471. Bleed 1 lost for remainder of flight.",
  ]},
  { title: "Work order WO-0957", custodian: "Line maintenance system · contracted MRO (fictional)", kind: "work_order", lines: [
    "Work order WO-0957 · 12 MAR 2026 · ZZ-DMO · ref TLB-4472/1",
    "Task 1: Remove PRV 1 S/N V1187. Install PRV 1 S/N V2240. Status: COMPLETED 12 MAR 2026.",
    "Task 2: Engine 1 ground run, PRV 1 ops test at idle and 70% N1, ambient +18 C. Status: COMPLETED. Result: satisfactory, no ECAM.",
    "Task 3 (carried from WO-0912): Pylon harness connector inspection. Status: NOT PERFORMED. Re-deferred to next A-check.",
  ]},
  { title: "Shop report SR-88120", custodian: "Component repair shop (fictional)", kind: "shop_report", lines: [
    "Shop report SR-88120 · PRV P/N 3291-A S/N V1187 · received 20 MAR 2026",
    "Reason for removal (as received): BLEED 1 FAULT, intermittent.",
    "Functional test at room temperature: within limits.",
    "Cold-soak test at -40 C, 2 h: within limits.",
    "Finding: No fault found. Unit returned to serviceable stock.",
  ]},
  { title: "Technical log page TLB-4475", custodian: "Operator technical log · Demo Air (fictional)", kind: "tech_log", lines: [
    "Page TLB-4475 · ZZ-DMO · 29 MAR 2026",
    "Entry 4 (crew): BLEED 1 FAULT, FL380, approx 1 h after TOC. Bleed 1 recovered after about 4 min without crew action. Flight continued normally.",
  ]},
  { title: "Maintenance message log, 29 MAR", custodian: "Operator maintenance information system (fictional)", kind: "message_log", lines: [
    "Maintenance message log · ZZ-DMO · 29 MAR 2026 (UTC)",
    "10:42  BLEED 1 FAULT  (ATA 36)",
    "10:46  BLEED 1 FAULT  cleared",
    "11:15  BLEED 1 FAULT  (ATA 36)",
    "11:19  BLEED 1 FAULT  cleared",
  ]},
  { title: "Engineering note EN-0331", custodian: "Technical services engineering (fictional)", kind: "engineering_note", lines: [
    "Engineering note EN-0331 · technical services · 31 MAR 2026",
    "Sister aircraft ZZ-DMP had pylon harness chafe near the PRV connector in 2025 (record not attached).",
    "Suspect wiring rather than valve, given NFF on V1187 and recurrence with V2240 installed.",
    "Recommend harness inspection with wiggle test at next A-check. Not yet scheduled.",
  ]},
];

type Draft = [code: string, loc: string, date: string, kind: StatementKind, text: string, conditions: string, status: "unreviewed" | "accepted" | "edited", extra?: { draft?: string; note?: string }];

const DRAFTS: Draft[] = [
  ["C1", "S1:2", "2026-03-02", "report", "Crew reported BLEED 1 FAULT in cruise at FL370, about 40 min after top of climb. Bleed 1 lost; QRH reset unsuccessful.", "Cruise FL370, SAT -56 C", "accepted"],
  ["C2", "S1:3", "2026-03-03", "test_result", "BMC 1 BITE recorded fault message PRV 1 POSITION DISAGREE.", "", "accepted"],
  ["C3", "S2:4", "2026-03-03", "test_result", "PRV 1 ground operational test satisfactory.", "Ground, ambient +16 C, engine 1 idle", "accepted"],
  ["C4", "S2:2", "2026-03-03", "action_planned", "PRV 1 replacement planned and deferred; no serviceable spare at station. Not performed under WO-0912.", "", "edited", { draft: "PRV 1 replaced (P/N 3291-A); deferred due to no spare." }],
  ["C5", "S2:3", "2026-03-03", "action_planned", "Pylon harness connector inspection at PRV 1 planned, not performed (insufficient ground time).", "", "unreviewed"],
  ["C6", "S3:2", "2026-03-11", "report", "BLEED 1 FAULT recurred in cruise at FL360, about 55 min after TOC. Bleed 1 lost for remainder of flight.", "Cruise FL360", "accepted"],
  ["C7", "S4:2", "2026-03-12", "action_performed", "PRV 1 S/N V1187 removed; S/N V2240 installed.", "", "accepted"],
  ["C8", "S4:3", "2026-03-12", "test_result", "Engine 1 ground run with PRV 1 ops test at idle and 70% N1 satisfactory; no ECAM.", "Ground, ambient +18 C", "unreviewed"],
  ["C9", "S4:4", "2026-03-12", "action_planned", "Harness connector inspection again not performed; re-deferred to next A-check.", "", "unreviewed"],
  ["C10", "S5:4", "2026-03-20", "shop_result", "Removed unit S/N V1187 passed room-temperature and -40 C cold-soak functional tests; no fault found.", "Shop bench, -40 C cold soak 2 h", "accepted"],
  ["C11", "S6:2", "2026-03-29", "report", "BLEED 1 FAULT at FL380, about 1 h after TOC; bleed 1 recovered after about 4 min without crew action.", "Cruise FL380", "accepted", { note: "The message log for this date shows two fault events (10:42 and 11:15 UTC). The tech log entry describes one." }],
  ["C12", "S7:4", "2026-03-29", "message_log", "Second BLEED 1 FAULT logged at 11:15 UTC, cleared 11:19 UTC.", "", "unreviewed"],
  ["C13", "S8:3", "2026-03-31", "engineering_note", "Prior engineer recorded a suspicion of wiring rather than the valve.", "", "unreviewed"],
];

const FLAGS: [string, "conflict" | "gap", string, string[]][] = [
  ["F1", "conflict", "Tech log TLB-4475 entry 4 describes one fault event on 29 MAR; the maintenance message log shows two (10:42 and 11:15 UTC).", ["S6:2", "S7:2", "S7:4"]],
  ["F2", "gap", "The pylon harness connector inspection was planned twice and never performed. No record tests the wiring path.", ["S2:3", "S4:4"]],
  ["F3", "gap", "All ground tests ran at +16 to +18 C. All in-flight faults occurred in cruise above FL360, roughly 40 to 60 min after top of climb. No test reproduced those conditions.", ["S2:4", "S4:3", "S1:2"]],
  ["F4", "gap", "BMC 1 fault history for 29 MAR is unavailable, so it is unknown whether PRV 1 POSITION DISAGREE recurred with S/N V2240 installed.", ["U1"]],
  ["F5", "gap", "The sister-aircraft chafe finding cited in EN-0331 has no attached record.", ["S8:2", "U2"]],
];

const HYPOTHESES: [string, string, string][] = [
  ["H1", "PRV 1 valve sticks at cruise temperature", "PRV 1 intermittently fails to reach its commanded position when cold-soaked in cruise, and works normally once warm on the ground."],
  ["H2", "Pylon harness or connector fault", "An intermittent open or short in the engine 1 pylon harness or the PRV 1 connector, sensitive to vibration or thermal contraction in cruise, corrupts the position signal."],
  ["H3", "BMC 1 or sensor input error", "BMC 1, or a bleed sensor input it relies on, generates a false position-disagree indication while the valve itself operates correctly."],
];

const SUGGESTIONS: [string, string, "supports" | "challenges" | "inconclusive", string, string][] = [
  ["H1", "C2", "supports", "A position-disagree message is consistent with a valve position problem.", "BITE does not separate the valve from its signal path."],
  ["H1", "C3", "inconclusive", "Ground test at +16 C does not reproduce cold-soaked cruise conditions.", ""],
  ["H1", "C10", "inconclusive", "Shop NFF including a -40 C cold soak weakens a valve fault but does not match -56 C in cruise.", "A no-fault-found result does not prove the absence of an intermittent fault."],
  ["H1", "C11", "challenges", "The fault recurred after S/N V1187 was replaced by S/N V2240.", "Would require two faulty units, or a common external cause."],
  ["H2", "C11", "supports", "Recurrence after the valve change is consistent with a fault outside the valve.", ""],
  ["H2", "C7", "inconclusive", "The valve change removed one candidate but did not test the harness.", ""],
  ["H3", "C2", "inconclusive", "A disagree message could also be generated by a BMC input error.", ""],
];

const GAPS: [string, string][] = [
  ["H1", "A test of PRV 1 under cold-soak conditions closer to cruise (around -56 C) with vibration."],
  ["H1", "BMC 1 fault history for 29 MAR showing whether the disagree message recurred with S/N V2240."],
  ["H2", "Pylon harness and PRV 1 connector inspection with a wiggle test."],
  ["H3", "Any BMC 1 test, swap or software status record. None is in the case."],
];

const DECISIONS: [string, string, Relation, string][] = [
  ["H1", "C10", "inconclusive", "Shop cold soak was -40 C against SAT -56 C in cruise. NFF does not exclude an intermittent valve fault."],
  ["H1", "C11", "challenges", "Fault recurred with a different unit installed. A valve-only explanation would need two faulty units."],
];

export async function loadDemoCase(ctx: Ctx) {
  const c = await createCase(ctx, {
    title: "BLEED 1 FAULT recurring in cruise, not reproduced on ground",
    aircraft: "ZZ-DMO · MSN 0000 (fictional)",
    system: "ATA 36 Pneumatic · engine 1 bleed",
    question: "Why does BLEED 1 FAULT keep returning in cruise when every ground test and the shop test pass, and what has the work so far actually established?",
    evidenceCutoff: "2026-03-31",
  }, { isDemo: true });

  for (const r of RECORDS) {
    await importSource(ctx, c.id, {
      title: r.title, custodian: r.custodian, kind: r.kind, fileName: `${r.title}.txt`, mimeType: "text/plain", bytes: new TextEncoder().encode(r.lines.join("\n") + "\n"),
      // Records an authoriser has cleared are confirmed at import; for anyone else they stay unconfirmed.
      authorisationBasis: "Fictional demonstration data. No customer records.",
    });
  }
  await addUnavailableSource(ctx, c.id, { title: "BMC 1 fault history download, 29 MAR event", reason: "Requested from line station 30 MAR 2026. Not received by cutoff." });
  await addUnavailableSource(ctx, c.id, { title: "ZZ-DMP harness chafe record (2025)", reason: "Referenced in EN-0331. Not attached and not imported." });

  await ctx.db.transaction(async (txRaw) => {
    const db = txRaw as unknown as Db;
    const segs = await db.select().from(segments).where(eq(segments.caseId, c.id));
    const seg = (loc: string) => segs.find((s) => s.locator === loc)!;
    const now = new Date();
    const stmtRows = await db.insert(statements).values(DRAFTS.map(([code, loc, date, kind, text, conditions, status, extra]) => ({
      orgId: ctx.orgId, caseId: c.id, code, segmentId: seg(loc).id, locator: loc, eventDate: date, kind, text, draftText: extra?.draft ?? text,
      conditions, uncertain: !!extra?.note, uncertainNote: extra?.note ?? "", status, origin: "ai" as const,
      reviewedBy: status === "unreviewed" ? null : ctx.userId, reviewedAt: status === "unreviewed" ? null : now,
    }))).returning();
    await db.insert(flags).values(FLAGS.map(([code, type, text, refs]) => ({ orgId: ctx.orgId, caseId: c.id, code, type, text, refs, status: code === "F1" ? "question" as const : "open" as const })));
    const hRows = await db.insert(hypotheses).values(HYPOTHESES.map(([code, title, text]) => ({ orgId: ctx.orgId, caseId: c.id, code, title, text, createdBy: ctx.userId }))).returning();
    const H = (code: string) => hRows.find((h) => h.code === code)!.id;
    const S = (code: string) => stmtRows.find((s) => s.code === code)!.id;
    await db.insert(suggestions).values(SUGGESTIONS.map(([h, s, relation, rationale, caveat]) => ({ orgId: ctx.orgId, caseId: c.id, hypothesisId: H(h), statementId: S(s), relation, rationale, caveat })));
    await db.insert(evidenceGaps).values(GAPS.map(([h, text]) => ({ orgId: ctx.orgId, caseId: c.id, hypothesisId: H(h), text })));
    await db.insert(decisions).values(DECISIONS.map(([h, s, relation, reason]) => ({ orgId: ctx.orgId, caseId: c.id, hypothesisId: H(h), statementId: S(s), relation, reason, decidedBy: ctx.userId })));
    await db.update(hypotheses).set({
      assessment: "unresolved", assessedBy: ctx.userId, assessedAt: now,
      assessmentNote: "Weakened by recurrence with a second unit, but no test has reproduced cruise temperature. Left unresolved pending a cold test and the BMC history.",
    }).where(eq(hypotheses.id, H("H1")));
    await db.insert(comparisons).values([
      { orgId: ctx.orgId, caseId: c.id, code: "X1", title: "Ground and shop tests against in-flight reports", finding: "differ" as const, statements: ["C1", "C3", "C6", "C10", "C11"],
        note: "Every fault was reported in cruise above FL360 at about -56 C. Ground tests ran at +16 C and the shop cold soak at -40 C. No test reproduced the reported conditions, so passing tests do not show the fault is absent." },
      { orgId: ctx.orgId, caseId: c.id, code: "X2", title: "Tech log against message log for 29 MAR", finding: "differ" as const, statements: ["C11", "C12"],
        note: "The tech log describes one event; the message log records a second at 11:15 UTC. The count of events on this flight is unclear." },
    ]);
    await db.insert(proposals).values([
      { orgId: ctx.orgId, caseId: c.id, code: "P1", kind: "explanation" as const, title: "Connector contact affected by cold soak", basis: ["C1", "C6", "C11"],
        text: "An intermittent contact at the PRV 1 connector opens as the pylon cold-soaks during cruise and closes again as conditions change, producing a position disagree that ground tests cannot reproduce.",
        uncertainty: "No record describes the connector's condition; the harness inspection was never performed." },
      { orgId: ctx.orgId, caseId: c.id, code: "P2", kind: "question" as const, title: "Has BMC 1's history been compared across all three events?", basis: ["C2", "C11"],
        text: "Has BMC 1's fault history been compared across all three events to see whether the same message was recorded each time?" },
    ]);
    await db.insert(questions).values([
      { orgId: ctx.orgId, caseId: c.id, code: "Q1", text: "Was there one fault event or two on 29 MAR? Confirm with the crew report and BMC history.", origin: "flag" as const, originRef: "F1", createdBy: ctx.userId },
      { orgId: ctx.orgId, caseId: c.id, code: "Q2", text: "Can the harness connector inspection with wiggle test be brought forward ahead of the A-check?", origin: "engineer" as const, createdBy: ctx.userId },
    ]);
    await db.update(cases).set({ trainingPermitted: true, trainingBasis: "Fictional demonstration data. No customer records.", trainingPermittedBy: ctx.userId, trainingPermittedAt: now }).where(eq(cases.id, c.id));
    await audit(db, ctx, "demo.loaded", "case", c.id, c.id, { note: "Example AI draft, flags and suggestions pre-written for the fictional demo case." });
  });
  return c;
}

export async function hasDemoCase(db: Db, orgId: string) {
  const { cases } = await import("../db/schema");
  const [row] = await db.select({ id: cases.id }).from(cases).where(and(eq(cases.orgId, orgId), eq(cases.isDemo, true)));
  return !!row;
}
