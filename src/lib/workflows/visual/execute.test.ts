import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnParams, AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import { emptyState } from "../engine";
import { migrateContext, setFact } from "../context";
import type { VisualGraph, VisualNode, VisualRunState, VisualVersion } from "./types";

const mocks = vi.hoisted(() => ({ load: vi.fn(), entity: vi.fn() }));
vi.mock("./entity-routing", async original => ({ ...await original<object>(), resolveVisualEntity: mocks.entity }));
vi.mock("./store", () => ({ loadVisualVersion: mocks.load }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test-model" }));
import { executeVisualTurn } from "./execute";
import { starterVisualGraph, upgradeVisualGraph } from "./model";

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
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue(null); mocks.entity.mockResolvedValue({}); });

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
 expect(legacy.mock.calls[0][0]).toMatchObject({message:"Fola me stafin, dua të porosis",orderRequest:true,state:{product_id:"product-a",step_key:"collect_size",fields:{color:"blue"}}});
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

it("routes WhatsApp to ordering directly even when a saved field still points to staff and no order condition exists",async()=>{
 const graph:VisualGraph={version:1,name:"Channel",nodes:[node("start","start"),node("channel","condition",{condition:"field_equals",fieldKey:"channel",value:"whatsapp"}),node("staff","handoff",{prompt:"Numri WhatsApp"}),node("product","product"),node("end","end")],edges:[{id:"s",source:"start",target:"channel",port:"next"},{id:"y",source:"channel",target:"staff",port:"yes"},{id:"n",source:"channel",target:"product",port:"no"},{id:"p",source:"product",target:"end",port:"next"}]};
 const state={...emptyState(),visual:{...waiting("staff"),status:"handoff" as const,awaiting:false,visited:["start","channel","staff"],values:{channel:"whatsapp",email:"ana@example.com"}}};
 const legacy=vi.fn(async(p:LegacyParams)=>response(p,"Cilin produkt dëshironi?"));
 const turn=await executeVisualTurn({...params(graph),state,message:"ok fola ne whatsapp dhe dua qe te te porosis produkt"},legacy);
 expect(turn.nextState.visual).toMatchObject({nodeId:"product",status:"waiting",values:{channel:"whatsapp",email:"ana@example.com"}});
 expect(turn.visualWorkflow?.traversedNodeIds).toEqual(["product"]);
 expect(turn.visualWorkflow?.routing).toMatchObject({from:"staff",to:"product",action:"order"});
 expect(turn.reply).toBe("Cilin produkt dëshironi?");
});
it("evaluates the message at a product node and can move to a different configured task",async()=>{
 const guidance=await import("../guidance");
 const spy=vi.spyOn(guidance,"chooseGuidance").mockResolvedValueOnce({action:"route",target:"email",source:"ai"});
 try {
  const graph=linear(node("product","product"),node("email","collect",{fieldKey:"email",fieldType:"email",prompt:"Email?"}));
  const state={...emptyState(),product_id:"product-a",step_key:"size",fields:{color:"blue"},visual:waiting("product")};
  const turn=await executeVisualTurn({...params(graph),state,message:"Tani dua të ndryshoj emailin"},async p=>response(p));
  expect(spy.mock.calls[0][0].routes?.map(r=>r.id)).toEqual(["product","email"]);
  expect(turn.nextState.visual?.nodeId).toBe("email");
  expect(turn.nextState.fields.color).toBe("blue");
  expect(turn.nextState.product_id).toBe("product-a");
 } finally {spy.mockRestore();}
});

