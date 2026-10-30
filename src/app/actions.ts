"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { organizations } from "@/server/db/schema";
import { isAppError } from "@/server/errors";
import type { Ctx } from "@/server/context";
import { assertCan } from "@/server/permissions";
import { audit } from "@/server/audit";
import { PLANS, type Plan } from "@/server/plans";
import { endSession, requireOrg, requireUser, startSession } from "@/server/session";
import {
  acceptInvite, authenticate, changeRole, createInvite, removeMember, signUp, updateOrgSettings,
} from "@/server/services/accounts";
import {
  addQuestion, addStatement, addUnavailableSource, answerQuestion, approveHandover, assessHypothesis, assignResponsibleEngineer, clearDecision,
  createCase, createHypothesis, decideComparison, decideFlag, decideGap, decideProposal, importSource, recheckStatement, recordDecision,
  reviewStatement, setCaseStatus, setSourceAuthorisation, updateCaseDetails,
} from "@/server/services/cases";
import { loadDemoCase } from "@/server/services/demo";
import { executeRun, startRun } from "@/server/ai/runs";
import { createTrainingExport, deleteTrainingExport, setCaseTrainingPermission } from "@/server/training/export";

export type ActionState = { error?: string; ok?: string; data?: Record<string, string> } | undefined;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** The address people use to reach this deployment: APP_URL if set, otherwise the request's own host. */
async function publicBaseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function fail(e: unknown): ActionState {
  if (isAppError(e)) return { error: e.message };
  console.error(e);
  return { error: "Something went wrong and nothing was saved. Try again." };
}

/** Resolve the member's context from the form, run the change, and refresh the case pages. */
async function caseAction(fd: FormData, fn: (ctx: Ctx, caseId: string) => Promise<string | void>): Promise<ActionState> {
  const slug = str(fd, "org"), caseId = str(fd, "caseId");
  try {
    const { ctx } = await requireOrg(slug);
    const ok = await fn(ctx, caseId);
    revalidatePath(`/app/${slug}/cases/${caseId}`, "layout");
    return { ok: ok || undefined };
  } catch (e) {
    return fail(e);
  }
}

async function orgAction(fd: FormData, fn: (ctx: Ctx) => Promise<ActionState | void>): Promise<ActionState> {
  const slug = str(fd, "org");
  try {
    const { ctx } = await requireOrg(slug);
    const r = await fn(ctx);
    revalidatePath(`/app/${slug}`, "layout");
    return r ?? {};
  } catch (e) {
    return fail(e);
  }
}

/* ---------- auth ---------- */

export async function signUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let slug: string;
  try {
    const db = await getDb();
    const invite = str(fd, "invite") || undefined;
    const r = await signUp(db, { name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password"), orgName: str(fd, "orgName") || undefined, inviteToken: invite });
    await startSession(r.user.id);
    slug = r.orgSlug;
  } catch (e) {
    return fail(e);
  }
  redirect(`/app/${slug}/cases`);
}

export async function signInAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await authenticate(await getDb(), str(fd, "email"), str(fd, "password"));
    await startSession(user.id);
  } catch (e) {
    return fail(e);
  }
  const next = str(fd, "next");
  redirect(next.startsWith("/app/") || next.startsWith("/invite/") ? next : "/app");
}

export async function signOutAction() {
  await endSession();
  redirect("/login");
}

export async function acceptInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let slug: string;
  try {
    const user = await requireUser();
    const org = await acceptInvite(await getDb(), user.id, user.email, str(fd, "token"));
    slug = org.slug;
  } catch (e) {
    return fail(e);
  }
  redirect(`/app/${slug}/cases`);
}

/* ---------- organization ---------- */

export async function inviteAction(_: ActionState, fd: FormData) {
  return orgAction(fd, async (ctx) => {
    const token = await createInvite(ctx, { email: str(fd, "email"), role: str(fd, "role") });
    const link = `${await publicBaseUrl()}/invite/${token}`;
    return { ok: "Invite created. Send this link to them; it works once and expires in 7 days.", data: { link } };
  });
}

export async function changeRoleAction(_: ActionState, fd: FormData) {
  return orgAction(fd, async (ctx) => { await changeRole(ctx, str(fd, "userId"), str(fd, "role")); return { ok: "Role updated." }; });
}

export async function removeMemberAction(_: ActionState, fd: FormData) {
  return orgAction(fd, async (ctx) => { await removeMember(ctx, str(fd, "userId")); return { ok: "Member removed." }; });
}

