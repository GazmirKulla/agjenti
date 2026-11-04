/** Real model with synthetic tenant context; no database writes or external actions. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ load: vi.fn(), prepare: vi.fn(), assess: vi.fn(), calls: [] as unknown[] }));
vi.mock("openai", async original => {
  const actual = await original<typeof import("openai")>();
  return { ...actual, default: new Proxy(actual.default, { construct(Target, args) {
    const client = Reflect.construct(Target, args);
    client.responses.create = new Proxy(client.responses.create.bind(client.responses), { async apply(target, receiver, args) {
      const response = await Reflect.apply(target, receiver, args) as { output_text: string };
      const input = JSON.parse(args[0].input);
      m.calls.push({ repair: input.data?.workflowRepair, response: JSON.parse(response.output_text) });
      return response;
    } });
    return client;
  } }) };
});
afterEach(() => { if (process.env.WORKFLOW_MODEL_DIAGNOSTICS === "1") console.log(JSON.stringify(m.calls)); });
vi.mock("@/lib/capabilities/assessment", () => ({ assessBusinessCapabilities: m.assess, summarizeCapabilityAssessments: (value: unknown) => value }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
vi.mock("@/lib/business-assistant/workflow-service", async original => ({ ...await original<typeof import("@/lib/business-assistant/workflow-service")>(), loadAssistantWorkflow: m.load, prepareWorkflow: m.prepare }));
import { planRequest, type Access } from "@/lib/business-assistant/service";
import { starterVisualGraph, emptyVisualGraph, validateVisualGraph } from "@/lib/workflows/visual/model";
import { applyWorkflowOperations } from "@/lib/business-assistant/workflow";
import { reviewWorkflowSemantics } from "@/lib/capabilities/workflow-semantics";
const live = it.skipIf(process.env.RUN_SEMANTIC_MODEL !== "1");
const access: Access = { businessId: "synthetic", userId: "synthetic-owner", modules: ["workflows"], catalogSource: "internal" };
beforeEach(() => {
  vi.clearAllMocks(); m.calls.length = 0;
  m.load.mockResolvedValue({ workspace: { graph: starterVisualGraph(), revision: 7, generated: false, available: true, enabled: false, publishedVersionId: null }, published: null });
  m.prepare.mockResolvedValue({ message: "Synthetic preview only" });
  m.assess.mockResolvedValue(["knowledge.answer", "staff.handoff"].map(capabilityKey => ({ capabilityKey, status: "ready", missingRequirements: [], reasonCode: "configured" })));
});
live.each([
  "Në workflow duhet të hiqen pjesët e porosive apo produkteve pasi ne nuk kemi produkte. Ruaj pjesët e tjera.",
  "We do not sell products. Remove the entire ordering process and keep information and support.",
])("prepares a valid removal from natural description: %s", async request => {
  await planRequest(access, request, [], { page: "workflows", entryPoint: "contextual" });
  expect(m.prepare).toHaveBeenCalledTimes(1);
  const proposal = m.prepare.mock.calls[0][1];
  expect(proposal.action).toBe("workflow_draft");
  const after = applyWorkflowOperations(starterVisualGraph(), proposal.changes[0].value, request);
  expect(validateVisualGraph(after).errors).toEqual([]);
  expect(after.nodes.some(n => n.kind === "product")).toBe(false);
  expect(after.nodes.some(n => n.kind === "knowledge")).toBe(true);
  expect(after.nodes.some(n => n.kind === "handoff")).toBe(true);
});
live("rebuilds the whole workflow without carrying over products", async () => {
  const request = "Rindërtoje të gjithë workflow-n nga zero vetëm me kalim te stafi. Mos mbaj rrjedhat e vjetra. Përgatit propozimin pa e publikuar.";
  await planRequest(access, request, [], { page: "workflows", entryPoint: "contextual" });
  expect(m.prepare).toHaveBeenCalledTimes(1);
  const proposal = m.prepare.mock.calls[0][1];
  expect(proposal.action).toBe("workflow_draft");
  const operations = JSON.parse(proposal.changes[0].value);
  expect(operations[0].op).toBe("reset");
  const after = applyWorkflowOperations(starterVisualGraph(), proposal.changes[0].value, request);
  expect(validateVisualGraph(after).errors).toEqual([]);
  expect(after.nodes.some(n => n.kind === "product" || n.kind === "knowledge")).toBe(false);
});
live("suggests only the described process for a business without a workflow", async () => {
  m.load.mockResolvedValue({ workspace: { graph: emptyVisualGraph(), revision: 0, generated: true, available: true }, published: null });
  const request = "Nuk kemi produkte. Na duhet vetëm kalimi te stafi kur klienti kërkon ndihmë. Më sugjero dhe përgatit një workflow të tillë, pa publikim.";
  await planRequest(access, request, [], { page: "workflows", entryPoint: "contextual" });
  expect(m.prepare).toHaveBeenCalledTimes(1);
  const proposal = m.prepare.mock.calls[0][1];
  expect(proposal.action).toBe("workflow_draft");
  const after = applyWorkflowOperations(emptyVisualGraph(), proposal.changes[0].value, request);
  expect(validateVisualGraph(after).errors).toEqual([]);
  expect(after.nodes.some(n => n.kind === "handoff")).toBe(true);
  expect(after.nodes.some(n => n.kind === "product")).toBe(false);
});
live.each([
  ["Mos kontrollo stokun dhe mos njofto kur rikthehet. Hiqi këto veprime.", []],
  ["Do not schedule messages. Only explain our opening hours.", []],
  ["Préviens le client quand le produit redevient disponible.", ["back_in_stock.notify"]],
])("reviews semantic capability claims: %s", async (request, expected) => {
  const review = await reviewWorkflowSemantics(request);
  for (const key of expected) expect(review.capabilityKeys).toContain(key);
  if (!expected.length) expect(review.capabilityKeys.filter(key => ["inventory.check", "back_in_stock.notify", "schedule.trigger"].includes(key))).toEqual([]);
});

live.each([
  ["Ndrysho workflow-n që të përdorë emailin ekzistues dhe ruaje draftin.", "Ruaj draftin e ndryshuar", "authoring"],
  ["Update the workflow to reuse the existing email and save the draft.", "Save the edited workflow", "authoring"],
  ["The customer-facing workflow must save a new workflow for every customer.", "Save a new workflow during each customer conversation", "runtime"],
])("distinguishes authoring from runtime without a capability-name blacklist: %s", async (request, description, scope) => {
  const result = await reviewWorkflowSemantics(request, undefined, [{ description, capabilityKeys: ["workflow.save"] }]);
  if (scope === "authoring") {
    expect(result.authoringBehaviorIndexes).toEqual([0]);
    expect(result.capabilityKeys).not.toContain("workflow.save");
  } else {
    expect(result.authoringBehaviorIndexes).toEqual([]);
  }
});
