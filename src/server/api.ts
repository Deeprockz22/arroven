import "server-only";
import { getDb } from "./db";
import { membershipBySlug } from "./services/accounts";
import { currentUser } from "./session";
import type { Ctx } from "./context";
import { isAppError } from "./errors";

/** Resolve a member context for a route handler, or null when signed out or not a member. */
export async function apiCtx(slug: string): Promise<Ctx | null> {
  const user = await currentUser();
  if (!user) return null;
  const db = await getDb();
  const m = await membershipBySlug(db, user.id, slug);
  return m ? { db, userId: user.id, orgId: m.org.id, role: m.role } : null;
}

export function apiError(e: unknown): Response {
  if (isAppError(e)) {
    const status = e.code === "not_found" ? 404 : e.code === "forbidden" ? 403 : e.code === "unauthenticated" ? 401 : 400;
    return Response.json({ error: e.message }, { status });
  }
  console.error(e);
  return Response.json({ error: "Server error" }, { status: 500 });
}

export const notFoundResponse = () => Response.json({ error: "Not found" }, { status: 404 });