export async function settingsAction(_: ActionState, fd: FormData) {
  return orgAction(fd, async (ctx) => {
    await updateOrgSettings(ctx, { name: str(fd, "name"), requireIndependentReview: fd.get("requireIndependentReview") === "on" });
    return { ok: "Settings saved." };
  });
}

export async function planAction(_: ActionState, fd: FormData) {
  return orgAction(fd, async (ctx) => {
    assertCan(ctx.role, "org.settings");
    if (ctx.role !== "owner") return { error: "Only an owner can change the plan." };
    const plan = str(fd, "plan") as Plan;
    if (!(plan in PLANS)) return { error: "Unknown plan." };
    await ctx.db.update(organizations).set({ plan }).where(eq(organizations.id, ctx.orgId));
    await audit(ctx.db, ctx, "org.plan_changed", "organization", ctx.orgId, null, { plan });
    return { ok: `Plan changed to ${PLANS[plan].label}.` };
  });
}

/* ---------- cases ---------- */

export async function createCaseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const slug = str(fd, "org");
  let id: string;
  try {
    const { ctx } = await requireOrg(slug);
    const c = await createCase(ctx, { title: str(fd, "title"), aircraft: str(fd, "aircraft"), system: str(fd, "system"), question: str(fd, "question"), evidenceCutoff: str(fd, "evidenceCutoff") });
    id = c.id;
  } catch (e) {
    return fail(e);
  }
  redirect(`/app/${slug}/cases/${id}/sources`);
}

export async function loadDemoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const slug = str(fd, "org");
  let id: string;
  try {
    const { ctx } = await requireOrg(slug);
    id = (await loadDemoCase(ctx)).id;
  } catch (e) {
    return fail(e);
  }
  redirect(`/app/${slug}/cases/${id}/chronology`);
}

export async function caseStatusAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    const status = str(fd, "status") === "closed" ? "closed" : "open";
    await setCaseStatus(ctx, caseId, status);
    return status === "closed" ? "Case closed." : "Case reopened.";
  });
}

export async function updateCaseAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    await updateCaseDetails(ctx, caseId, { title: str(fd, "title"), aircraft: str(fd, "aircraft"), system: str(fd, "system"), question: str(fd, "question"), evidenceCutoff: str(fd, "evidenceCutoff") });
    return "Case details saved. If the question or cutoff changed, assessed explanations are flagged for reassessment.";
  });
}

export async function assignAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => { await assignResponsibleEngineer(ctx, caseId, str(fd, "userId")); return "Responsible engineer updated."; });
}

/* ---------- sources ---------- */

export async function importSourceAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    const file = fd.get("file");
    const pasted = str(fd, "pasted");
    let bytes: Uint8Array, fileName: string, mimeType: string;
    if (file instanceof File && file.size > 0) {
      bytes = new Uint8Array(await file.arrayBuffer());
      fileName = file.name;
      mimeType = file.type || "application/octet-stream";
    } else {
      bytes = new TextEncoder().encode(pasted);
      fileName = "pasted-record.txt";
      mimeType = "text/plain";
    }
    const r = await importSource(ctx, caseId, {
      title: str(fd, "title"), custodian: str(fd, "custodian"), kind: (str(fd, "kind") || "other") as never, fileName, mimeType, bytes,
      supersedesSourceId: str(fd, "supersedes") || undefined, authorisationBasis: str(fd, "authorisationBasis") || undefined,
    });
    const auth = r.source.authorisation === "confirmed" ? "Authorisation recorded." : "Authorisation is not confirmed yet, so the AI will not read it.";
    return `Imported ${r.source.code} with ${r.segmentCount} citable line${r.segmentCount === 1 ? "" : "s"}. ${auth}${str(fd, "supersedes") ? " Statements citing the earlier copy are flagged for a re-check." : ""}`;
  });
}

export async function unavailableSourceAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    const s = await addUnavailableSource(ctx, caseId, { title: str(fd, "title"), reason: str(fd, "reason"), custodian: str(fd, "custodian") });
    return `Recorded ${s.code} as unavailable.`;
  });
}

export async function authorisationAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    const status = str(fd, "status") as "confirmed" | "withdrawn" | "unconfirmed";
    await setSourceAuthorisation(ctx, caseId, str(fd, "sourceId"), status, str(fd, "basis"));
    return status === "confirmed" ? "Authorisation confirmed." : status === "withdrawn" ? "Authorisation withdrawn. Dependent statements are flagged." : "Marked as unconfirmed.";
  });
}

/* ---------- chronology ---------- */

export async function reviewAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    const verdict = str(fd, "verdict") as "accept" | "reject" | "reset";
    const text = fd.has("text") ? str(fd, "text") : undefined;
    await reviewStatement(ctx, caseId, str(fd, "statementId"), verdict, text);
  });
}

