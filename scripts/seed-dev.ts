/**
 * Local development seed: one organization, an engineer-owner and an independent reviewer, and the demo case.
 * Uses the embedded database in ./.data/pglite, so stop `npm run dev` before running it.
 * These accounts exist only in your local database. Never run this against production.
 */
import path from "node:path";
import { openPgliteDb, openPostgresDb } from "../src/server/db";
import { membershipBySlug, signUp, createInvite } from "../src/server/services/accounts";
import { loadDemoCase } from "../src/server/services/demo";

export const DEV_ACCOUNTS = {
  engineer: { name: "Dev Engineer", email: "engineer@arroven.localhost", password: "local-dev-only-1" },
  reviewer: { name: "Dev Reviewer", email: "reviewer@arroven.localhost", password: "local-dev-only-2" },
};

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed development accounts in production.");
const db = process.env.DATABASE_URL ? openPostgresDb(process.env.DATABASE_URL) : await openPgliteDb(path.join(process.cwd(), ".data", "pglite"));

const eng = await signUp(db, { ...DEV_ACCOUNTS.engineer, orgName: "Demo Air Technical Services" });
const m = (await membershipBySlug(db, eng.user.id, eng.orgSlug))!;
const ctx = { db, userId: eng.user.id, orgId: m.org.id, role: m.role };
const token = await createInvite(ctx, { email: DEV_ACCOUNTS.reviewer.email, role: "reviewer" });
await signUp(db, { ...DEV_ACCOUNTS.reviewer, inviteToken: token });
const c = await loadDemoCase(ctx);
console.log(`Seeded organization "${m.org.name}" (/app/${eng.orgSlug}) with demo case ${c.ref}.`);
console.log(`Sign in as ${DEV_ACCOUNTS.engineer.email} or ${DEV_ACCOUNTS.reviewer.email}; passwords are in scripts/seed-dev.ts.`);
process.exit(0);
