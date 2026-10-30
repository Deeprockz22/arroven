import { CONTRACT_VERSION, type ModelTask } from "./contract";
import { AiError, type AiProvider, type AiResult, type AnalysisInput, type ChronologyInput, type EvidenceInput } from "./types";

/* ---------- ARROVEN's self-hosted model service ---------- */

const TIMEOUT_MS = Number(process.env.MODEL_SERVICE_TIMEOUT_MS ?? 10 * 60 * 1000);

/**
 * Calls ARROVEN's own models over HTTP. Partner data goes only to this service, which runs in ARROVEN's
 * hosting (agreement clause 6.2). The response is validated by the caller; nothing it says is trusted.
 */
export class ModelServiceProvider implements AiProvider {
  name = "model-service" as const;
  constructor(private baseUrl: string, private token: string | undefined, public model: string) {}

  chronology(input: ChronologyInput) {
    return this.call("chronology", input);
  }

  evidence(input: EvidenceInput) {
    return this.call("evidence", input);
  }

  analysis(input: AnalysisInput) {
    return this.call("analysis", input);
  }

  private endpoint(task: ModelTask): string {
    let url: URL;
    try {
      url = new URL(`v1/${task}`, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    } catch {
      throw new AiError("The model service address is not a valid URL. An administrator needs to fix MODEL_SERVICE_URL.");
    }
    const plainAllowed = process.env.NODE_ENV !== "production" || process.env.MODEL_SERVICE_ALLOW_HTTP === "true";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && plainAllowed))
      throw new AiError("The model service must be reached over HTTPS. An administrator needs to fix MODEL_SERVICE_URL.");
    return url.toString();
  }

  private async call(task: ModelTask, input: unknown): Promise<AiResult> {
    const url = this.endpoint(task);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-arroven-contract": CONTRACT_VERSION,
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ contract: CONTRACT_VERSION, task, input }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError"))
        throw new AiError("The model service did not answer in time. Nothing was changed. Try again, or split the case's sources.");
      throw new AiError("The model service could not be reached. Nothing was changed. Try again.");
    }
    if (res.status === 401 || res.status === 403) throw new AiError("The model service rejected the workspace's credentials. An administrator needs to update MODEL_SERVICE_TOKEN.");
    if (res.status === 413) throw new AiError("The case is too large for the model service in one pass. Split the case's sources and try again.");
    if (res.status === 429 || res.status === 503) throw new AiError("The model service is busy. Try again in a minute.");
    if (!res.ok) throw new AiError(`The model service returned an error (${res.status}). Nothing was changed. Try again.`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AiError("The model service's reply could not be read. Nothing was changed.");
    }
    const b = body as { model?: unknown; output?: unknown };
    if (!b || typeof b !== "object" || b.output === undefined) throw new AiError("The model service's reply had no output. Nothing was changed.");
    return { data: b.output, model: typeof b.model === "string" && b.model.trim() ? b.model.trim().slice(0, 100) : this.model, inputTokens: 0, outputTokens: 0 };
  }
}

/* ---------- Mock: deterministic, offline, clearly labelled ---------- */

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

export function guessDate(text: string): string {
  const m = text.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTHS[m[2].toUpperCase().slice(0, 3)]}-${m[1].padStart(2, "0")}`;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return iso ? iso[0] : "";
}

export function guessKind(text: string): string {
  const t = text.toLowerCase();
  if (/not performed|deferred|planned|carried forward|re-deferred|not yet scheduled/.test(t)) return "action_planned";
  if (/shop|no fault found|nff|bench|cold-soak|returned to/.test(t)) return "shop_result";
  if (/test|satisfactory|bite|ops check|ground run/.test(t)) return "test_result";
  if (/removed|installed|replaced|completed/.test(t)) return "action_performed";
  if (/^\d{1,2}:\d{2}/.test(t)) return "message_log";
  if (/suspect|recommend|engineering note/.test(t)) return "engineering_note";
  if (/crew|fault|ecam|reported|recurred/.test(t)) return "report";
  return "other";
}

class MockProvider implements AiProvider {
  name = "mock" as const;
  model = "mock-drafter";

  async chronology(input: ChronologyInput): Promise<AiResult> {
    await new Promise((r) => setTimeout(r, 800));
    const statements = input.sources.flatMap((s) =>
      s.segments
        .filter((g, i) => !(i === 0 && /page|work order|report|log|note/i.test(g.text) && g.text.length < 120))
        .map((g) => ({ locator: g.locator, event_date: guessDate(g.text), kind: guessKind(g.text), text: g.text, conditions: "", uncertain: false, uncertain_note: "" })),
    );
    const flags = input.unavailable.map((u) => ({ type: "gap", text: `${u.title} is unavailable: ${u.reason}`, refs: [u.code] }));
    return { data: { statements, flags }, inputTokens: 0, outputTokens: 0, model: this.model };
  }

  async evidence(input: EvidenceInput): Promise<AiResult> {
    await new Promise((r) => setTimeout(r, 600));
    const words = new Set(input.hypothesis.text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
    const links = input.statements
      .map((s) => ({ s, shared: [...new Set(s.text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])].filter((w) => words.has(w)) }))
      .filter((x) => x.shared.length > 0)
      .slice(0, 8)
      .map(({ s, shared }) => ({ statement: s.code, relation: "inconclusive", rationale: `Mock suggestion: shares the terms ${shared.slice(0, 3).join(", ")}. Judge its meaning yourself.`, caveat: "" }));
    return { data: { links, missing_evidence: [] }, inputTokens: 0, outputTokens: 0, model: this.model };
  }

  /** Mechanical stand-in: pairs ground or shop tests with in-flight reports and asks about unperformed work. */
  async analysis(input: AnalysisInput): Promise<AiResult> {
    await new Promise((r) => setTimeout(r, 700));
    const reports = input.statements.filter((s) => s.kind === "report");
    const tests = input.statements.filter((s) => s.kind === "test_result" || s.kind === "shop_result");
    const comparisons = reports.length && tests.length ? [{
      title: "Test conditions against reported conditions (mock)",
      finding: "cannot_compare",
      note: "Mock comparison: these statements describe reports and tests. Check whether the test conditions match the conditions of the reports.",
      statements: [...reports.slice(0, 2), ...tests.slice(0, 2)].map((s) => s.code),
    }] : [];
    const questions = input.statements.filter((s) => s.kind === "action_planned").slice(0, 3)
      .map((s) => ({ text: `Mock question: has the planned work in ${s.code} been performed, and what did it find?`, basis: [s.code] }));
    return { data: { comparisons, explanations: [], questions }, inputTokens: 0, outputTokens: 0, model: this.model };
  }
}

/**
 * `model-service` when MODEL_SERVICE_URL is set (or AI_PROVIDER=model-service), otherwise the offline mock.
 * There is deliberately no third-party AI provider: partner data never leaves ARROVEN's hosting.
 */
export function getProvider(): AiProvider {
  const url = process.env.MODEL_SERVICE_URL?.trim();
  const choice = process.env.AI_PROVIDER ?? (url ? "model-service" : "mock");
  if (choice === "model-service" && url) return new ModelServiceProvider(url, process.env.MODEL_SERVICE_TOKEN || undefined, process.env.MODEL_SERVICE_NAME || "arroven-model");
  return new MockProvider();
}