describe("message-centered process entries", () => {
  it("enters a booking flow through its required collection and calls the adapter only afterward", async () => {
    const base = linear(node("phone", "collect", { fieldKey: "customer_phone", fieldType: "phone", prompt: "Telefoni?" }), node("booking", "booking"));
    const graph: VisualGraph = { ...base, version: 2, flows: [{ id: "reservation", kind: "booking", label: "Rezervim", entryNodeId: "phone", nodeIds: ["phone", "booking"] }] };
    const bookingTurn = vi.fn(async (state: ReturnType<typeof emptyState>) => { const turn = response({ ...params(graph), state }, "Cila datë?"); turn.nextState.fields.booking = { nonce: "b", phase: "collect" }; return turn; });
    const first = await executeVisualTurn({ ...params(graph), message: "Dua rezervim", bookingRequest: true, bookingNavigation: true, bookingTurn }, async p => response(p));
    expect(first.reply).toBe("Telefoni?");
    expect(first.nextState.visual?.nodeId).toBe("phone");
    expect(bookingTurn).not.toHaveBeenCalled();
    const next = await executeVisualTurn({ ...params(graph), message: "0691234567", state: first.nextState, bookingRequest: true, bookingTurn }, async p => response(p));
    expect(bookingTurn).toHaveBeenCalledTimes(1);
    expect(next.nextState.visual?.nodeId).toBe("booking");
    expect(next.nextState.visual?.values.customer_phone).toBe("0691234567");
    expect(next.reply).toBe("Cila datë?");
  });
  it("continues beyond booking only after the isolated adapter reports completion", async () => {
    const base = linear(node("booking", "booking"), node("after", "knowledge", { prompt: "Shpjego përgatitjen" }));
    const graph: VisualGraph = { ...base, version: 2, flows: [{ id: "reservation", kind: "booking", label: "Rezervim", entryNodeId: "booking", nodeIds: ["booking", "after"] }] };
    const legacy = vi.fn(async (p: LegacyParams) => response(p, "Përgatitja"));
    const result = await executeVisualTurn({ ...params(graph), state: { ...emptyState(), visual: waiting("booking") }, message: "Konfirmoj", bookingRequest: true,
      bookingTurn: async state => response({ ...params(graph), state }, "Rezervimi gati") }, legacy);
    expect(result.nextState.visual?.status).toBe("completed");
    expect(result.reply).toBe("Rezervimi gati\n\nPërgatitja");
    expect(legacy).toHaveBeenCalledWith(expect.objectContaining({ informational: "Shpjego përgatitjen" }));
  });
  it("honors an informational flow's collection entry instead of skipping to knowledge", async () => {
    const base = linear(node("topic", "collect", { fieldKey: "topic", prompt: "Cila temë?" }), node("info", "knowledge", { prompt: "Përdor temën" }));
    const graph: VisualGraph = { ...base, version: 2, flows: [{ id: "information", kind: "information", label: "Informacion", entryNodeId: "topic", nodeIds: ["topic", "info"] }] };
    const legacy = vi.fn(async (p: LegacyParams) => response(p));
    const first = await executeVisualTurn({ ...params(graph), message: "Informacion", informationRequest: true }, legacy);
    expect(first.nextState.visual?.nodeId).toBe("topic");
    expect(first.reply).toBe("Cila temë?");
    const next = await executeVisualTurn({ ...params(graph), message: "Transporti", state: first.nextState, informationRequest: true }, legacy);
    expect(next.nextState.visual?.status).toBe("completed");
    expect(legacy).toHaveBeenCalledWith(expect.objectContaining({ informational: "Përdor temën" }));
  });
});

it.each(["order", "booking"] as const)("reuses a known phone at the %s flow entry instead of forcing recollection", async kind => {
  const processNode = kind === "order" ? "product" : "booking";
  const base = linear(node("phone", "collect", { fieldKey: "customer_phone", fieldType: "phone", prompt: "Telefoni?" }), node("process", processNode));
  const graph: VisualGraph = { ...base, version: 2, flows: [{ id: "flow", kind, label: kind, entryNodeId: "phone", nodeIds: ["phone", "process"] }] };
  const state = migrateContext(); setFact(state, "customer_phone", "0691234567", "phone", "message");
  const result = await executeVisualTurn({ ...params(graph), state, message: kind === "order" ? "Dua të porosis" : "Dua rezervim",
    bookingRequest: kind === "booking", bookingTurn: async state => { const result = response({ ...params(graph), state }, "Cila datë?"); result.nextState.fields.booking = { nonce: "b" }; return result; } }, async p => response(p, "Cilin produkt?"));
  expect(result.reply).not.toContain("Telefoni?");
  expect(result.nextState.visual?.nodeId).toBe("process");
  expect(result.nextState.customer.phone).toBe("0691234567");
});

