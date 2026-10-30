import type { Db } from "./db";
import { auditEvents } from "./db/schema";
import type { Ctx } from "./context";

export async function audit(
  db: Db,
  ctx: Pick<Ctx, "orgId" | "userId">,
  action: string,
  entity: string,
  entityId: string | null,
  caseId: string | null,
  detail: Record<string, unknown> = {},
) {
  await db.insert(auditEvents).values({ orgId: ctx.orgId, actorId: ctx.userId, action, entity, entityId, caseId, detail });
}
