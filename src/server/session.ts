import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "./db";
import { createSession, deleteSession, membershipBySlug, userForSession } from "./services/accounts";
import type { Ctx } from "./context";

const COOKIE = "arroven_session";

export const currentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return userForSession(await getDb(), token);
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Resolve the signed-in member of an organization, or 404 so other organizations' slugs reveal nothing. */
export const requireOrg = cache(async (slug: string) => {
  const user = await requireUser();
  const db = await getDb();
  const m = await membershipBySlug(db, user.id, slug);
  if (!m) notFound();
  const ctx: Ctx = { db, userId: user.id, orgId: m.org.id, role: m.role };
  return { user, org: m.org, role: m.role, ctx };
});

export async function startSession(userId: string) {
  const { token, expiresAt } = await createSession(await getDb(), userId);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await deleteSession(await getDb(), token);
  jar.delete(COOKIE);
}
