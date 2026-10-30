import { afterEach, describe, expect, it } from "vitest";
import { openPgliteDb } from "@/server/db";
import { allowedEmails, isEmailAllowed } from "@/server/access";
import { authenticate, createInvite, membershipBySlug, signUp } from "@/server/services/accounts";

const env = { ...process.env };
afterEach(() => {
  process.env.ALLOWED_EMAILS = env.ALLOWED_EMAILS;
  if (env.ALLOWED_EMAILS === undefined) delete process.env.ALLOWED_EMAILS;
  (process.env as Record<string, string>).NODE_ENV = env.NODE_ENV ?? "test";
});
const pw = "correct horse battery";

describe("access list", () => {
  it("parses addresses case-insensitively with commas, spaces or semicolons", () => {
    process.env.ALLOWED_EMAILS = " Owner@Example.test, friend@example.test ;third@example.test ";
    expect([...allowedEmails()!]).toEqual(["owner@example.test", "friend@example.test", "third@example.test"]);
    expect(isEmailAllowed("FRIEND@example.test")).toBe(true);
    expect(isEmailAllowed("stranger@example.test")).toBe(false);
  });

  it("fails closed in production when no list is set", () => {
    delete process.env.ALLOWED_EMAILS;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(isEmailAllowed("owner@example.test")).toBe(false);
  });

  it("only lets listed addresses sign up, sign in or be invited", async () => {
    const db = await openPgliteDb();
    // An account created before the list existed is shut out once the list leaves it off.
    await signUp(db, { name: "Early", email: "early@example.test", password: pw, orgName: "Early Org" });
    process.env.ALLOWED_EMAILS = "owner@example.test, friend@example.test";

    await expect(signUp(db, { name: "Stranger", email: "stranger@example.test", password: pw, orgName: "X" }, { mode: "open" })).rejects.toThrow(/doesn't have access/);
    await expect(authenticate(db, "early@example.test", pw)).rejects.toThrow(/doesn't have access/);

    const owner = await signUp(db, { name: "Owner", email: "owner@example.test", password: pw, orgName: "Owner Org" }, { mode: "open" });
    const m = (await membershipBySlug(db, owner.user.id, owner.orgSlug))!;
    const ctx = { db, userId: owner.user.id, orgId: m.org.id, role: m.role };
    await expect(createInvite(ctx, { email: "stranger@example.test", role: "viewer" })).rejects.toThrow(/access list/);
    const token = await createInvite(ctx, { email: "friend@example.test", role: "reviewer" });
    const friend = await signUp(db, { name: "Friend", email: "friend@example.test", password: pw, inviteToken: token }, { mode: "invite" });
    expect(friend.orgSlug).toBe(owner.orgSlug);
    await expect(authenticate(db, "friend@example.test", pw)).resolves.toMatchObject({ name: "Friend" });
  });
});
