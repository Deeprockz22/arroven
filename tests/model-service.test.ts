import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ModelServiceProvider, getProvider } from "@/server/ai/provider";
import { CONTRACT_VERSION } from "@/server/ai/contract";

/** A stand-in for ARROVEN's model service: records what it receives and answers per path. */
let server: http.Server;
let base: string;
const seen: { path: string; auth?: string; contract?: string; body: { contract: string; task: string; input: unknown } }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", auth: req.headers.authorization, contract: req.headers["x-arroven-contract"] as string, body: JSON.parse(raw || "{}") });
      if (req.headers.authorization !== "Bearer good-token") { res.writeHead(401).end(); return; }
      if (req.url === "/v1/chronology") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          model: "arroven-extract-0.1.0",
          output: { statements: [{ locator: "S1:2", event_date: "2026-03-02", kind: "report", text: "Fault in cruise", conditions: "", uncertain: false, uncertain_note: "" }], flags: [] },
        }));
      } else if (req.url === "/v1/evidence") {
        res.writeHead(200, { "content-type": "text/plain" }).end("not json");
      } else if (req.url === "/v1/analysis") {
        res.writeHead(503).end();
      } else res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const chronInput = { case: { ref: "CASE-1", aircraft: "ZZ-TST", system: "ATA 36", question: "Why?", evidenceCutoff: null }, sources: [{ code: "S1", title: "Log", custodian: "", segments: [{ locator: "S1:2", text: "Fault in cruise" }] }], unavailable: [] };

describe("model service connector", () => {
  it("posts the contract envelope with credentials and returns the service's model version", async () => {
    const p = new ModelServiceProvider(base, "good-token", "arroven-model");
    const r = await p.chronology(chronInput);
    expect(r.model).toBe("arroven-extract-0.1.0");
    expect((r.data as { statements: unknown[] }).statements).toHaveLength(1);
    const last = seen.at(-1)!;
    expect(last).toMatchObject({ path: "/v1/chronology", auth: "Bearer good-token", contract: CONTRACT_VERSION });
    expect(last.body).toMatchObject({ contract: CONTRACT_VERSION, task: "chronology" });
  });

  it("turns failures into messages an engineer can act on", async () => {
    await expect(new ModelServiceProvider(base, "wrong", "m").chronology(chronInput)).rejects.toThrow(/MODEL_SERVICE_TOKEN/);
    const p = new ModelServiceProvider(base, "good-token", "m");
    await expect(p.evidence({ case: chronInput.case, hypothesis: { code: "H1", title: "t", text: "x" }, others: [], statements: [] })).rejects.toThrow(/could not be read/);
    await expect(p.analysis({ case: chronInput.case, statements: [], explanations: [], openQuestions: [] })).rejects.toThrow(/busy/);
  });

  it("reports an unreachable service without leaking details", async () => {
    await expect(new ModelServiceProvider("http://127.0.0.1:9", "t", "m").chronology(chronInput)).rejects.toThrow(/could not be reached/);
  });

  it("chooses the model service only when configured, and never a third-party provider", () => {
    const keep = { url: process.env.MODEL_SERVICE_URL, p: process.env.AI_PROVIDER };
    delete process.env.AI_PROVIDER;
    delete process.env.MODEL_SERVICE_URL;
    expect(getProvider().name).toBe("mock");
    process.env.MODEL_SERVICE_URL = base;
    expect(getProvider().name).toBe("model-service");
    process.env.AI_PROVIDER = "anthropic";
    expect(getProvider().name).toBe("mock");
    if (keep.url === undefined) delete process.env.MODEL_SERVICE_URL; else process.env.MODEL_SERVICE_URL = keep.url;
    if (keep.p === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = keep.p;
  });
});
