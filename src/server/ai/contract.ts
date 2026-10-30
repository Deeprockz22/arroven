/**
 * The contract between the workspace and ARROVEN's self-hosted model service.
 *
 * The workspace POSTs `{ contract, task, input }` to `${MODEL_SERVICE_URL}/v1/<task>` and expects
 * `{ model, output }` back, where `output` follows the JSON schema for that task below. Every output is
 * treated as untrusted and validated in `validate.ts`: a statement citing a locator that does not exist,
 * or a link to a statement that does not exist, is dropped and counted. See docs/model-service-contract.md.
 */
export const CONTRACT_VERSION = "2026-10-30";

export type ModelTask = "chronology" | "evidence" | "analysis";

export const CHRONOLOGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["statements", "flags"],
  properties: {
    statements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["locator", "event_date", "kind", "text", "conditions", "uncertain", "uncertain_note"],
        properties: {
          locator: { type: "string" },
          event_date: { type: "string" },
          kind: { type: "string", enum: ["report", "action_performed", "action_planned", "test_result", "shop_result", "message_log", "engineering_note", "other"] },
          text: { type: "string" },
          conditions: { type: "string" },
          uncertain: { type: "boolean" },
          uncertain_note: { type: "string" },
        },
      },
    },
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "text", "refs"],
        properties: {
          type: { type: "string", enum: ["conflict", "gap"] },
          text: { type: "string" },
          refs: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export const EVIDENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["links", "missing_evidence"],
  properties: {
    links: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "relation", "rationale", "caveat"],
        properties: {
          statement: { type: "string" },
          relation: { type: "string", enum: ["supports", "challenges", "inconclusive"] },
          rationale: { type: "string" },
          caveat: { type: "string" },
        },
      },
    },
    missing_evidence: { type: "array", items: { type: "string" } },
  },
} as const;

export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["comparisons", "explanations", "questions"],
  properties: {
    comparisons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "finding", "note", "statements"],
        properties: {
          title: { type: "string" },
          finding: { type: "string", enum: ["agree", "differ", "cannot_compare"] },
          note: { type: "string" },
          statements: { type: "array", items: { type: "string" } },
        },
      },
    },
    explanations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "text", "basis", "uncertainty"],
        properties: { title: { type: "string" }, text: { type: "string" }, basis: { type: "array", items: { type: "string" } }, uncertainty: { type: "string" } },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "basis"],
        properties: { text: { type: "string" }, basis: { type: "array", items: { type: "string" } } },
      },
    },
  },
} as const;

export const OUTPUT_SCHEMAS: Record<ModelTask, Record<string, unknown>> = {
  chronology: CHRONOLOGY_SCHEMA,
  evidence: EVIDENCE_SCHEMA,
  analysis: ANALYSIS_SCHEMA,
};