it("opens a published information flow during a pinned linear order", async () => {
  const base = linear(node("topic", "collect", { fieldKey: "topic", prompt: "Cila temë?" }), node("info", "knowledge"));
  const graph: VisualGraph = { ...base, version: 2, flows: [{ id: "info-flow", kind: "information", label: "Informacion", entryNodeId: "topic", nodeIds: ["topic", "info"] }] };
  mocks.load.mockResolvedValue(version(graph));
  const legacy = vi.fn(async (p: LegacyParams) => response(p));
  const result = await executeVisualTurn({ ...params(graph), visualPreview: undefined, informationRequest: true, message: "Informacion", state: { ...emptyState(), product_id: "p", step_key: "size" } }, legacy);
  expect(result.reply).toBe("Cila temë?");
  expect(result.nextState.product_id).toBe("p");
  expect(legacy).not.toHaveBeenCalled();
});

it("answers once when an informational question reaches knowledge followed by collection", async () => {
  const graph = linear(node("knowledge", "knowledge"), node("age", "collect", { fieldKey: "age", prompt: "Sa vjeç është fëmija?" }));
  const legacy = vi.fn(async (p: LegacyParams) => response(p, "Çmimi mungon."));
  const result = await executeVisualTurn({ ...params(graph), message: "Sa kushton?" }, legacy);
  expect(legacy).toHaveBeenCalledTimes(1);
  expect(result.reply).toBe("Çmimi mungon.\n\nSa vjeç është fëmija?");
});

it.each(["Dua të flas me stafin.", "Telefoni im është 0690000000; dua të flas me stafin."])("uses only the declared v2 support entry for %s", async message => {
  const graph = upgradeVisualGraph(starterVisualGraph());
  expect(graph.nodes.some(node => node.kind === "condition" && node.config.condition === "intent_support")).toBe(true);
  expect(graph.flows.find(flow => flow.kind === "support")?.entryNodeId).toBe("handoff");
  const legacy = vi.fn(async (p: LegacyParams) => response(p));
  const state = migrateContext(); setFact(state, "customer_phone", "0690000000", "phone", "message");
  const result = await executeVisualTurn({ ...params(graph), message, state }, legacy);
  expect(result.reply).toBe("Po ia kaloj kërkesën tuaj ekipit.");
  expect(result.visualWorkflow?.routing).toMatchObject({ action: "support", source: "rules", to: "handoff" });
  expect(result.nextState.visual?.status).toBe("handoff");
  expect(result.nextState.customer.phone).toBe("0690000000");
  expect(legacy).not.toHaveBeenCalled();
});

function statusGraph(): VisualGraph {
  const graph = upgradeVisualGraph(starterVisualGraph());
  graph.nodes.push(node("status", "order_status"));
  graph.edges.push({ id: "status-end", source: "status", target: "end", port: "next" });
  graph.flows.push({ id: "status-flow", kind: "information", label: "Statusi i porosisë", entryNodeId: "status", nodeIds: ["status"] });
  return graph;
}

it("routes an existing-order question to the real lookup instead of general knowledge", async () => {
  const graph = statusGraph();
  const legacy = vi.fn(async (p: LegacyParams) => response(p, "General answer"));
  const lookup = vi.fn(async (state: ReturnType<typeof emptyState>) => response({ ...params(graph), state }, "Porosia #ABCD1234 është konfirmuar."));
  const result = await executeVisualTurn({ ...params(graph), message: "Në çfarë statusi është porosia ime?", informationRequest: true, orderStatusRequest: true, orderStatusTurn: lookup }, legacy);
  expect(lookup).toHaveBeenCalledOnce();
  expect(legacy).not.toHaveBeenCalled();
  expect(result.reply).toContain("#ABCD1234");
  expect(result.nextState.visual?.status).toBe("completed");
  expect(result.visualWorkflow?.routing?.to).toBe("status");
});

it("keeps ordinary questions out of the existing-order lookup flow", async () => {
  const graph = statusGraph();
  const lookup = vi.fn();
  const result = await executeVisualTurn({ ...params(graph), message: "Sa kushton?", informationRequest: true, orderStatusTurn: lookup }, async p => response(p, "Informacioni i produktit"));
  expect(lookup).not.toHaveBeenCalled();
  expect(result.reply).toBe("Informacioni i produktit");
});

