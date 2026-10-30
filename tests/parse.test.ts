import { describe, expect, it } from "vitest";
import { detectFormat, parseSource } from "@/server/sources/parse";

const enc = (s: string) => new TextEncoder().encode(s);

describe("parseSource", () => {
  it("keeps original line numbers for text and skips blank lines", async () => {
    const segs = await parseSource("S1", enc("Header\n\nEntry 2: fault\r\n  \nEntry 4: test"), "text");
    expect(segs.map((s) => s.locator)).toEqual(["S1:1", "S1:3", "S1:5"]);
    expect(segs[1].text).toBe("Entry 2: fault");
  });

  it("turns CSV rows into labelled segments", async () => {
    const segs = await parseSource("S2", enc("date,message\n2026-03-29,BLEED 1 FAULT\n2026-03-29,cleared\n"), "csv");
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ locator: "S2:R1", text: "date: 2026-03-29 · message: BLEED 1 FAULT" });
  });

  it("rejects an empty record", async () => {
    await expect(parseSource("S1", enc("\n\n"), "text")).rejects.toThrow(/empty/);
  });

  it("detects formats from name and type", () => {
    expect(detectFormat("a.PDF", "application/octet-stream")).toBe("pdf");
    expect(detectFormat("log.csv", "")).toBe("csv");
    expect(detectFormat("notes.txt", "text/plain")).toBe("text");
  });
});