export async function recheckAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    await recheckStatement(ctx, caseId, str(fd, "statementId"), { locator: str(fd, "locator"), text: str(fd, "text"), conditions: fd.has("conditions") ? str(fd, "conditions") : undefined });
    return "Re-checked.";
  });
}

export async function addStatementAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    const s = await addStatement(ctx, caseId, { locator: str(fd, "locator"), kind: str(fd, "kind") as never, text: str(fd, "text"), eventDate: str(fd, "eventDate"), conditions: str(fd, "conditions") });
    return `Added ${s.code}.`;
  });
}

export async function flagAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    await decideFlag(ctx, caseId, str(fd, "flagId"), str(fd, "decision") as "question" | "dismiss" | "reopen");
  });
}

/* ---------- explanations ---------- */

export async function createHypothesisAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    const h = await createHypothesis(ctx, caseId, { title: str(fd, "title"), text: str(fd, "text") });
    return `Added ${h.code}.`;
  });
}

export async function decisionAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    await recordDecision(ctx, caseId, { hypothesisId: str(fd, "hypothesisId"), statementId: str(fd, "statementId"), relation: str(fd, "relation"), reason: str(fd, "reason") });
    return "Decision recorded.";
  });
}

export async function clearDecisionAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    await clearDecision(ctx, caseId, str(fd, "hypothesisId"), str(fd, "statementId"));
  });
}

export async function assessAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    await assessHypothesis(ctx, caseId, str(fd, "hypothesisId"), str(fd, "assessment"), str(fd, "note"));
    return "Assessment recorded.";
  });
}

export async function comparisonAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    await decideComparison(ctx, caseId, str(fd, "comparisonId"), str(fd, "decision") as "question" | "dismiss" | "reopen");
  });
}

export async function proposalAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    const created = await decideProposal(ctx, caseId, str(fd, "proposalId"), {
      decision: str(fd, "decision"), title: fd.has("title") ? str(fd, "title") : undefined, text: fd.has("text") ? str(fd, "text") : undefined, note: str(fd, "note"),
    });
    return created ? `Adopted as ${created}.` : "Decision recorded.";
  });
}

export async function gapAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    await decideGap(ctx, caseId, str(fd, "gapId"), str(fd, "decision") as "question" | "dismiss");
  });
}

/* ---------- questions and review ---------- */

export async function addQuestionAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => { await addQuestion(ctx, caseId, str(fd, "text")); return "Question added."; });
}

export async function answerQuestionAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    await answerQuestion(ctx, caseId, str(fd, "questionId"), str(fd, "reopen") ? null : str(fd, "answer"));
  });
}

export async function approveAction(_: ActionState, fd: FormData) {
  if (fd.get("confirm") !== "on") return { error: "Confirm that you have reviewed the handover before approving." };
  return caseAction(fd, async (ctx, caseId) => {
    const v = await approveHandover(ctx, caseId, str(fd, "sharingScope"));
    return `Handover v${v.version} approved and frozen.`;
  });
}

/* ---------- AI ---------- */

export async function startRunAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const slug = str(fd, "org"), caseId = str(fd, "caseId");
  try {
    const { ctx } = await requireOrg(slug);
    const k = str(fd, "kind");
    const kind = k === "evidence" || k === "analysis" ? k : "chronology";
    const run = await startRun(ctx, caseId, kind, str(fd, "hypothesisId") || undefined);
    after(() => executeRun(ctx.db, run.id));
    return { data: { runId: run.id } };
  } catch (e) {
    return fail(e);
  }
}

/* ---------- training data for ARROVEN's own models ---------- */

export async function trainingPermissionAction(_: ActionState, fd: FormData) {
  return caseAction(fd, async (ctx, caseId) => {
    const permitted = str(fd, "permitted") === "yes";
    await setCaseTrainingPermission(ctx, caseId, permitted, str(fd, "basis"));
    return permitted ? "Training use recorded for this case." : "Training use withdrawn. Existing exports are listed in Settings.";
  });
}

export async function createTrainingExportAction(_: ActionState, fd: FormData) {
  return orgAction(fd, async (ctx) => {
    const e = await createTrainingExport(ctx, str(fd, "purpose"));
    return { ok: `Export created from ${e.caseRefs.length} case${e.caseRefs.length === 1 ? "" : "s"}.` };
  });
}

export async function deleteTrainingExportAction(_: ActionState, fd: FormData) {
  return orgAction(fd, async (ctx) => {
    await deleteTrainingExport(ctx, str(fd, "exportId"));
    return { ok: "Export deleted. The log entry is kept as a record of the deletion." };
  });
}
