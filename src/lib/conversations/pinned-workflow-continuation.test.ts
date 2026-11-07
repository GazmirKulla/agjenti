import { beforeEach, expect, it, vi } from "vitest";
import { processConversationMessage } from "./process-conversation-message";
import type { ConversationStatePayload } from "@/lib/workflows/state";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import type { CustomerCommand, Snapshot } from "@/lib/orchestration/contracts";
const { load, pinned, interpret, compose, modules } = vi.hoisted(() => ({ load: vi.fn(), pinned: vi.fn(), interpret: vi.fn(), compose: vi.fn(), modules: vi.fn() }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: load }));
vi.mock("@/lib/orchestration/version-store", async original => ({ ...await original<object>(), loadProcessVersion: pinned, loadCurrentLinearVersions: async () => [] }));
vi.mock("@/lib/orchestration/interpret", () => ({ interpretCustomer: interpret }));
vi.mock("@/lib/orchestration/respond", () => ({ composeProcessReply: compose }));
vi.mock("@/lib/orchestration/training-context", () => ({ processTrainingContext: async () => ({ rules: [] }) }));
vi.mock("@/lib/discovery/load-process", () => ({ loadBusinessProcess: async () => ({ process: null }) }));
vi.mock("@/lib/catalogs/retrieval", () => ({ retrieveBusinessSources: async () => null }));
vi.mock("@/lib/capabilities/enforcement", async original => ({ ...await original<object>(), runtimeModules: modules }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) }; return { from: () => chain };
} }));
vi.mock("@/lib/agents/business-grounding", () => ({ readBusinessGrounding: async () => ({
  knowledge: { status: "no_match", records: [] }, products: { status: "unavailable", records: [] }, services: { status: "unavailable", records: [] },
}) }));
function version(id: string): VisualVersion {
  return { id, businessId: "business", createdAt: "today", graph: { version: 2, name: id,
    flows: [{ id: "request", label: "Request", kind: "custom", entryNodeId: "detail", nodeIds: ["detail", "review"] }],
    nodes: [
      { id: "start", kind: "start", label: "Start", config: {}, position: { x: 0, y: 0 } },
      { id: "detail", kind: "collect", label: id, config: { fieldKey: `detail_${id}`, prompt: "Details?" }, position: { x: 0, y: 0 } },
      { id: "review", kind: "confirm", label: "Review", config: { prompt: "Confirm?" }, position: { x: 0, y: 0 } },
      { id: "done", kind: "end", label: "Done", config: {}, position: { x: 0, y: 0 } },
    ], edges: [{ id: "s", source: "start", target: "done", port: "next" }, { id: "d", source: "detail", target: "review", port: "next" },
      { id: "y", source: "review", target: "done", port: "yes" }, { id: "n", source: "review", target: "detail", port: "no" }] } };
}
beforeEach(() => {
  vi.clearAllMocks(); interpret.mockReset(); load.mockResolvedValue(version("v1")); pinned.mockResolvedValue(version("v1")); modules.mockResolvedValue(null);
  compose.mockImplementation(async ({ notices }) => ({ reply: "Question", targetIds: notices.flatMap((n: { targetId?: string }) => n.targetId ? [n.targetId] : []), responseId: "test", inputTokens: 0, outputTokens: 0 }));
});
async function turn(message: string, commands: (state: Snapshot) => CustomerCommand[], state?: ConversationStatePayload) {
  interpret.mockImplementationOnce(async ({ state }) => ({ observation: { revision: state.revision, commands: commands(state), needsClarification: false }, model: "fixture", responseId: "test", inputTokens: 0, outputTokens: 0 }));
  return processConversationMessage({ businessId: "business", message, hasPhoto: false, mode: "test", state });
}
const start = () => turn("Start", () => [{ kind: "start", definitionId: "request", versionId: "v1", evidence: "Start", initialFacts: [] }]);
it("continues the immutable version after publishing a graph with different fields", async () => {
  const first = await start(), before = structuredClone(first.nextState);
  load.mockResolvedValue(version("v2"));
  const next = await turn("Detail", state => [{ kind: "facts", instanceId: state.focusId!, values: [{ fieldId: "detail_v1", value: "Detail", evidence: "Detail" }] }], first.nextState);
  expect(pinned).toHaveBeenCalledWith("business", "v1");
  const instance = next.nextState.runtime!.instances[next.nextState.runtime!.focusId!];
  expect(instance).toMatchObject({ versionId: "v1", status: "waiting_approval", facts: { detail_v1: { value: "Detail" } } });
  expect(instance.facts.detail_v2).toBeUndefined();
  expect(first.nextState).toEqual(before);
});
it("preserves progress and its version across an informational detour", async () => {
  const first = await start(), id = first.nextState.runtime!.focusId!;
  load.mockResolvedValue(version("v2"));
  const answer = await turn("What does this service include?", () => [], first.nextState);
  expect(answer.nextState.runtime!.instances[id]).toEqual(first.nextState.runtime!.instances[id]);
});
it("fails closed when the pinned version is missing instead of switching to the latest", async () => {
  const first = await start(); load.mockResolvedValue(version("v2")); pinned.mockResolvedValue(null); interpret.mockClear();
  await expect(turn("Detail", () => [], first.nextState)).rejects.toThrow("definition_unavailable");
  expect(interpret).not.toHaveBeenCalled();
});
it("does not start a new instance using an archived version", async () => {
  const first = await start(); load.mockResolvedValue(version("v2"));
  const result = await turn("Another request", () => [{ kind: "start", definitionId: "request", versionId: "v1", evidence: "Another request", initialFacts: [] }], first.nextState);
  expect(Object.keys(result.nextState.runtime!.instances)).toHaveLength(1);
  expect(compose.mock.lastCall![0].notices).toContainEqual({ kind: "clarify", reason: "process_not_startable" });
});
it("module deactivation preserves the saved process and prevents interpretation", async () => {
  const first = await start(); modules.mockResolvedValue([]); interpret.mockClear();
  await expect(turn("Detail", () => [], first.nextState)).rejects.toMatchObject({ code: "module_disabled" });
  expect(interpret).not.toHaveBeenCalled();
});
