CREATE TABLE "comparisons" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"case_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"finding" text NOT NULL,
	"note" text NOT NULL,
	"statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"ai_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"case_id" text NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"basis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertainty" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decision_note" text,
	"decided_by" text,
	"ai_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "coverage" jsonb;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "responsible_engineer_id" text;--> statement-breakpoint
ALTER TABLE "handover_versions" ADD COLUMN "sharing_scope" text DEFAULT 'Internal to the organization' NOT NULL;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "origin" text DEFAULT 'engineer' NOT NULL;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "assessment" text DEFAULT 'not_assessed' NOT NULL;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "assessment_note" text;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "assessed_by" text;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "assessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "needs_reassessment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD COLUMN "reassess_reason" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "authorisation" text DEFAULT 'unconfirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "authorisation_basis" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "authorised_by" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "authorised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "supersedes_id" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "processing" jsonb;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "needs_reassessment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "reassess_reason" text;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_responsible_engineer_id_users_id_fk" FOREIGN KEY ("responsible_engineer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_assessed_by_users_id_fk" FOREIGN KEY ("assessed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_authorised_by_users_id_fk" FOREIGN KEY ("authorised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;