import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnParams, AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import { emptyState } from "../engine";
import type { VisualGraph, VisualNode, VisualRunState, VisualVersion } from "./types";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./store", () => ({ loadVisualVersion: mocks.load }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test-model" }));
import { executeVisualTurn } from "./execute";
import { starterVisualGraph } from "./model";

function node(id: string, kind: VisualNode["kind"], config: VisualNode["config"] = {}): VisualNode {
  return { id, kind, label: id, position: { x: 0, y: 0 }, config };
}
function linear(...steps: VisualNode[]): VisualGraph {
  const nodes = [node("start", "start"), ...steps, node("end", "end")];
  return { version: 1, name: "Test", nodes, edges: nodes.slice(0, -1).map((n, i) => ({ id: `edge-${i}`, source: n.id, target: nodes[i + 1].id, port: "next" })) };
}
function version(graph = starterVisualGraph(), id = "version-1"): VisualVersion {
  return { id, businessId: "business-a", graph, createdAt: "2026-10-10T00:00:00Z" };
}
function params(graph = starterVisualGraph()): AgentTurnParams {
  return { businessId: "business-a", mode: "test", message: "Përshëndetje", hasPhoto: false, visualPreview: version(graph) };
}
type LegacyParams = AgentTurnParams & { informational?: string; requireConfiguredWorkflow?: boolean };
function response(input: LegacyParams, reply = "Përgjigje nga njohuritë"): AgentTurnResult {
  return {
    reply, nextState: structuredClone(input.state ?? emptyState()), previousResponseId: "response-1", workflowId: null,
    productName: null, workflowProgress: [], debug: { model: "test-model", source: "ai", fallbackReason: null,
      agentConfigured: true, knowledgeCount: 1, productCount: 0, workflowSteps: [], elapsedMs: 0 },
  };
}
function waiting(nodeId: string, versionId = "version-1"): VisualRunState {
  return { versionId, nodeId, status: "waiting", values: {}, visited: ["start", nodeId], awaiting: true };
}
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue(null); });

