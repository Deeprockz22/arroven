import type { Db } from "./db";
import type { Role } from "./db/schema";

/** Everything a service needs to act for one signed-in member of one organization. */
export interface Ctx {
  db: Db;
  userId: string;
  orgId: string;
  role: Role;
}
