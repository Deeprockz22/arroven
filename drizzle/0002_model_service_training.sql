CREATE TABLE "training_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"purpose" text NOT NULL,
	"case_refs" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text,
	"byte_size" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "training_permitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "training_basis" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "training_permitted_by" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "training_permitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_exports" ADD CONSTRAINT "training_exports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exports" ADD CONSTRAINT "training_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exports" ADD CONSTRAINT "training_exports_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_training_permitted_by_users_id_fk" FOREIGN KEY ("training_permitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;