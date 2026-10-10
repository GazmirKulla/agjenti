import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ response: vi.fn(), load: vi.fn(), prepare: vi.fn(), orderLoad: vi.fn(), orderPrepare: vi.fn() }));
vi.mock("./orderflow-service", () => ({ loadOrderFlows:m.orderLoad, prepareOrderFlow:m.orderPrepare, executeOrderFlow:vi.fn(), refineOrderFlowProposal:vi.fn(), orderFlowInstructions:"orderflow instructions" }));
vi.mock("openai", () => ({ default: class { responses = { create: m.response }; } }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test" }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
vi.mock("./workflow-service", () => ({ loadAssistantWorkflow: m.load, prepareWorkflow: m.prepare, executeWorkflow: vi.fn(), workflowInstructions: "workflow instructions" }));
import { planRequest, type Access } from "./service";
import { starterVisualGraph } from "@/lib/workflows/visual/model";
const access: Access = { userId: "user", businessId: "business", modules: ["workflows"], catalogSource: "internal" };
const respond = (action: string, changes: {field:string;value:string}[] = []) => ({ output_text: JSON.stringify({action,id:null,message:"Kontrollo",changes}) });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "test-only";
  m.load.mockResolvedValue({ workspace: { graph: starterVisualGraph(), revision: 7 }, published: null });
  m.orderLoad.mockResolvedValue({flows:[],products:[],partial:false});
  m.orderPrepare.mockResolvedValue({message:"Kontrollo",token:"sealed"});
  m.prepare.mockResolvedValue({message:"Kontrollo",token:"sealed"});
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