describe("visual execution integration", () => {
  it("retains legacy behavior for a business without an enabled graph", async () => {
    const legacy = vi.fn(async (p: LegacyParams) => response(p));
    const input = { ...params(), visualPreview: undefined };
    await executeVisualTurn(input, legacy);
    expect(legacy).toHaveBeenCalledExactlyOnceWith(input);
  });
  it("answers from knowledge once without advancing a product order", async () => {
    const legacy = vi.fn(async (p: LegacyParams) => response(p));
    const result = await executeVisualTurn({ ...params(), message: "Sa kushton?" }, legacy);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(legacy.mock.calls[0][0]).toMatchObject({ informational: "" });
    expect(legacy.mock.calls[0][0].requireConfiguredWorkflow).toBeUndefined();
    expect(result.reply).toBe("Përgjigje nga njohuritë");
    expect(result.nextState.visual?.status).toBe("completed");
    expect(result.nextState.step_key).toBe("choose_product");
  });
  it("shows the knowledge reply and next collection prompt in one turn", async () => {
    const graph = linear(node("knowledge", "knowledge"), node("email", "collect", { fieldKey: "email", fieldType: "email", prompt: "Cili është email-i?" }));
    const legacy = vi.fn(async (p: LegacyParams) => response(p));
    const result = await executeVisualTurn(params(graph), legacy);
    expect(result.reply).toBe("Përgjigje nga njohuritë\n\nCili është email-i?");
    expect(result.nextState.visual).toMatchObject({ nodeId: "email", awaiting: true, values: {} });
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("includes a configured terminal message after a knowledge answer", async () => {
    const graph = linear(node("knowledge", "knowledge"));
    graph.nodes.find(n => n.kind === "end")!.config.prompt = "Na shkruani përsëri kur të dëshironi.";
    const result = await executeVisualTurn(params(graph), async p => response(p));
    expect(result.reply).toBe("Përgjigje nga njohuritë\n\nNa shkruani përsëri kur të dëshironi.");
    expect(result.nextState.visual?.status).toBe("completed");
  });
  it("passes newly collected values to a knowledge reply", async () => {
    const graph = linear(node("email", "collect", { fieldKey: "email", fieldType: "email", prompt: "Email?" }), node("knowledge", "knowledge"));
    const legacy = vi.fn(async (p: LegacyParams) => response(p));
    await executeVisualTurn({ ...params(graph), message: "ana@example.com", state: { ...emptyState(), visual: waiting("email") } }, legacy);
    expect(legacy.mock.calls[0][0].state?.visual?.values.email).toBe("ana@example.com");
  });
  it("does not reuse a collected answer as the product selection", async () => {
    const graph = linear(node("name", "collect", { fieldKey: "name", prompt: "Emri?" }), node("product", "product"));
    const legacy = vi.fn(async (p: LegacyParams) => response(p, "Cilin produkt?"));
    const result = await executeVisualTurn({ ...params(graph), message: "Ana", state: { ...emptyState(), visual: waiting("name") } }, legacy);
    expect(legacy.mock.calls[0][0]).toMatchObject({ message: "", hasPhoto: false, requireConfiguredWorkflow: true });
    expect(result.nextState.visual?.values.name).toBe("Ana");
  });
  it("enters the configured product engine once and preserves its incomplete state", async () => {
    const legacy = vi.fn(async (p: LegacyParams) => ({ ...response(p, "Madhësia?"), nextState: { ...emptyState(), product_id: "product-a", step_key: "size" } }));
    const result = await executeVisualTurn({ ...params(), message: "Dua të porosis" }, legacy);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(legacy.mock.calls[0][0].requireConfiguredWorkflow).toBe(true);
    expect(result.nextState).toMatchObject({ product_id: "product-a", step_key: "size", visual: { nodeId: "product", status: "waiting" } });
  });
  it("continues beyond the product only once its fields are complete", async () => {
    const graph = linear(node("product", "product"), node("email", "collect", { fieldKey: "email", fieldType: "email", prompt: "Email për dërgesën?" }));
    const legacy = vi.fn(async (p: LegacyParams) => ({ ...response(p, "Porosia gati."), nextState: { ...emptyState(), product_id: "product-a", step_key: "order_ready" } }));
    const result = await executeVisualTurn({ ...params(graph), message: "Tiranë" }, legacy);
    expect(result.reply).toBe("Porosia gati.\n\nEmail për dërgesën?");
    expect(result.nextState.visual).toMatchObject({ nodeId: "email", awaiting: true, values: {} });
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("propagates a product subflow handoff and never advances its next node", async () => {
    const legacy = vi.fn(async (p: LegacyParams) => ({ ...response(p), handoff: true }));
    const result = await executeVisualTurn({ ...params(), message: "Dua të porosis" }, legacy);
    expect(result.handoff).toBe(true);
    expect(result.nextState.visual).toMatchObject({ nodeId: "product", status: "handoff", awaiting: false });
    expect(result.visualWorkflow?.traversedNodeIds).not.toContain("end");
  });
  it("calls the product engine once per turn when routing back into a product loop", async () => {
    const graph: VisualGraph = { version: 1, name: "Loop", nodes: [node("start", "start"), node("product", "product"), node("again", "condition", { condition: "intent_order" }), node("end", "end")], edges: [
      { id: "s", source: "start", target: "product", port: "next" },
      { id: "p", source: "product", target: "again", port: "next" },
      { id: "yes", source: "again", target: "product", port: "yes" },
      { id: "no", source: "again", target: "end", port: "no" },
    ] };
    const legacy = vi.fn(async (p: LegacyParams) => ({ ...response(p, "Porosia gati."), nextState: { ...emptyState(), product_id: "product-a", step_key: "order_ready" } }));
    const result = await executeVisualTurn({ ...params(graph), message: "Dua të porosis" }, legacy);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(result.nextState.visual).toMatchObject({ nodeId: "product", awaiting: true, status: "waiting" });
    expect(result.nextState.product_id).toBeNull();
    expect(result.reply).toContain("Cilin produkt dëshironi?");
  });
  it("keeps the pinned version for a waiting conversation", async () => {
    const graph = linear(node("email", "collect", { fieldKey: "email", fieldType: "email", prompt: "Email?" }));
    mocks.load.mockResolvedValue(version(graph, "pinned-v1"));
    const legacy = vi.fn(async (p: LegacyParams) => response(p));
    const result = await executeVisualTurn({ ...params(), visualPreview: undefined, message: "ana@example.com", state: { ...emptyState(), visual: waiting("email", "pinned-v1") } }, legacy);
    expect(mocks.load).toHaveBeenCalledWith("business-a", "pinned-v1");
    expect(result.nextState.visual?.versionId).toBe("pinned-v1");
    expect(legacy).not.toHaveBeenCalled();
  });
  it("does not silently bypass a missing pinned workflow", async () => {
    const legacy = vi.fn(async (p: LegacyParams) => response(p));
    await expect(executeVisualTurn({ ...params(), visualPreview: undefined, state: { ...emptyState(), visual: waiting("product") } }, legacy)).rejects.toThrow();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects foreign business and production previews before any model call", async () => {
    const legacy = vi.fn(async (p: LegacyParams) => response(p));
    await expect(executeVisualTurn({ ...params(), visualPreview: { ...version(), businessId: "business-other" } }, legacy)).rejects.toThrow();
    await expect(executeVisualTurn({ ...params(), mode: "production" }, legacy)).rejects.toThrow();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("preserves a completed order on a later informational question", async () => {
    const saved = { ...emptyState(), product_id: "product-a", step_key: "order_ready", fields: { size: "M" }, visual: { ...waiting("end"), status: "completed" as const, awaiting: false } };
    const legacy = vi.fn(async (p: LegacyParams) => response(p));
    const result = await executeVisualTurn({ ...params(), message: "Kur mbërrin?", state: saved }, legacy);
    expect(legacy.mock.calls[0][0].state).toMatchObject({ product_id: "product-a", step_key: "order_ready", fields: { size: "M" } });
    expect(result.nextState.product_id).toBe("product-a");
    expect(saved.visual.status).toBe("completed");
  });
});

it("shares a collected phone with the product engine without requesting it twice", async () => {
  const {migrateContext,setFact}=await import("../context");
  const graph=linear(node("phone","collect",{fieldKey:"customer_phone",fieldType:"phone",prompt:"Telefoni?"}),node("product","product"));
  const state=migrateContext();setFact(state,"customer_phone","+355691234567","phone","message");
  const legacy=vi.fn(async(p:LegacyParams)=>response(p,"Vazhdo"));
  const turn=await executeVisualTurn({...params(graph),message:"dua bluze",state},legacy);
  expect(legacy.mock.calls[0][0].state?.customer.phone).toBe("+355691234567");expect(turn.reply).not.toContain("Telefoni?");
});

it("leaves the staff branch when the customer has spoken to staff and now wants to order",async()=>{
 const state={...emptyState(),customer:{name:"Ana",phone:"+355691234567",city:null,address:null},visual:{...waiting("handoff"),status:"handoff" as const,awaiting:false,advisory:true,values:{email:"ana@example.com"}}};
 const legacy=vi.fn(async(p:LegacyParams)=>response(p,"Cilin produkt dëshironi?"));
 const turn=await executeVisualTurn({...params(),state,message:"ok ne rregull, fola ne telefon me stafin, dua te porosis produkt"},legacy);
 expect(turn.nextState.visual).toMatchObject({nodeId:"product",status:"waiting",values:{email:"ana@example.com"}});
 expect(turn.handoff).not.toBe(true);
 expect(legacy).toHaveBeenCalledOnce();
});
it("returns to a collected step while retaining values and reopens confirmation",async()=>{
 const graph=linear(node("name","collect",{fieldKey:"name",prompt:"Emri?"}),node("email","collect",{fieldKey:"email",prompt:"Email?",fieldType:"email"}));
 const state={...emptyState(),visual:{...waiting("email"),visited:["start","name","email"],values:{name:"Ana"}}};
 const legacy=vi.fn(async(p:LegacyParams)=>response(p));
 const back=await executeVisualTurn({...params(graph),state,message:"Kthehu pas"},legacy);
 expect(back.nextState.visual).toMatchObject({nodeId:"name",values:{name:"Ana"}});
 expect(back.reply).toBe("Emri?");
 const correction=await executeVisualTurn({...params(graph),state:back.nextState,message:"Bora"},legacy);
 expect(correction.nextState.visual).toMatchObject({nodeId:"email",values:{name:"Bora"}});
 expect(state.visual.values.name).toBe("Ana");
});
it("answers a question mid-collection without advancing or collecting the question",async()=>{
 const graph=linear(node("name","collect",{fieldKey:"name",prompt:"Emri?"}),node("email","collect",{fieldKey:"email",prompt:"Email?",fieldType:"email"}));
 const state={...emptyState(),visual:{...waiting("email"),values:{name:"Ana"}}};
 const legacy=vi.fn(async(p:LegacyParams)=>response(p,"Dorëzimi zgjat 2 ditë."));
 const answer=await executeVisualTurn({...params(graph),state,message:"Sa zgjat dorëzimi?"},legacy);
 expect(answer.reply).toBe("Dorëzimi zgjat 2 ditë.");
 expect(answer.nextState.visual).toEqual(state.visual);
 expect(answer.visualWorkflow?.traversedNodeIds).toEqual([]);
 const continued=await executeVisualTurn({...params(graph),state:answer.nextState,message:"ana@example.com"},legacy);
 expect(continued.nextState.visual?.values.email).toBe("ana@example.com");
});
it("makes visual staff guidance resumable without requesting an inbox pause",async()=>{
 const turn=await executeVisualTurn({...params(),message:"Dua të flas me stafin"},async p=>response(p));
 expect(turn).toMatchObject({handoff:true,advisoryHandoff:true});
 expect(turn.nextState.visual).toMatchObject({status:"handoff",advisory:true});
});
it("resumes a suspended product without treating the resume request as a field value",async()=>{
 const state={...emptyState(),product_id:"product-a",step_key:"collect_size",fields:{color:"blue"},visual:{...waiting("handoff"),status:"handoff" as const,awaiting:false,advisory:true}};
 const legacy=vi.fn(async(p:LegacyParams)=>response(p,"Madhësia?"));
 await executeVisualTurn({...params(),state,message:"Fola me stafin, dua të porosis"},legacy);
 expect(legacy.mock.calls[0][0]).toMatchObject({message:"",state:{product_id:"product-a",step_key:"collect_size",fields:{color:"blue"}}});
});
it("revisits a completed product subflow without starting an empty order",async()=>{
 const state={...emptyState(),product_id:"product-a",step_key:"order_ready",fields:{size:"M"},visual:{...waiting("end"),status:"completed" as const,awaiting:false,visited:["start","product","end"]}};
 const legacy=vi.fn(async(p:LegacyParams)=>({...response(p,"Adresa?"),nextState:{...p.state!,step_key:"customer"}}));
 const turn=await executeVisualTurn({...params(),state,message:"Kthehu pas"},legacy);
 expect(legacy.mock.calls[0][0]).toMatchObject({message:"Kthehu pas",state:{product_id:"product-a",fields:{size:"M"}}});
 expect(turn.nextState.visual).toMatchObject({nodeId:"product",status:"waiting"});
});
it("uses a newly published version for a new order while preserving the old version for corrections",async()=>{
 const state={...emptyState(),visual:{...waiting("end","old"),status:"completed" as const,awaiting:false,visited:["start","product","end"]}};
 mocks.load.mockResolvedValueOnce(version(starterVisualGraph(),"old")).mockResolvedValueOnce(version(starterVisualGraph(),"new"));
 const turn=await executeVisualTurn({...params(),visualPreview:undefined,state,message:"Dua të porosis"},async p=>response(p,"Cilin produkt?"));
 expect(mocks.load.mock.calls).toEqual([["business-a","old"],["business-a"]]);
 expect(turn.nextState.visual?.versionId).toBe("new");
});
