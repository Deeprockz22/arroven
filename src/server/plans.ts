export type Plan = "trial" | "team" | "enterprise";

export const PLANS: Record<Plan, { label: string; openCases: number | null; aiRunsPerMonth: number | null; seats: number | null; price: string }> = {
  trial: { label: "Pilot", openCases: 3, aiRunsPerMonth: 60, seats: 5, price: "Free for 60 days" },
  team: { label: "Team", openCases: null, aiRunsPerMonth: 1500, seats: 50, price: "Per engineering seat" },
  enterprise: { label: "Enterprise", openCases: null, aiRunsPerMonth: null, seats: null, price: "Annual agreement, in-environment option" },
};

export function withinLimit(limit: number | null, used: number): boolean {
  return limit === null || used < limit;
}
