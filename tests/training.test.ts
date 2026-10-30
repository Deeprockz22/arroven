import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { openPgliteDb, type Db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { createInvite, membershipBySlug, signUp } from "@/server/services/accounts";
import { caseStatements, createCase, importSource, loadCase, reviewStatement } from "@/server/services/cases";
import { loadDemoCase } from "@/server/services/demo";
import { createTrainingExport, deleteTrainingExport, readTrainingExport, scrub, setCaseTrainingPermission } from "@/server/training/export";
import { sha256 } from "@/server/auth/crypto";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arroven-train-"));
delete process.env.MODEL_SERVICE_URL;

let db: Db;
let owner: Ctx;
let engineer: Ctx;
let demoId: string;
let otherId: string;

async function ctxFor(userId: string, slug: string): Promise<Ctx> {
  const m = (await membershipBySlug(db, userId, slug))!;
  return { db, userId, orgId: m.org.id, role: m.role };
}

function parse(bytes: Buffer) {
  const text = bytes.toString("utf8");
  const [head, ...rest] = text.split("\n");
  return { manifest: JSON.parse(head), lines: rest.filter(Boolean).map((l) => JSON.parse(l)), body: text.slice(head.length + 1) };
}

beforeAll(async () => {
  db = await openPgliteDb();
  const a = await signUp(db, { name: "Owner", email: "owner@train.test", password: "correct horse battery", orgName: "Training Org" });
  owner = await ctxFor(a.user.id, a.orgSlug);
  const t = await createInvite(owner, { email: "eng@train.test", role: "engineer" });
  engineer = await ctxFor((await signUp(db, { name: "Eng", email: "eng@train.test", password: "correct horse battery", inviteToken: t })).user.id, a.orgSlug);
  demoId = (await loadDemoCase(owner)).id;
  const other = await createCase(owner, { title: "Not permitted case", aircraft: "ZZ-OTH", system: "ATA 21", question: "Why does the pack trip in climb?" });
  otherId = other.id;
  await importSource(owner, otherId, { title: "Log", kind: "tech_log", fileName: "l.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("Header\nPACK 2 trip in climb"), authorisationBasis: "Test data" });
});

describe("training permission", () => {
  it("is recorded on the demo case and absent elsewhere", async () => {
    expect((await loadCase(owner, demoId)).trainingPermitted).toBe(true);
    expect((await loadCase(owner, otherId)).trainingPermitted).toBe(false);
  });

  it("is admin and owner only, and needs a basis", async () => {
    await expect(setCaseTrainingPermission(engineer, otherId, true, "Agreement clause 6.3")).rejects.toThrow(/role/);
    await expect(setCaseTrainingPermission(owner, otherId, true, "")).rejects.toThrow(/basis/);
    await expect(createTrainingExport(engineer, "Train extraction v0.1")).rejects.toThrow(/role/);
  });
});

describe("training export", () => {
  it("includes only permitted cases and only decided labels", async () => {
    const e = await createTrainingExport(owner, "Train extraction model v0.1");
    expect(e.caseRefs).toEqual(["CASE-2026-001"]);
    const { manifest, lines, body } = parse((await readTrainingExport(owner, e.id)).bytes);

    expect(manifest).toMatchObject({ type: "manifest", purpose: "Train extraction model v0.1", cases: ["CASE-2026-001"], excluded_cases: 1, schema_version: 1 });
    expect(manifest.body_sha256).toBe(sha256(body));
    expect(lines.every((l) => l.case === "CASE-2026-001")).toBe(true);
    expect(JSON.stringify(lines)).not.toContain("PACK 2 trip");

    // Demo: C5, C8, C9, C12, C13 are unreviewed drafts, so their lines carry no label.
    const extraction = lines.filter((l) => l.type === "extraction");
    const locs = extraction.map((l) => l.locator);
    expect(locs).toContain("S2:4"); // C3, accepted
    expect(locs).not.toContain("S2:3"); // C5, unreviewed
    const c4 = extraction.find((l) => l.locator === "S2:2");
    expect(c4.statements[0]).toMatchObject({ verdict: "edited", draft: "PRV 1 replaced (P/N 3291-A); deferred due to no spare." });
    // The chronology is not fully reviewed, so no negative examples are emitted.
    expect(extraction.every((l) => l.statements.length > 0)).toBe(true);

    const ev = lines.filter((l) => l.type === "evidence_decision");
    expect(ev.map((l) => l.statement.code).sort()).toEqual(["C10", "C11"]);
    expect(ev.find((l) => l.statement.code === "C11").model_suggestion).toMatchObject({ relation: "challenges" });
    expect(lines.find((l) => l.type === "assessment")).toMatchObject({ assessment: "unresolved" });
    expect(lines.some((l) => l.type === "proposal_decision")).toBe(false); // demo proposals are undecided
    expect(manifest.counts.extraction).toBe(extraction.length);
  });

  it("adds negative examples once the whole chronology is reviewed", async () => {
    for (const s of (await caseStatements(owner, demoId)).filter((x) => x.status === "unreviewed")) await reviewStatement(owner, demoId, s.id, "accept");
    const e = await createTrainingExport(owner, "Train extraction model v0.2");
    const { lines, manifest } = parse((await readTrainingExport(owner, e.id)).bytes);
    expect(lines.find((l) => l.type === "case").chronology_fully_reviewed).toBe(true);
    expect(manifest.counts.extraction_negative).toBeGreaterThan(0);
    expect(lines.some((l) => l.type === "extraction" && l.statements.length === 0 && l.locator === "S1:1")).toBe(true);
  });

  it("deletes the file but keeps the log", async () => {
    const e = await createTrainingExport(owner, "Short-lived export");
    await deleteTrainingExport(owner, e.id);
    await expect(readTrainingExport(owner, e.id)).rejects.toThrow(/deleted/);
    await expect(deleteTrainingExport(owner, e.id)).rejects.toThrow(/already deleted/);
  });

  it("scrubs contact details from free text", () => {
    expect(scrub("Call J. Rao on +91 98765 43210 or j.rao@example.com")).toBe("Call J. Rao on [number removed] or [email removed]");
    expect(scrub("Call 9876543210 now")).toBe("Call [number removed] now");
    const technical = "PRV 1 S/N V1187 removed 12 MAR 2026, test 2026-03-03, P/N 3291-A, S/N 1234567, WO-0912";
    expect(scrub(technical)).toBe(technical);
  });
});
