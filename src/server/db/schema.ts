import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ---------- Identity and tenancy ---------- */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  // sha256 of the cookie token; the raw token never touches the database
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan", { enum: ["trial", "team", "enterprise"] }).notNull().default("trial"),
  // When true, the person approving a handover cannot be the engineer who opened the case.
  requireIndependentReview: boolean("require_independent_review").notNull().default(true),
  createdAt: createdAt(),
});

export const ROLES = ["owner", "admin", "reviewer", "engineer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const memberships = pgTable(
  "memberships",
  {
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const invites = pgTable("invites", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ROLES }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: text("invited_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* ---------- Investigation cases ---------- */

export const cases = pgTable(
  "cases",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    title: text("title").notNull(),
    aircraft: text("aircraft").notNull(),
    system: text("system").notNull().default(""),
    question: text("question").notNull(),
    evidenceCutoff: text("evidence_cutoff"),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    isDemo: boolean("is_demo").notNull().default(false),
    changedSinceApproval: boolean("changed_since_approval").notNull().default(false),
    // The engineer accountable for the investigation. An independent reviewer must be someone else.
    responsibleEngineerId: text("responsible_engineer_id").references(() => users.id),
    // Training Use (agreement clause 6): only cases with a recorded permission are exported for model training.
    trainingPermitted: boolean("training_permitted").notNull().default(false),
    trainingBasis: text("training_basis"),
    trainingPermittedBy: text("training_permitted_by").references(() => users.id),
    trainingPermittedAt: timestamp("training_permitted_at", { withTimezone: true }),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cases_org_ref").on(t.orgId, t.ref)],
);

export const SOURCE_KINDS = ["tech_log", "work_order", "shop_report", "message_log", "engineering_note", "technical_reference", "other"] as const;

export const sources = pgTable(
  "sources",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // S1, S2 … or U1, U2 … for unavailable sources
    title: text("title").notNull(),
    custodian: text("custodian").notNull().default(""),
    kind: text("kind", { enum: SOURCE_KINDS }).notNull().default("other"),
    available: boolean("available").notNull().default(true),
    unavailableReason: text("unavailable_reason"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    sha256: text("sha256"),
    storageKey: text("storage_key"),
    // Unconfirmed permission does not permit use: only confirmed sources are sent for AI processing.
    authorisation: text("authorisation", { enum: ["unconfirmed", "confirmed", "withdrawn"] }).notNull().default("unconfirmed"),
    authorisationBasis: text("authorisation_basis"),
    authorisedBy: text("authorised_by").references(() => users.id),
    authorisedAt: timestamp("authorised_at", { withTimezone: true }),
    // A corrected copy supersedes the earlier one; both stay visible.
    supersedesId: text("supersedes_id"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    // What intake actually extracted, e.g. PDF pages with no text layer.
    processing: jsonb("processing").$type<{ lines: number; pages?: number; emptyPages?: number[]; truncated?: number }>(),
    importedBy: text("imported_by").notNull().references(() => users.id),
    importedAt: createdAt(),
  },
  (t) => [uniqueIndex("sources_case_code").on(t.caseId, t.code)],
);

/** One citable unit of an original record: a text line, a PDF line on a page, or a CSV row. */
export const segments = pgTable(
  "segments",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    locator: text("locator").notNull(), // S1:2, S3:p2.14, S4:R7
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
  },
  (t) => [uniqueIndex("segments_case_locator").on(t.caseId, t.locator), index("segments_source").on(t.sourceId)],
);

export const STATEMENT_KINDS = ["report", "action_performed", "action_planned", "test_result", "shop_result", "message_log", "engineering_note", "other"] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];
export const STATEMENT_STATUSES = ["unreviewed", "accepted", "edited", "rejected"] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

export const statements = pgTable(
  "statements",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // C1, C2 … never reused within a case
    segmentId: text("segment_id").notNull().references(() => segments.id),
    locator: text("locator").notNull(),
    eventDate: text("event_date"), // ISO yyyy-mm-dd as read from the record
    kind: text("kind", { enum: STATEMENT_KINDS }).notNull(),
    text: text("text").notNull(),
    draftText: text("draft_text").notNull(), // the wording as first drafted, kept for error measurement
    conditions: text("conditions").notNull().default(""),
    uncertain: boolean("uncertain").notNull().default(false),
    uncertainNote: text("uncertain_note").notNull().default(""),
    status: text("status", { enum: STATEMENT_STATUSES }).notNull().default("unreviewed"),
    origin: text("origin", { enum: ["ai", "engineer"] }).notNull(),
    aiRunId: text("ai_run_id"),
    // Set when the basis changed (corrected or withdrawn source). Cleared only by an engineer's re-check.
    needsReassessment: boolean("needs_reassessment").notNull().default(false),
    reassessReason: text("reassess_reason"),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("statements_case_code").on(t.caseId, t.code), index("statements_case").on(t.caseId)],
);

export const flags = pgTable("flags", {
  id: id(),
  orgId: text("org_id").notNull(),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  type: text("type", { enum: ["conflict", "gap"] }).notNull(),
  text: text("text").notNull(),
  refs: jsonb("refs").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status", { enum: ["open", "question", "dismissed"] }).notNull().default("open"),
  aiRunId: text("ai_run_id"),
  decidedBy: text("decided_by").references(() => users.id),
  createdAt: createdAt(),
});

export const ASSESSMENTS = ["not_assessed", "unresolved", "consistent", "not_consistent"] as const;
export type Assessment = (typeof ASSESSMENTS)[number];

export const hypotheses = pgTable(
  "hypotheses",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    origin: text("origin", { enum: ["engineer", "ai_proposal"] }).notNull().default("engineer"),
    // The engineer's reviewed interpretation. Never a root-cause finding.
    assessment: text("assessment", { enum: ASSESSMENTS }).notNull().default("not_assessed"),
    assessmentNote: text("assessment_note"),
    assessedBy: text("assessed_by").references(() => users.id),
    assessedAt: timestamp("assessed_at", { withTimezone: true }),
    needsReassessment: boolean("needs_reassessment").notNull().default(false),
    reassessReason: text("reassess_reason"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("hypotheses_case_code").on(t.caseId, t.code)],
);

export const RELATIONS = ["supports", "challenges", "inconclusive", "not_relevant"] as const;
export type Relation = (typeof RELATIONS)[number];

/** AI suggestions. Never shown as conclusions; the engineer records decisions separately. */
export const suggestions = pgTable("suggestions", {
  id: id(),
  orgId: text("org_id").notNull(),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  hypothesisId: text("hypothesis_id").notNull().references(() => hypotheses.id, { onDelete: "cascade" }),
  statementId: text("statement_id").notNull().references(() => statements.id, { onDelete: "cascade" }),
  relation: text("relation", { enum: ["supports", "challenges", "inconclusive"] }).notNull(),
  rationale: text("rationale").notNull(),
  caveat: text("caveat").notNull().default(""),
  aiRunId: text("ai_run_id"),
  createdAt: createdAt(),
});

export const evidenceGaps = pgTable("evidence_gaps", {
  id: id(),
  orgId: text("org_id").notNull(),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  hypothesisId: text("hypothesis_id").notNull().references(() => hypotheses.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  status: text("status", { enum: ["open", "question", "dismissed"] }).notNull().default("open"),
  aiRunId: text("ai_run_id"),
  createdAt: createdAt(),
});

/** Engineer decisions: what a checked statement means for one explanation, and why. */
export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    hypothesisId: text("hypothesis_id").notNull().references(() => hypotheses.id, { onDelete: "cascade" }),
    statementId: text("statement_id").notNull().references(() => statements.id, { onDelete: "cascade" }),
    relation: text("relation", { enum: RELATIONS }).notNull(),
    reason: text("reason").notNull(),
    decidedBy: text("decided_by").notNull().references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("decisions_hyp_stmt").on(t.hypothesisId, t.statementId)],
);

