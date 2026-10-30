import { describe, expect, it } from "vitest";
import { acceptChronology, acceptEvidence } from "@/server/ai/validate";

describe("acceptChronology", () => {
  const locs = new Set(["S1:2", "S1:3", "S2:4"]);
  it("keeps statements whose locator exists and drops the rest", () => {
    const r = acceptChronology({
      statements: [
        { locator: "[S1:2]", event_date: "2026-03-02", kind: "report", text: "Fault in cruise", conditions: "FL370", uncertain: false, uncertain_note: "" },
        { locator: "S9:1", event_date: "", kind: "report", text: "Invented line", conditions: "", uncertain: false, uncertain_note: "" },
        { locator: "S2:4", event_date: "03 MAR", kind: "weird", text: "Test ok", conditions: "", uncertain: true, uncertain_note: "ambiguous" },
        { nonsense: true },
      ],
      flags: [{ type: "conflict", text: "Records disagree", refs: ["S1:2", "S9:9", "U1"] }],
    }, locs, new Set(["U1"]));
    expect(r.dropped).toBe(2);
    expect(r.statements).toHaveLength(2);
    expect(r.statements[0]).toMatchObject({ locator: "S1:2", eventDate: "2026-03-02", kind: "report" });
    expect(r.statements[1]).toMatchObject({ eventDate: null, kind: "other", uncertain: true, uncertainNote: "ambiguous" });
    expect(r.flags[0].refs).toEqual(["S1:2", "U1"]);
  });

  it("throws when the shape is wrong", () => {
    expect(() => acceptChronology({ foo: 1 }, locs, new Set())).toThrow();
  });
});

describe("acceptEvidence", () => {
  it("drops unknown and duplicate statement codes", () => {
    const r = acceptEvidence({
      links: [
        { statement: "C2", relation: "supports", rationale: "Consistent.", caveat: "" },
        { statement: "c2", relation: "challenges", rationale: "Duplicate.", caveat: "" },
        { statement: "C99", relation: "supports", rationale: "Unknown.", caveat: "" },
        { statement: "C3", relation: "proves", rationale: "Bad relation.", caveat: "" },
      ],
      missing_evidence: ["Cold soak test", "", 5],
    }, new Set(["C2", "C3"]));
    expect(r.links).toHaveLength(1);
    expect(r.dropped).toBe(3);
    expect(r.gaps).toEqual(["Cold soak test"]);
  });
});
