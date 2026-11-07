import { beforeEach, expect, it, vi } from "vitest";
import { initialSnapshot } from "./contracts";
import { processTrainingContext } from "./training-context";
import { linearProcessVersion } from "./linear-definition";
import { digest } from "./definition";
import type { TrainingMemory } from "@/lib/agents/training/model";
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/agents/training/load", () => ({ loadActiveTrainingMemories: load }));
vi.mock("@/lib/catalogs/source-ranking", () => ({ rankKnowledge: async () => [] }));
function memory(id: string, scope: Partial<TrainingMemory> = {}): TrainingMemory {
  return { id, business_id: "business", kind: "workflow", instruction: id, customer_message: "", desired_response: "", workflow_id: null,
    step_key: null, is_active: true, revision: 1, updated_at: "2026-11-07", ...scope };
}
beforeEach(() => { load.mockReset(); });
it("includes global rules and only the pinned linear workflow's current authored step", async () => {
  const version = linearProcessVersion({ id: "v", businessId: "business", workflowId: "workflow", name: "Order", productIds: [], steps: [{ key: "delivery", kind: "customer" }] });
  const state = initialSnapshot("business", "conversation", "test");
  state.focusId = "instance";
  state.instances.instance = { id: "instance", definitionId: "linear_workflow", versionId: "v", stepId: `linear_${digest("delivery").slice(0, 20)}_2`, status: "waiting_input", facts: {} };
  load.mockResolvedValue([memory("global", { kind: "style" }), memory("current", { workflow_id: "workflow", step_key: "delivery" }),
    memory("wrong-step", { workflow_id: "workflow", step_key: "size" }), memory("wrong-workflow", { workflow_id: "another" }),
    memory("visual", { visual_flow_id: "visual" })]);
  const result = await processTrainingContext(state, new Map([[version.id, version]]), "My address");
  expect(result.rules.map(r => r.id)).toEqual(["current", "global"]);
  expect(load).toHaveBeenCalledWith("business");
});
it("does not apply workflow-specific training to an informational conversation", async () => {
  load.mockResolvedValue([memory("global", { kind: "style" }), memory("scoped", { workflow_id: "workflow" }), memory("visual", { visual_flow_id: "visual" })]);
  expect((await processTrainingContext(initialSnapshot("business", "conversation", "test"), new Map(), "Explain")).rules.map(r => r.id)).toEqual(["global"]);
});