it("keeps the lookup cursor while choosing an owned order, then completes without resetting the active order", async () => {
  const graph = statusGraph();
  const state = { ...emptyState(), product_id: "current-product", step_key: "size", fields: { color: "blue" } };
  const lookup = vi.fn(async (state: ReturnType<typeof emptyState>) => ({ ...response({ ...params(graph), state }, "Cilën porosi?"), orderStatusPending: true }));
  const first = await executeVisualTurn({ ...params(graph), state, message: "Statusi i porosisë", orderStatusRequest: true, orderStatusTurn: lookup }, async p => response(p));
  expect(first.nextState.visual).toMatchObject({ nodeId: "status", status: "waiting", awaiting: true });
  const second = await executeVisualTurn({ ...params(graph), state: first.nextState, message: "ABCD1234", orderStatusRequest: true,
    orderStatusTurn: async state => response({ ...params(graph), state }, "Porosia është konfirmuar.") }, async p => response(p));
  expect(second.nextState).toMatchObject({ product_id: "current-product", step_key: "size", fields: { color: "blue" }, visual: { status: "completed" } });
});

it("does not start booking or product side effects after an order-status answer", async () => {
  const graph = statusGraph();
  graph.edges.find(edge => edge.id === "status-end")!.target = "product";
  const legacy = vi.fn(async (p: LegacyParams) => response(p));
  const result = await executeVisualTurn({ ...params(graph), message: "Statusi i porosisë", orderStatusRequest: true,
    orderStatusTurn: async state => response({ ...params(graph), state }, "Porosia është konfirmuar.") }, legacy);
  expect(result.reply).toBe("Porosia është konfirmuar.");
  expect(legacy).not.toHaveBeenCalled();
  expect(result.nextState.product_id).toBeNull();
});

it.each(["Sa kushton?", "Çmimi"])("answers %s without running a status-only graph's lookup", async message => {
  const base = linear(node("status", "order_status"));
  const graph: VisualGraph = { ...base, version: 2, flows: [{ id: "lookup", kind: "information", label: "Statusi", entryNodeId: "status", nodeIds: ["status"] }] };
  const lookup = vi.fn();
  const result = await executeVisualTurn({ ...params(graph), message, informationRequest: true, orderStatusTurn: lookup }, async p => response(p, "Çmimi"));
  expect(lookup).not.toHaveBeenCalled();
  expect(result.reply).toBe("Çmimi");
});

