export const KIND_LABELS: Record<string, string> = {
  report: "Reported",
  action_performed: "Work performed",
  action_planned: "Planned, not performed",
  test_result: "Test result",
  shop_result: "Shop finding",
  message_log: "Message log",
  engineering_note: "Engineering note",
  other: "Other",
};

export const STATUS_LABELS: Record<string, string> = {
  unreviewed: "Unreviewed",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
};

export const RELATION_LABELS: Record<string, string> = {
  supports: "Supports",
  challenges: "Challenges",
  inconclusive: "Inconclusive",
  not_relevant: "Not relevant",
};

export const SOURCE_KIND_LABELS: Record<string, string> = {
  tech_log: "Technical log",
  work_order: "Work order / task card",
  shop_report: "Shop or repair report",
  message_log: "Maintenance message log",
  engineering_note: "Engineering note",
  technical_reference: "Technical reference (licensed)",
  other: "Other record",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** 2026-03-02 → 02 MAR 2026, the convention used in technical logs. */
export function logDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "Date not stated";
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function utcStamp(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** Anchor id for a locator, so a locator chip can link straight to its line in the original record. */
export const lineAnchor = (loc: string) => `L-${loc.replace(/[^A-Za-z0-9]/g, "-")}`;

export const ASSESSMENT_LABELS: Record<string, string> = {
  not_assessed: "Not yet assessed",
  unresolved: "Left unresolved",
  consistent: "Consistent with the evidence so far",
  not_consistent: "Not consistent with the evidence",
};

export const AUTHORISATION_LABELS: Record<string, string> = {
  unconfirmed: "Authorisation not confirmed",
  confirmed: "Authorised",
  withdrawn: "Authorisation withdrawn",
};
