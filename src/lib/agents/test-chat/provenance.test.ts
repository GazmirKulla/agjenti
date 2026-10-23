import { expect, it } from "vitest";
import { collectTestConfiguration } from "./provenance";
import { configurationRead, instructionHash } from "../configuration";
const debug = { source: "ai" as const, fallbackReason: null, model: "test", agentConfigured: true, knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 };
it("projects only runtime reads, never private prompts, into diagnostics", () => {
  const p = collectTestConfiguration();
  p.onTrace({ stage: "context", label: "Customer agent configuration loaded", data: { agentConfiguration: {
    ...configurationRead({ id: "actual-active", name: "Actual", is_active: true, instructions: "Private instructions" }),
    secret: "credential", instructions: "Private instructions",
  } } });
  p.onTrace({ stage: "ai", label: "AI request sent", data: { request: { instructions: "Private instructions", secret: "credential" } } });
  const result = p.finish({ debug });
  expect(result.agents[0]).toMatchObject({ agentId: "actual-active", generationRequested: true, fallbackInstructionsUsed: false, instructionHash: instructionHash("Private instructions") });
  expect(JSON.stringify(result)).not.toMatch(/Private instructions|credential/);
  expect(result.behaviorVerified).toBe(false);
});
it("reports base instructions only on a generation request, never certifies provider failure", () => {
  const p = collectTestConfiguration();
  p.onTrace({ stage: "context", label: "Customer agent configuration loaded", data: { agentConfiguration: configurationRead(null) } });
  expect(p.finish({ debug }).agents[0].fallbackInstructionsUsed).toBeNull();
  p.onTrace({ stage: "ai", label: "AI request sent" });
  p.onTrace({ stage: "ai", label: "AI provider failed; workflow fallback used", status: "error" });
  expect(p.finish({ debug: { ...debug, source: "fallback", fallbackReason: "provider_error" } })).toMatchObject({
    agents: [{ agentId: null, fallbackInstructionsUsed: true }], behaviorVerified: false, responseFallbackReason: "provider_error",
  });
});
it.each(["draft", "published", "pinned"] as const)("uses executed workflow evidence for %s, never a current pointer lookup", mode => {
  const p = collectTestConfiguration(mode === "draft" ? "preview:A" : undefined);
  p.onTrace({ stage: "workflow", label: "Visual workflow executed", data: { versionId: "A", workflowSource: mode } });
  expect(p.finish({ debug }).workflow).toEqual({ id: null, versionId: "A", mode });
});
it("keeps unavailable metadata explicit and isolates composed/concurrent reads", () => {
  const a = collectTestConfiguration(), b = collectTestConfiguration();
  for (const id of ["first", "second"]) a.onTrace({ stage: "context", label: "Customer agent configuration loaded", data: { agentConfiguration: configurationRead({ id, instructions: id, is_active: true }) } });
  expect(a.finish({ debug }).agents.map(a => a.agentId)).toEqual(["first", "second"]);
  expect(b.finish({ debug })).toMatchObject({ agents: [], workflow: { mode: "unavailable", versionId: null }, behaviorVerified: false });
});