const boundProductId = "aaaaaaaa-0000-4000-8000-000000000001";
function boundGraph(...nodes: VisualNode[]): VisualGraph {
  const base = linear(...nodes);
  return { ...base, version: 2, flows: [{ id: "bound", kind: "order", label: "Personalizim", entryNodeId: nodes[0].id, nodeIds: nodes.map(node => node.id), productIds: [boundProductId] }] };
}
function mockBoundProduct() {
  mocks.entity.mockResolvedValue({ selected: { entity: { kind: "product", id: boundProductId, name: "Puzzle", productTypeId: "puzzle" }, binding: { flowId: "bound", entity: { kind: "product", id: boundProductId } } } });
}
it("runs bound visual collection and final review without any separate linear workflow", async () => {
  mockBoundProduct();
  const graph = boundGraph(node("product", "product"), node("size", "collect", { fieldKey: "size", prompt: "Madhësia?" }));
  const state = migrateContext(emptyState());
  for (const [key, value] of Object.entries({ name: "Ana", phone: "0691234567", city: "Tiranë", address: "Rruga 1" })) setFact(state, `customer_${key}`, value, key === "phone" ? "phone" : "text", "message");
  const legacy = vi.fn(async (p: LegacyParams) => response(p));
  const first = await executeVisualTurn({ ...params(graph), state, message: "Dua Puzzle", orderRequest: true }, legacy);
  expect(first.reply).toBe("Madhësia?");
  expect(first.nextState.product_id).toBe(boundProductId);
  const review = await executeVisualTurn({ ...params(graph), state: first.nextState, message: "M" }, legacy);
  expect(review.nextState.step_key).toBe("order_confirm");
  expect(review.reply).toContain("Konfirmoni porosinë për Puzzle");
  expect(review.reply).toContain("size: M");
  expect(review.nextState.context?.order.size.value).toBe("M");
  const ready = await executeVisualTurn({ ...params(graph), state: review.nextState, message: "Po" }, legacy);
  expect(ready.nextState.step_key).toBe("order_ready");
  expect(ready.nextState.context?.execution.orderConfirmed).toBe(true);
  expect(ready.workflowId).toBeNull();
  expect(ready.nextState.context?.execution.linear).toBeUndefined();
  expect(legacy).not.toHaveBeenCalled();
});
it("a product-to-end visual binding collects missing customer data before explicit confirmation", async () => {
  mockBoundProduct();
  const graph = boundGraph(node("product", "product"));
  const legacy = vi.fn(async (p: LegacyParams) => response(p));
  const first = await executeVisualTurn({ ...params(graph), state: migrateContext(emptyState()), message: "Puzzle" }, legacy);
  expect(first.nextState.step_key).toBe("collect_customer");
  expect(first.reply).toContain("emrin");
  const review = await executeVisualTurn({ ...params(graph), state: first.nextState, message: "Emri: Ana; telefoni: 0691234567; qyteti: Tiranë; adresa: Rruga 1" }, legacy);
  expect(review.nextState.step_key).toBe("order_confirm");
  expect(review.nextState.context?.execution.orderConfirmed).toBe(false);
  expect(legacy).not.toHaveBeenCalled();
});
it("refuses switching an unfinished bound product without confirmation", async () => {
  mockBoundProduct();
  const graph = boundGraph(node("product", "product"));
  const state = migrateContext(emptyState()); state.product_id = "other-product"; state.processes = { active: "order" };
  const result = await executeVisualTurn({ ...params(graph), state, message: "Dua Puzzle" }, async p => response(p));
  expect(result.nextState.product_id).toBe("other-product");
  expect(result.nextState.processes?.pendingChoice?.kind).toBe("replace");
});
it("a service binding can share visual product-selection steps without invoking a linear order", async () => {
  const base = boundGraph(node("product", "product"), node("details", "collect", { fieldKey: "details", prompt: "Çfarë të duhet?" }));
  const graph = { ...base, version: 2 as const, flows: [{ id: "bound", kind: "custom" as const, label: "Kërkesa", entryNodeId: "product", nodeIds: ["product", "details"], serviceIds: [boundProductId] }] };
  mocks.entity.mockResolvedValue({ selected: { entity: { kind: "service", id: boundProductId, name: "Konsultë", bookingEnabled: false }, binding: { flowId: "bound", entity: { kind: "service", id: boundProductId } } } });
  const legacy = vi.fn(async (p: LegacyParams) => response(p));
  const booking = vi.fn();
  const result = await executeVisualTurn({ ...params(graph), state: migrateContext(emptyState()), message: "Konsultë", bookingTurn: booking }, legacy);
  expect(result.reply).toBe("Çfarë të duhet?");
  expect(result.nextState.product_id).toBeNull();
  expect(legacy).not.toHaveBeenCalled(); expect(booking).not.toHaveBeenCalled();
});
it("revisits a visual answer from final review and invalidates the old confirmation", async () => {
  mockBoundProduct();
  const size = node("size", "collect", { fieldKey: "size", prompt: "Madhësia?" }); size.label = "Madhësia";
  const graph = boundGraph(node("product", "product"), size);
  const state = migrateContext(emptyState());
  for (const [key, value] of Object.entries({ name: "Ana", phone: "0691234567", city: "Tiranë", address: "Rruga 1" })) setFact(state, `customer_${key}`, value, key === "phone" ? "phone" : "text", "message");
  const first = await executeVisualTurn({ ...params(graph), state, message: "Puzzle" }, async p => response(p));
  const review = await executeVisualTurn({ ...params(graph), state: first.nextState, message: "M" }, async p => response(p));
  expect(review.nextState.context?.execution.awaitingOrderConfirmation).toBe(true);
  const corrected = await executeVisualTurn({ ...params(graph), state: review.nextState, message: "Ndrysho madhësinë" }, async p => response(p));
  expect(corrected.reply).toBe("Madhësia?");
  expect(corrected.nextState.visual?.nodeId).toBe("size");
  expect(corrected.nextState.context?.execution.awaitingOrderConfirmation).toBe(false);
  const nextReview = await executeVisualTurn({ ...params(graph), state: corrected.nextState, message: "L" }, async p => response(p));
  expect(nextReview.reply).toContain("Madhësia: L"); expect(nextReview.nextState.step_key).toBe("order_confirm");
});
it("offers bound products before entering a generic legacy selection", async () => {
  const entity = { id: boundProductId, kind: "product", name: "Puzzle" };
  mocks.entity.mockResolvedValue({ available: [entity] });
  const graph = boundGraph(node("product", "product"));
  const legacy = vi.fn(async (p: LegacyParams) => response(p));
  const first = await executeVisualTurn({ ...params(graph), message: "Dua të porosis", orderRequest: true }, legacy);
  expect(first.reply).toBe("Cilin produkt dëshironi? Puzzle."); expect(legacy).not.toHaveBeenCalled();
  mockBoundProduct();
  const selected = await executeVisualTurn({ ...params(graph), message: "Puzzle", state: first.nextState }, legacy);
  expect(selected.nextState.product_id).toBe(boundProductId); expect(selected.nextState.step_key).toBe("collect_customer");
});
it("a product bound to an information flow does not trigger order completion", async () => {
  mockBoundProduct();
  const base = boundGraph(node("info", "knowledge"));
  const graph = { ...base, version: 2 as const, flows: [{ ...base.version === 2 ? base.flows[0] : {}, id: "bound", label: "Info", kind: "information" as const, entryNodeId: "info", nodeIds: ["info"], productIds: [boundProductId] }] };
  const result = await executeVisualTurn({ ...params(graph), message: "Puzzle", state: migrateContext(emptyState()) }, async p => response(p, "Informacion për Puzzle"));
  expect(result.reply).toBe("Informacion për Puzzle"); expect(result.nextState.product_id).toBeNull();
  expect(result.nextState.step_key).toBe("choose_product"); expect(result.nextState.context?.execution.orderConfirmed).not.toBe(true);
});
it("keeps an explicitly started custom product order through its later short answers", async () => {
  mockBoundProduct();
  const base = boundGraph(node("size", "collect", { fieldKey: "size", prompt: "Madhësia?" }));
  if (base.version !== 2) throw new Error("graph"); base.flows[0].kind = "custom";
  const first = await executeVisualTurn({ ...params(base), message: "Dua të porosis Puzzle", orderRequest: true }, async p => response(p));
  const next = await executeVisualTurn({ ...params(base), message: "L", state: first.nextState }, async p => response(p));
  expect(next.nextState.product_id).toBe(boundProductId); expect(next.nextState.step_key).toBe("collect_customer");
});
it("asks before leaving a bound order for a different unbound legacy product", async () => {
  const graph = boundGraph(node("product", "product"));
  const state = migrateContext(emptyState()); state.product_id = boundProductId; state.processes = { active: "order" };
  state.visual = { ...waiting("product"), binding: { flowId: "bound", entity: { kind: "product", id: boundProductId } } };
  mocks.entity.mockResolvedValue({ mentioned: { kind: "product", id: "legacy-product", name: "Poster" } });
  const legacy = vi.fn(async (p: LegacyParams) => response(p));
  const result = await executeVisualTurn({ ...params(graph), message: "Dua Poster", state }, legacy);
  expect(result.reply).toContain("Ta zëvendësojmë me Poster"); expect(result.nextState.product_id).toBe(boundProductId);
  expect(result.nextState.processes?.pendingChoice?.kind).toBe("replace"); expect(legacy).not.toHaveBeenCalled();
});
it.each(["test", "production"] as const)("only enables inactive binding previews in trusted %s mode", async mode => {
  mockBoundProduct();
  const graph = boundGraph(node("product", "product")); mocks.load.mockResolvedValue(version(graph));
  await executeVisualTurn({ ...params(graph), mode, visualPreview: undefined, message: "Puzzle" }, async p => response(p));
  expect(mocks.entity).toHaveBeenCalledWith("business-a", graph, "Puzzle", undefined, mode === "test");
});
