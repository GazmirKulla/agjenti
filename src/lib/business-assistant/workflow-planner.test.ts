import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ response: vi.fn(), load: vi.fn(), prepare: vi.fn(), orderLoad: vi.fn(), orderPrepare: vi.fn(), assess: vi.fn() }));
vi.mock("@/lib/capabilities/assessment", () => ({ assessBusinessCapabilities: m.assess, summarizeCapabilityAssessments: (v: unknown) => v }));
vi.mock("./orderflow-service", () => ({ loadOrderFlows:m.orderLoad, prepareOrderFlow:m.orderPrepare, executeOrderFlow:vi.fn(), refineOrderFlowProposal:vi.fn(), orderFlowInstructions:"orderflow instructions" }));
vi.mock("openai", () => ({ default: class { responses = { create: m.response }; } }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test" }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
vi.mock("./workflow-service", async importOriginal => ({ ...await importOriginal<typeof import("./workflow-service")>(), loadAssistantWorkflow: m.load, prepareWorkflow: m.prepare, executeWorkflow: vi.fn() }));
import { planRequest, type Access } from "./service";
import { starterVisualGraph, upgradeVisualGraph, validateVisualGraph } from "@/lib/workflows/visual/model";
import { applyWorkflowOperations } from "./workflow";
const access: Access = { userId: "user", businessId: "business", modules: ["workflows"], catalogSource: "internal" };
const respond = (action: string, changes: {field:string;value:string}[] = []) => ({ output_text: JSON.stringify({action,id:null,message:"Kontrollo",changes, automation: action === "workflow_draft" ? { requestedBehaviors: [{ description: "Ndrysho rrjedhën", capabilityKeys: [] }], assumptions: [], clarificationQuestions: [] } : null}) });
beforeEach(() => {
  vi.resetAllMocks();
  m.assess.mockResolvedValue([]);
  process.env.OPENAI_API_KEY = "test-only";
  m.load.mockResolvedValue({ workspace: { graph: starterVisualGraph(), revision: 7 }, published: null });
  m.orderLoad.mockResolvedValue({flows:[],products:[],partial:false});
  m.orderPrepare.mockResolvedValue({message:"Kontrollo",token:"sealed"});
  m.prepare.mockResolvedValue({message:"Kontrollo",token:"sealed"});
});
it("reuses a recovered graph only as descriptive input for a fresh proposal", async () => {
  const graph = starterVisualGraph(); graph.name = "Draft i rikthyer";
  m.response.mockResolvedValueOnce(respond("workflow_draft", [{ field: "operations", value: '[{"op":"rename","name":"Propozim i ri"}]' }]));
  await planRequest(access, "Ndrysho emrin", [], { page: "home", entryPoint: "home" }, undefined, [], "Migo", {
    version: 1, request: "Propozim i vjetër", visualDraft: { graph, revision: 7 },
  }, { first: "deferred" });
  expect(JSON.parse(m.response.mock.calls[0][0].input).data.workflow.workspace.graph.name).toBe("Draft i rikthyer");
  expect(JSON.parse(m.response.mock.calls[0][0].input).data.recoveredPlan.planningPreferences).toEqual({ first: "deferred" });
  expect(m.prepare.mock.calls[0][3]).toEqual(graph);
});
it("a recovered draft cannot skip the existing save-before-publication boundary", async () => {
  m.response.mockResolvedValueOnce(respond("workflow_publish"));
  await expect(planRequest(access, "Publiko", [], { page: "home", entryPoint: "home" }, undefined, [], "Migo", {
    version: 1, request: "Draft", visualDraft: { graph: starterVisualGraph(), revision: 7 },
  })).rejects.toThrow("Ruaj propozimin si draft");
  expect(m.prepare).not.toHaveBeenCalled();
});
it("loads a workflow on demand from home and ties the proposal to the version the model saw", async () => {
  m.response.mockResolvedValueOnce(respond("workflow_load")).mockResolvedValueOnce(respond("workflow_draft",[{field:"operations",value:'[{"op":"rename","name":"Shitjet"}]'}]));
  await planRequest(access,"Ndrysho emrin e rrjedhës në Shitjet",[],{page:"home",entryPoint:"home"});
  expect(m.load).toHaveBeenCalledExactlyOnceWith(access);
  expect(JSON.parse(m.response.mock.calls[1][0].input).data.workflow.workspace.revision).toBe(7);
  expect(m.prepare).toHaveBeenCalledWith(access,expect.objectContaining({action:"workflow_draft"}),7,undefined);
});
it("does not read disabled workflow data even when the model requests it", async () => {
  m.response.mockResolvedValueOnce(respond("workflow_load"));
  await expect(planRequest({...access,modules:[]},"Shfaq rrjedhën",[])).rejects.toThrow("nuk është aktiv");
  expect(m.load).not.toHaveBeenCalled();
  expect(m.prepare).not.toHaveBeenCalled();
});
it("does not overwrite uncommitted editor work through the assistant", async () => {
  m.response.mockResolvedValueOnce(respond("workflow_draft",[{field:"operations",value:'[{"op":"rename","name":"Shitjet"}]'}]));
  await expect(planRequest(access,"Ndrysho emrin",[],{page:"workflows",entryPoint:"contextual",workflowSelection:{revision:7,dirty:true,nodeId:"order"}})).rejects.toThrow("paruajtura");
  expect(m.prepare).not.toHaveBeenCalled();
});

it("treats an empty order-workflow library as loaded and removes repeated load from model choices",async()=>{
  m.response.mockResolvedValueOnce(respond("orderflow_load")).mockResolvedValueOnce(respond("orderflow_create",[{field:"name",value:"Porosia"},{field:"steps",value:'[{"key":"customer","kind":"customer","label":"Adresa?","required":true}]'}]));
  await planRequest(access,"Krijo workflow Porosia",[],{page:"home",entryPoint:"home"});
  expect(m.orderLoad).toHaveBeenCalledTimes(1);
  expect(JSON.parse(m.response.mock.calls[1][0].input).data.orderflows.flows).toEqual([]);
  expect(m.response.mock.calls[1][0].text.format.schema.properties.action.enum).not.toContain("orderflow_load");
  expect(m.orderPrepare).toHaveBeenCalledWith(access,expect.objectContaining({action:"orderflow_create"}),undefined);
});

it("provides real order-status authoring capability and passes its explicit operations to draft preparation", async () => {
  const existing = upgradeVisualGraph(starterVisualGraph());
  m.load.mockResolvedValue({ workspace: { graph: existing, revision: 7 }, published: null });
  const operations = [
    { op: "put_node", node: { id: "status", kind: "order_status", label: "Statusi i porosisë", position: { x: 700, y: 0 }, config: {} } },
    { op: "put_edge", edge: { id: "status-end", source: "status", target: "end", port: "next" } },
    { op: "put_flow", flow: { id: "status", kind: "information", label: "Statusi i porosisë", entryNodeId: "status", nodeIds: ["status"] } },
  ];
  m.response.mockResolvedValueOnce(respond("workflow_load")).mockResolvedValueOnce(respond("workflow_draft", [{ field: "operations", value: JSON.stringify(operations) }]));
  await planRequest(access, "Shto një rrjedhë për statusin e porosisë së klientit", [], { page: "workflows", entryPoint: "contextual", workflowSelection: { revision: 7, dirty: false } });
  expect(m.response.mock.calls[1][0].instructions).toContain("propose an actual order_status node");
  expect(m.response.mock.calls[1][0].instructions).toContain("Never fulfill status lookup by merely renaming a knowledge node");
  const proposed = m.prepare.mock.calls[0][1];
  expect(proposed.action).toBe("workflow_draft");
  const graph = applyWorkflowOperations(existing, proposed.changes[0].value);
  expect(validateVisualGraph(graph).errors).toEqual([]);
  expect(graph.nodes.find(node => node.id === "status")?.kind).toBe("order_status");
  expect(graph.version === 2 && graph.flows.filter(flow => flow.id !== "status")).toEqual(existing.flows);
});

it("links the selected visual flow even when no separate linear workflow exists", async () => {
  const graph = upgradeVisualGraph(starterVisualGraph());
  const flow = graph.flows.find(flow => flow.kind === "order")!;
  const productId = "00000000-0000-4000-8000-000000000001";
  m.load.mockResolvedValue({ workspace: { graph, revision: 7 }, published: null });
  m.response.mockResolvedValueOnce(respond("workflow_load")).mockResolvedValueOnce(respond("workflow_draft", [{ field: "operations", value: JSON.stringify([{ op: "put_flow", flow: { ...flow, productIds: [productId] } }]) }]));
  await planRequest(access, "Lidhe këtë rrjedhë ekzistuese me produktin e zgjedhur", [], { page: "workflows", entryPoint: "contextual", workflowSelection: { revision: 7, dirty: false, flowId: flow.id } });
  const modelRequest = m.response.mock.calls[1][0];
  expect(modelRequest.instructions).toContain("An empty linear workflow list does not prevent a visual binding");
  expect(JSON.parse(modelRequest.input).uiContext.workflowSelection.flowId).toBe(flow.id);
  const operation = m.prepare.mock.calls[0][1];
  expect(operation.action).toBe("workflow_draft");
  const after = applyWorkflowOperations(graph, operation.changes[0].value);
  expect(after.nodes).toEqual(graph.nodes); expect(after.edges).toEqual(graph.edges);
  expect(after.version === 2 && after.flows.find(candidate => candidate.id === flow.id)?.productIds).toEqual([productId]);
  expect(m.orderLoad).not.toHaveBeenCalled(); expect(m.orderPrepare).not.toHaveBeenCalled();
});

it("rejects a selected flow that is no longer in the saved graph", async () => {
  m.load.mockResolvedValue({ workspace: { graph: upgradeVisualGraph(starterVisualGraph()), revision: 7 }, published: null });
  m.response.mockResolvedValueOnce(respond("workflow_load"));
  await expect(planRequest(access, "Lidhe këtë rrjedhë", [], { page: "workflows", entryPoint: "contextual", workflowSelection: { revision: 7, dirty: false, flowId: "missing-flow" } })).rejects.toThrow("nuk ekziston më");
  expect(m.response).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled();
});

it("routes a main-workflow clarification to a read without requiring a branch, even after outdated advice", async () => {
  m.response.mockResolvedValueOnce(respond("workflow_catalog"));
  m.prepare.mockResolvedValueOnce({ message: "Produktet trashëgojnë workflow-in kryesor." });
  const history = [
    { role: "user" as const, content: "A mund te lidhesh te gjithe produktet me workflow?" },
    { role: "assistant" as const, content: "Produktet mund të lidhen vetëm me një rrjedhë të emërtuar. Me cilën?" },
  ];
  const result = await planRequest(access, "me workflow kryesor, jo me rrjedha specifike", history, { page: "home", entryPoint: "home" });
  expect(result.token).toBeUndefined();
  expect(m.prepare).toHaveBeenCalledExactlyOnceWith(access, expect.objectContaining({ action: "workflow_catalog", changes: [] }), undefined, undefined);
  expect(m.load).not.toHaveBeenCalled();
  expect(m.orderLoad).not.toHaveBeenCalled();
  expect(m.orderPrepare).not.toHaveBeenCalled();
});

it("allows inheritance inspection with a dirty selected branch, without treating it as a mutation", async () => {
  const graph = upgradeVisualGraph(starterVisualGraph());
  m.load.mockResolvedValueOnce({ workspace: { graph, revision: 7 }, published: graph });
  m.response.mockResolvedValueOnce(respond("workflow_catalog"));
  await planRequest(access, "Lidhi me workflow kryesor, jo kete dege", [], { page: "workflows", entryPoint: "contextual", workflowSelection: { flowId: graph.flows[0].id, revision: 7, dirty: true } });
  expect(m.prepare).toHaveBeenCalledWith(access, expect.objectContaining({ action: "workflow_catalog" }), 7, undefined);
});

it("requires structured intent from the live planner before preparing draft mutations", async () => {
  m.response.mockResolvedValue({ output_text: JSON.stringify({ action: "workflow_draft", id: null, message: "Test", changes: [{ field: "operations", value: '[{"op":"rename","name":"Test"}]' }], automation: null }) });
  await expect(planRequest(access, "Ndrysho", [], { page: "workflows", entryPoint: "contextual" })).rejects.toThrow("strukturuar");
  expect(m.prepare).not.toHaveBeenCalled();
});

it("returns a structured partial explanation from clarify and does not issue a token", async () => {
  m.assess.mockResolvedValue(["product.search", "product.recommend"].map(capabilityKey => ({ capabilityKey, status: "ready", missingRequirements: [], reasonCode: "configured" })));
  m.response.mockResolvedValue({ output_text: JSON.stringify({ action: "clarify", id: null, message: "Done", changes: [],
    automation: { requestedBehaviors: [{ description: "Katalogu", capabilityKeys: ["product.search", "product.recommend", "inventory.check", "back_in_stock.notify"] }], assumptions: [], clarificationQuestions: [] } }) });
  const result = await planRequest(access, "Check inventory and notify when back in stock", [], { page: "workflows", entryPoint: "contextual" });
  expect(result.automation?.unsupportedActions).toEqual(["inventory.check", "back_in_stock.notify"]);
  expect(result.workflow?.semanticSummary).toMatchObject({ blocked: true, changes: [] });
  expect(result.message).not.toContain("Done"); expect(result.token).toBeUndefined();
  expect(m.prepare).not.toHaveBeenCalled();
  expect(m.response.mock.calls[0][0].text.format.schema.required).toContain("automation");
});
