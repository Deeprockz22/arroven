export interface ChronologyInput {
  case: { ref: string; aircraft: string; system: string; question: string; evidenceCutoff: string | null };
  sources: { code: string; title: string; custodian: string; segments: { locator: string; text: string }[] }[];
  unavailable: { code: string; title: string; reason: string }[];
}

export interface EvidenceInput {
  case: { ref: string; aircraft: string; system: string; question: string };
  hypothesis: { code: string; title: string; text: string };
  others: { code: string; title: string; text: string }[];
  statements: { code: string; eventDate: string | null; kind: string; locator: string; text: string; conditions: string; uncertain: boolean; uncertainNote: string }[];
}

export interface AnalysisInput {
  case: { ref: string; aircraft: string; system: string; question: string };
  statements: EvidenceInput["statements"];
  explanations: { code: string; title: string; text: string; assessment: string }[];
  openQuestions: string[];
}

export interface AiResult {
  data: unknown;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface AiProvider {
  name: "model-service" | "mock";
  model: string;
  chronology(input: ChronologyInput): Promise<AiResult>;
  evidence(input: EvidenceInput): Promise<AiResult>;
  analysis(input: AnalysisInput): Promise<AiResult>;
}

/** A failure whose message is safe to show the engineer. */
export class AiError extends Error {}
