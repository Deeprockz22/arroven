import { z } from "zod";
import type { StatementKind } from "../db/schema";
import { STATEMENT_KINDS } from "../db/schema";

/*
 * Model output is untrusted. Every statement must cite a locator that exists in this case, and every
 * evidence link must name a statement that exists and has been checked. Anything else is dropped and counted.
 */

const rawStatement = z.object({
  locator: z.string(),
  event_date: z.string().optional().default(""),
  kind: z.string().optional().default("other"),
  text: z.string(),
  conditions: z.string().optional().default(""),
  uncertain: z.boolean().optional().default(false),
  uncertain_note: z.string().optional().default(""),
});
const rawFlag = z.object({ type: z.string(), text: z.string(), refs: z.array(z.string()).optional().default([]) });

export interface DraftStatement {
  locator: string;
  eventDate: string | null;
  kind: StatementKind;
  text: string;
  conditions: string;
  uncertain: boolean;
  uncertainNote: string;
}
export interface DraftFlag {
  type: "conflict" | "gap";
  text: string;
  refs: string[];
}

const cleanLoc = (s: string) => s.replace(/[[\]\s]/g, "");
const clip = (s: string, n: number) => s.trim().slice(0, n);

export function acceptChronology(raw: unknown, locators: Set<string>, unavailableCodes: Set<string>) {
  const obj = (raw ?? {}) as { statements?: unknown; flags?: unknown };
  if (!Array.isArray(obj.statements)) throw new Error("Draft did not contain a statements list");
  let dropped = 0;
  const statements: DraftStatement[] = [];
  for (const item of obj.statements) {
    const p = rawStatement.safeParse(item);
    const loc = p.success ? cleanLoc(p.data.locator) : "";
    if (!p.success || !locators.has(loc) || !p.data.text.trim()) { dropped++; continue; }
    statements.push({
      locator: loc,
      eventDate: /^\d{4}-\d{2}-\d{2}$/.test(p.data.event_date) ? p.data.event_date : null,
      kind: (STATEMENT_KINDS as readonly string[]).includes(p.data.kind) ? (p.data.kind as StatementKind) : "other",
      text: clip(p.data.text, 1000),
      conditions: clip(p.data.conditions, 300),
      uncertain: p.data.uncertain,
      uncertainNote: p.data.uncertain ? clip(p.data.uncertain_note, 500) : "",
    });
  }
  const flags: DraftFlag[] = [];
  for (const item of Array.isArray(obj.flags) ? obj.flags : []) {
    const p = rawFlag.safeParse(item);
    if (!p.success || !p.data.text.trim()) continue;
    flags.push({
      type: p.data.type === "conflict" ? "conflict" : "gap",
      text: clip(p.data.text, 800),
      refs: [...new Set(p.data.refs.map(cleanLoc))].filter((r) => locators.has(r) || unavailableCodes.has(r)).slice(0, 12),
    });
  }
  return { statements, flags, dropped };
}

const rawLink = z.object({
  statement: z.string(),
  relation: z.enum(["supports", "challenges", "inconclusive"]),
  rationale: z.string(),
  caveat: z.string().optional().default(""),
});

export function acceptEvidence(raw: unknown, statementCodes: Set<string>) {
  const obj = (raw ?? {}) as { links?: unknown; missing_evidence?: unknown };
  if (!Array.isArray(obj.links)) throw new Error("Suggestions did not contain a links list");
  let dropped = 0;
  const seen = new Set<string>();
  const links: { statement: string; relation: "supports" | "challenges" | "inconclusive"; rationale: string; caveat: string }[] = [];
  for (const item of obj.links) {
    const p = rawLink.safeParse(item);
    const code = p.success ? p.data.statement.trim().toUpperCase() : "";
    if (!p.success || !statementCodes.has(code) || seen.has(code) || !p.data.rationale.trim()) { dropped++; continue; }
    seen.add(code);
    links.push({ statement: code, relation: p.data.relation, rationale: clip(p.data.rationale, 600), caveat: clip(p.data.caveat, 400) });
  }
  const gaps = (Array.isArray(obj.missing_evidence) ? obj.missing_evidence : [])
    .filter((g): g is string => typeof g === "string" && g.trim().length > 0)
    .map((g) => clip(g, 400))
    .slice(0, 4);
  return { links, gaps, dropped };
}

const codes = (xs: unknown, valid: Set<string>) =>
  [...new Set((Array.isArray(xs) ? xs : []).map((x) => String(x).trim().toUpperCase()))].filter((c) => valid.has(c));

/** Comparisons need two real statements; explanations need a real basis. Anything else is dropped and counted. */
export function acceptAnalysis(raw: unknown, statementCodes: Set<string>) {
  const obj = (raw ?? {}) as { comparisons?: unknown; explanations?: unknown; questions?: unknown };
  if (!Array.isArray(obj.comparisons) || !Array.isArray(obj.explanations) || !Array.isArray(obj.questions)) throw new Error("Analysis did not contain the expected lists");
  let dropped = 0;
  const comparisons: { title: string; finding: "agree" | "differ" | "cannot_compare"; note: string; statements: string[] }[] = [];
  for (const c of obj.comparisons as Record<string, unknown>[]) {
    const st = codes(c?.statements, statementCodes);
    const finding = c?.finding === "agree" || c?.finding === "differ" || c?.finding === "cannot_compare" ? c.finding : null;
    if (!finding || st.length < 2 || !String(c?.title ?? "").trim() || !String(c?.note ?? "").trim()) { dropped++; continue; }
    comparisons.push({ title: clip(String(c.title), 200), finding, note: clip(String(c.note), 800), statements: st });
  }
  const explanations: { title: string; text: string; basis: string[]; uncertainty: string }[] = [];
  for (const e of (obj.explanations as Record<string, unknown>[]).slice(0, 5)) {
    const basis = codes(e?.basis, statementCodes);
    if (!basis.length || String(e?.title ?? "").trim().length < 3 || String(e?.text ?? "").trim().length < 10) { dropped++; continue; }
    explanations.push({ title: clip(String(e.title), 120), text: clip(String(e.text), 1500), basis, uncertainty: clip(String(e?.uncertainty ?? ""), 600) });
  }
  const questions: { text: string; basis: string[] }[] = [];
  for (const q of (obj.questions as Record<string, unknown>[]).slice(0, 8)) {
    if (String(q?.text ?? "").trim().length < 5) { dropped++; continue; }
    questions.push({ text: clip(String(q.text), 600), basis: codes(q?.basis, statementCodes) });
  }
  return { comparisons, explanations, questions, dropped };
}
