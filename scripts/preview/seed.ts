/**
 * Seeds a throwaway database for the static preview: fictional accounts and the demo case. Prints a session token.
 * Only for the disposable container started by scripts/preview/build.sh. Never point it at a real database.
 */
import { openPostgresDb } from "../../src/server/db";
import { createInvite, createSession, membershipBySlug, signUp } from "../../src/server/services/accounts";
import { loadDemoCase } from "../../src/server/services/demo";

if (process.env.PREVIEW_SEED !== "1") throw new Error("Refusing to seed: run through scripts/preview/build.sh.");
const db = openPostgresDb(process.env.DATABASE_URL!);
const pw = crypto.randomUUID();
const eng = await signUp(db, { name: "Demo Engineer", email: "engineer@example.com", password: pw, orgName: "Demo Air Technical Services" }, { mode: "open" });
const m = (await membershipBySlug(db, eng.user.id, eng.orgSlug))!;
const ctx = { db, userId: eng.user.id, orgId: m.org.id, role: m.role };
await signUp(db, { name: "Demo Reviewer", email: "reviewer@example.com", password: pw, inviteToken: await createInvite(ctx, { email: "reviewer@example.com", role: "reviewer" }) });
await loadDemoCase(ctx);
const { token } = await createSession(db, eng.user.id);
console.log(`TOKEN=${token}`);
process.exit(0);
