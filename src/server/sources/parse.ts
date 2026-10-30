import Papa from "papaparse";
import { AppError } from "../errors";

export interface ParsedSegment {
  locator: string;
  ordinal: number;
  text: string;
}

/** What intake extracted. A received file is not proof that all of it was processed. */
export interface ProcessingReport {
  lines: number;
  pages?: number;
  emptyPages?: number[];
  truncated?: number;
}

const MAX_SEGMENTS = 5000;
const MAX_SEGMENT_CHARS = 2000;

export type SourceFormat = "pdf" | "csv" | "text";

export function detectFormat(fileName: string, mimeType: string): SourceFormat {
  const name = fileName.toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mimeType === "text/csv" || name.endsWith(".csv")) return "csv";
  return "text";
}

/**
 * Split an original record into citable segments. Locators are stable and human-readable:
 *   text  S1:12      (original line number; blank lines keep their numbers but are not segments)
 *   csv   S2:R7      (data row 7, header excluded)
 *   pdf   S3:p2.14   (page 2, 14th non-empty line on that page)
 */
export async function parseSource(code: string, bytes: Uint8Array, format: SourceFormat): Promise<ParsedSegment[]> {
  return (await parseSourceWithReport(code, bytes, format)).segments;
}

export async function parseSourceWithReport(code: string, bytes: Uint8Array, format: SourceFormat): Promise<{ segments: ParsedSegment[]; report: ProcessingReport }> {
  const out: ParsedSegment[] = [];
  const report: ProcessingReport = { lines: 0 };
  let truncated = 0;
  const push = (locator: string, text: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return;
    if (out.length >= MAX_SEGMENTS) throw new AppError("invalid", `This record has more than ${MAX_SEGMENTS} lines. Split it into smaller sources.`);
    if (t.length > MAX_SEGMENT_CHARS) truncated++;
    out.push({ locator, ordinal: out.length + 1, text: t.slice(0, MAX_SEGMENT_CHARS) });
  };
  const done = () => {
    report.lines = out.length;
    if (truncated) report.truncated = truncated;
    return { segments: out, report };
  };

  if (format === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    let pages: string[];
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      pages = (await extractText(pdf, { mergePages: false })).text;
    } catch {
      throw new AppError("invalid", "This PDF could not be read. Check that it is not encrypted or damaged.");
    }
    report.pages = pages.length;
    const empty: number[] = [];
    pages.forEach((page, p) => {
      let n = 0;
      for (const line of page.split(/\r?\n/)) if (line.trim()) push(`${code}:p${p + 1}.${++n}`, line);
      if (!n) empty.push(p + 1);
    });
    if (!out.length) throw new AppError("invalid", "This PDF has no text layer. Scanned records need OCR, which is not enabled for this workspace yet. Upload a text export or paste the text.");
    if (empty.length) report.emptyPages = empty;
    return done();
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^﻿/, "");

  if (format === "csv") {
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy" });
    const fields = parsed.meta.fields ?? [];
    if (!fields.length) throw new AppError("invalid", "The CSV file needs a header row.");
    parsed.data.forEach((row, i) => push(`${code}:R${i + 1}`, fields.map((f) => `${f}: ${row[f] ?? ""}`).join(" · ")));
    if (!out.length) throw new AppError("invalid", "The CSV file has no data rows.");
    return done();
  }

  text.split(/\r?\n/).forEach((line, i) => push(`${code}:${i + 1}`, line));
  if (!out.length) throw new AppError("invalid", "The record is empty.");
  return done();
}
