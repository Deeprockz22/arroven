import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { invites, memberships, organizations, sessions, users, type Role, ROLES } from "../db/schema";
import { AppError } from "../errors";
import { dummyHash, hashPassword, newToken, sha256, verifyPassword } from "../auth/crypto";
import { assertCan } from "../permissions";
import { PLANS, withinLimit } from "../plans";
import { audit } from "../audit";
import type { Ctx } from "../context";

export const SESSION_DAYS = 14;

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
const password = z.string().min(10, "Use at least 10 characters for the password.").max(200);
const name = z.string().trim().min(1, "Enter your name.").max(120);

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "org";
}

async function uniqueSlug(db: Db, base: string) {
  let slug = slugify(base);
  for (let i = 2; ; i++) {
    const [hit] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
    if (!hit) return slug;
    slug = `${slugify(base).slice(0, 36)}-${i}`;
  }
}

export async function signUp(db: Db, input: { name: string; email: string; password: string; orgName?: string; inviteToken?: string }) {
  const parsed = z.object({ name, email, password, orgName: z.string().trim().max(120).optional() }).safeParse(input);
  if (!parsed.success) throw new AppError("invalid", parsed.error.issues[0].message);
  const { name: n, email: e, password: p, orgName } = parsed.data;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, e));
  if (existing) throw new AppError("conflict", "An account with this email already exists. Sign in instead.");

  const passwordHash = await hashPassword(p);
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email: e, name: n, passwordHash }).returning();
    if (input.inviteToken) {
      const org = await acceptInvite(tx as unknown as Db, user.id, user.email, input.inviteToken);
      return { user, orgSlug: org.slug };
    }
    if (!orgName) throw new AppError("invalid", "Enter your organization's name.");
    const [org] = await tx.insert(organizations).values({ name: orgName, slug: await uniqueSlug(tx as unknown as Db, orgName) }).returning();
    await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner" });
    await audit(tx as unknown as Db, { orgId: org.id, userId: user.id }, "org.created", "organization", org.id, null, { name: orgName });
    return { user, orgSlug: org.slug };
  });
}

export async function authenticate(db: Db, emailInput: string, pw: string) {
  const e = emailInput.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, e));
  // Compare against a dummy hash when the user is unknown so response time does not reveal accounts.
  const ok = await verifyPassword(pw, user?.passwordHash ?? (await dummyHash()));
  if (!user || !ok) throw new AppError("unauthenticated", "That email and password do not match an account.");
  return user;
}

export async function createSession(db: Db, userId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function userForSession(db: Db, token: string) {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function orgsForUser(db: Db, userId: string) {
  return db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(organizations.name);
}

export async function membershipBySlug(db: Db, userId: string, slug: string) {
  const [row] = await db
    .select({ org: organizations, role: memberships.role })
    .from(organizations)
    .innerJoin(memberships, and(eq(memberships.orgId, organizations.id), eq(memberships.userId, userId)))
    .where(eq(organizations.slug, slug));
  return row ?? null;
}

/* ---------- Members and invites ---------- */

export async function listMembers(ctx: Ctx) {
  return ctx.db
    .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, since: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, ctx.orgId))
    .orderBy(users.name);
}

export async function listPendingInvites(ctx: Ctx) {
  return ctx.db
    .select({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(eq(invites.orgId, ctx.orgId), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())));
}

export async function createInvite(ctx: Ctx, input: { email: string; role: string }) {
  assertCan(ctx.role, "members.manage");
  const e = email.safeParse(input.email);
  if (!e.success) throw new AppError("invalid", e.error.issues[0].message);
  const role = ROLES.includes(input.role as Role) ? (input.role as Role) : null;
  if (!role) throw new AppError("invalid", "Choose a role for the invite.");
  if (role === "owner" && ctx.role !== "owner") throw new AppError("forbidden", "Only an owner can invite another owner.");

  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.orgId, ctx.orgId));
  if (!withinLimit(PLANS[org.plan].seats, n)) throw new AppError("limit", `The ${PLANS[org.plan].label} plan allows ${PLANS[org.plan].seats} members.`);

  const token = newToken();
  await ctx.db.insert(invites).values({
    orgId: ctx.orgId, email: e.data, role, tokenHash: sha256(token), invitedBy: ctx.userId, expiresAt: new Date(Date.now() + 7 * 864e5),
  });
  await audit(ctx.db, ctx, "member.invited", "invite", null, null, { email: e.data, role });
  return token;
}

