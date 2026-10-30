import type { Role } from "./db/schema";
import { AppError } from "./errors";

export type Action =
  | "case.read"
  | "case.create"
  | "case.edit"
  | "source.import"
  | "statement.review"
  | "hypothesis.write"
  | "decision.write"
  | "question.write"
  | "ai.run"
  | "handover.approve"
  | "source.authorise"
  | "case.assign"
  | "training.manage"
  | "members.manage"
  | "org.settings";

const ENGINEER: Action[] = [
  "case.read", "case.create", "case.edit", "source.import", "statement.review",
  "hypothesis.write", "decision.write", "question.write", "ai.run",
];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  viewer: new Set(["case.read"]),
  engineer: new Set(ENGINEER),
  reviewer: new Set([...ENGINEER, "handover.approve", "source.authorise", "case.assign"]),
  admin: new Set([...ENGINEER, "handover.approve", "source.authorise", "case.assign", "members.manage", "org.settings", "training.manage"]),
  owner: new Set([...ENGINEER, "handover.approve", "source.authorise", "case.assign", "members.manage", "org.settings", "training.manage"]),
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].has(action);
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) throw new AppError("forbidden", "Your role in this organization does not allow that action.");
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  reviewer: "Reviewing engineer",
  engineer: "Engineer",
  viewer: "Viewer",
};