export const questions = pgTable("questions", {
  id: id(),
  orgId: text("org_id").notNull(),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  text: text("text").notNull(),
  origin: text("origin", { enum: ["engineer", "flag", "evidence_gap", "ai_proposal", "comparison"] }).notNull(),
  originRef: text("origin_ref"),
  status: text("status", { enum: ["open", "answered"] }).notNull().default("open"),
  answer: text("answer"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

/** Approved handovers are immutable. A later change to the case produces a new version. */
export const handoverVersions = pgTable(
  "handover_versions",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    markdown: text("markdown").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    sha256: text("sha256").notNull(),
    sharingScope: text("sharing_scope").notNull().default("Internal to the organization"),
    approvedBy: text("approved_by").notNull().references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("handover_case_version").on(t.caseId, t.version)],
);

/** AI comparisons of findings (stage 5). Shown for review; never conclusions. */
export const comparisons = pgTable("comparisons", {
  id: id(),
  orgId: text("org_id").notNull(),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  title: text("title").notNull(),
  finding: text("finding", { enum: ["agree", "differ", "cannot_compare"] }).notNull(),
  note: text("note").notNull(),
  statements: jsonb("statements").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status", { enum: ["open", "question", "dismissed"] }).notNull().default("open"),
  aiRunId: text("ai_run_id"),
  createdAt: createdAt(),
});

/** AI proposals (stage 6): possible explanations or questions that need engineering review. */
export const proposals = pgTable("proposals", {
  id: id(),
  orgId: text("org_id").notNull(),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  kind: text("kind", { enum: ["explanation", "question"] }).notNull(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  basis: jsonb("basis").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  uncertainty: text("uncertainty").notNull().default(""),
  status: text("status", { enum: ["proposed", "adopted", "rejected", "unresolved"] }).notNull().default("proposed"),
  decisionNote: text("decision_note"),
  decidedBy: text("decided_by").references(() => users.id),
  aiRunId: text("ai_run_id"),
  createdAt: createdAt(),
});

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["chronology", "evidence", "analysis"] }).notNull(),
    targetId: text("target_id"), // hypothesis id for evidence runs
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull().default("queued"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    produced: integer("produced").notNull().default(0),
    dropped: integer("dropped").notNull().default(0),
    // Which sources the run read and which it left out, so partial coverage is never shown as complete.
    coverage: jsonb("coverage").$type<{ included: string[]; excluded: { code: string; reason: string }[] }>(),
    error: text("error"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("ai_runs_org_created").on(t.orgId, t.createdAt)],
);

/**
 * Every training dataset ARROVEN builds from partner data. The record of which data each model version
 * used (agreement clause 6.4) is this table plus the export's manifest. Deleting an export removes the file
 * and keeps this row as evidence of the deletion.
 */
export const trainingExports = pgTable("training_exports", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  caseRefs: jsonb("case_refs").$type<string[]>().notNull(),
  counts: jsonb("counts").$type<Record<string, number>>().notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key"),
  byteSize: integer("byte_size").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by").references(() => users.id),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    caseId: text("case_id"),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_case").on(t.orgId, t.caseId, t.createdAt)],
);