export async function inviteDetails(db: Db, token: string) {
  const [row] = await db
    .select({ invite: invites, orgName: organizations.name })
    .from(invites)
    .innerJoin(organizations, eq(organizations.id, invites.orgId))
    .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())));
  return row ?? null;
}

export async function acceptInvite(db: Db, userId: string, userEmail: string, token: string) {
  const row = await inviteDetails(db, token);
  if (!row) throw new AppError("not_found", "This invite link has expired or was already used.");
  if (row.invite.email !== userEmail.toLowerCase()) throw new AppError("forbidden", `This invite was sent to ${row.invite.email}. Sign in with that address to accept it.`);
  await db.insert(memberships).values({ orgId: row.invite.orgId, userId, role: row.invite.role }).onConflictDoNothing();
  await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, row.invite.id));
  await audit(db, { orgId: row.invite.orgId, userId }, "member.joined", "membership", userId, null, { role: row.invite.role });
  const [org] = await db.select().from(organizations).where(eq(organizations.id, row.invite.orgId));
  return org;
}

export async function changeRole(ctx: Ctx, targetUserId: string, role: string) {
  assertCan(ctx.role, "members.manage");
  if (!ROLES.includes(role as Role)) throw new AppError("invalid", "Unknown role.");
  if (role === "owner" && ctx.role !== "owner") throw new AppError("forbidden", "Only an owner can make someone an owner.");
  const [target] = await ctx.db.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, targetUserId)));
  if (!target) throw new AppError("not_found", "That person is not a member.");
  if (target.role === "owner" && ctx.role !== "owner") throw new AppError("forbidden", "Only an owner can change an owner's role.");
  if (target.role === "owner" && role !== "owner") await assertAnotherOwner(ctx, targetUserId);
  await ctx.db.update(memberships).set({ role: role as Role }).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, targetUserId)));
  await audit(ctx.db, ctx, "member.role_changed", "membership", targetUserId, null, { from: target.role, to: role });
}

export async function removeMember(ctx: Ctx, targetUserId: string) {
  assertCan(ctx.role, "members.manage");
  const [target] = await ctx.db.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, targetUserId)));
  if (!target) throw new AppError("not_found", "That person is not a member.");
  if (target.role === "owner") {
    if (ctx.role !== "owner") throw new AppError("forbidden", "Only an owner can remove an owner.");
    await assertAnotherOwner(ctx, targetUserId);
  }
  await ctx.db.delete(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, targetUserId)));
  await audit(ctx.db, ctx, "member.removed", "membership", targetUserId, null, { role: target.role });
}

async function assertAnotherOwner(ctx: Ctx, exceptUserId: string) {
  const owners = await ctx.db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.role, "owner")));
  if (!owners.some((o) => o.userId !== exceptUserId)) throw new AppError("conflict", "An organization needs at least one owner.");
}

export async function updateOrgSettings(ctx: Ctx, input: { name?: string; requireIndependentReview?: boolean }) {
  assertCan(ctx.role, "org.settings");
  const patch: Partial<typeof organizations.$inferInsert> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new AppError("invalid", "Enter an organization name.");
    patch.name = n.slice(0, 120);
  }
  if (input.requireIndependentReview !== undefined) patch.requireIndependentReview = input.requireIndependentReview;
  await ctx.db.update(organizations).set(patch).where(eq(organizations.id, ctx.orgId));
  await audit(ctx.db, ctx, "org.settings_changed", "organization", ctx.orgId, null, patch);
}
