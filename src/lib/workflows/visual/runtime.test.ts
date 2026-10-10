import { describe, expect, it } from "vitest";
import { normalizeVisualDraft, starterVisualGraph, validateVisualGraph } from "./model";
import { advanceVisualWorkflow, detectVisualIntent } from "./runtime";
import type { VisualGraph, VisualNode, VisualRunState } from "./types";

function node(id: string, kind: VisualNode["kind"], config: VisualNode["config"] = {}): VisualNode {
  return { id, kind, label: id, position: { x: 0, y: 0 }, config };
}
function linear(...steps: VisualNode[]): VisualGraph {
  const nodes = [node("start", "start"), ...steps, node("end", "end")];
  return { version: 1, name: "Test", nodes, edges: nodes.slice(0, -1).map((n, i) => ({ id: `edge-${i}`, source: n.id, target: nodes[i + 1].id, port: "next" })) };
}
function confirmation(): VisualGraph {
  const graph = linear(node("email", "collect", { fieldKey: "email", fieldType: "email", prompt: "Email?" }), node("confirm", "confirm", { prompt: "Konfirmoni?" }));
  graph.edges = graph.edges.filter(edge => edge.source !== "confirm");
  graph.edges.push({ id: "yes", source: "confirm", target: "end", port: "yes" }, { id: "no", source: "confirm", target: "email", port: "no" });
  return graph;
}
function run(graph: VisualGraph, message = "", state?: VisualRunState, hasPhoto = false) {
  return advanceVisualWorkflow({ graph, versionId: "v1", state, message, hasPhoto, intent: detectVisualIntent(message) });
}

describe("visual graph publication", () => {
  it("generates a deterministic connected starter without inventing customer fields", () => {
    const graph = starterVisualGraph();
    expect(starterVisualGraph()).toEqual(graph);
    expect(validateVisualGraph(graph).errors).toEqual([]);
    expect(graph.nodes.some(n => n.kind === "collect")).toBe(false);
  });
  it("saves an unfinished draft while refusing publication", () => {
    const graph = starterVisualGraph();
    graph.edges = [];
    expect(normalizeVisualDraft(graph)).not.toBeNull();
    expect(validateVisualGraph(graph).graph).toBeUndefined();
  });
  it.each(["missing", "duplicate", "unsupported", "dangling"])("rejects %s output routes", kind => {
    const graph = starterVisualGraph();
    if (kind === "missing") graph.edges.shift();
    if (kind === "duplicate") graph.edges.push({ ...graph.edges[0], id: "duplicate" });
    if (kind === "unsupported") graph.edges[0].port = "yes";
    if (kind === "dangling") graph.edges[0].target = "absent";
    expect(validateVisualGraph(graph).errors.length).toBeGreaterThan(0);
  });
  it("rejects unreachable nodes, duplicate IDs, and multiple start nodes", () => {
    for (const extra of [node("unreachable", "end"), node("start", "end"), node("start-two", "start")]) {
      const graph = starterVisualGraph();
      graph.nodes.push(extra);
      expect(validateVisualGraph(graph).graph).toBeUndefined();
    }
  });
  it("rejects an instant loop even when another branch has a terminal", () => {
    const graph = starterVisualGraph();
    graph.edges.find(e => e.source === "knowledge")!.target = "order";
    expect(validateVisualGraph(graph).errors.some(e => e.message.includes("cikël"))).toBe(true);
  });
  it("allows corrections that wait for the next customer reply", () => {
    expect(validateVisualGraph(confirmation()).errors).toEqual([]);
  });
  it("bounds graph size and refuses executable node kinds and reserved field keys", () => {
    const graph = linear(node("email", "collect", { prompt: "Email?", fieldKey: "constructor" }));
    expect(normalizeVisualDraft(graph)).toBeNull();
    expect(normalizeVisualDraft({ ...starterVisualGraph(), nodes: [node("script", "script" as VisualNode["kind"])] })).toBeNull();
    expect(normalizeVisualDraft({ ...starterVisualGraph(), name: "x".repeat(121) })).toBeNull();
  });
});

describe("visual runtime", () => {
  it.each(["Si të porosis?", "Ku është porosia?", "Nuk dua të blej"])("keeps informational/negative intent out of ordering: %s", message => {
    expect(detectVisualIntent(message)).toBe("question");
  });
  it("never treats an inherited object property as a collected field", () => {
    const graph: VisualGraph = { version: 1, name: "Field condition", nodes: [node("start", "start"), node("check", "condition", { condition: "field_present", fieldKey: "toString" }), node("handoff", "handoff"), node("end", "end")], edges: [
      { id: "s", source: "start", target: "check", port: "next" },
      { id: "yes", source: "check", target: "handoff", port: "yes" },
      { id: "no", source: "check", target: "end", port: "no" },
    ] };
    expect(run(graph).action.kind).toBe("end");
  });
  it("evaluates a previously collected field equality with normalized Albanian text", () => {
    const graph: VisualGraph = { version: 1, name: "Field condition", nodes: [node("start", "start"), node("check", "condition", { condition: "field_equals", fieldKey: "city", value: "Tirane" }), node("handoff", "handoff"), node("end", "end")], edges: [
      { id: "s", source: "start", target: "check", port: "next" },
      { id: "yes", source: "check", target: "end", port: "yes" },
      { id: "no", source: "check", target: "handoff", port: "no" },
    ] };
    const state: VisualRunState = { versionId: "v1", nodeId: "check", status: "running", visited: [], values: { city: "Tiranë" }, awaiting: false };
    expect(run(graph, "", state).action.kind).toBe("end");
    expect(run(graph, "", { ...state, values: { city: "Durrës" } }).action.kind).toBe("handoff");
  });
  it("routes a question to knowledge and then ends without starting a product flow", () => {
    const result = run(starterVisualGraph(), "Sa kushton?");
    expect(result.action.kind).toBe("knowledge");
    expect(result.state.nodeId).toBe("end");
    expect(result.traversedNodeIds).toEqual(["start", "support", "order", "knowledge"]);
    const end = run(starterVisualGraph(), "", result.state);
    expect(end.state.status).toBe("completed");
    expect(end.action.kind).toBe("end");
  });
  it("enters the product subflow only on the order branch", () => {
    const result = run(starterVisualGraph(), "Dua të porosis");
    expect(result.action.kind).toBe("product");
    expect(result.state).toMatchObject({ nodeId: "product", status: "waiting", awaiting: true });
    const waiting = run(starterVisualGraph(), "M", result.state);
    expect(waiting.action.kind).toBe("product");
    const finished = advanceVisualWorkflow({ graph: starterVisualGraph(), versionId: "v1", state: waiting.state, message: "", hasPhoto: false, intent: "order", productComplete: true });
    expect(finished.state.status).toBe("completed");
  });
  it("does not mistake the initial message or one answer for multiple collected fields", () => {
    const graph = linear(node("name", "collect", { prompt: "Emri?", fieldKey: "name" }), node("email", "collect", { prompt: "Email?", fieldKey: "email", fieldType: "email" }));
    const initial = run(graph, "Përshëndetje");
    expect(initial.state.values).toEqual({});
    const next = run(graph, "Ana", initial.state);
    expect(next.action).toMatchObject({ kind: "prompt", nodeId: "email" });
    expect(next.state.values).toEqual({ name: "Ana" });
    expect(initial.state.values).toEqual({});
  });
  it("repeats an invalid email then accepts a corrected email", () => {
    const graph = linear(node("email", "collect", { prompt: "Email?", fieldKey: "email", fieldType: "email" }));
    const initial = run(graph);
    const invalid = run(graph, "ana.example.com", initial.state);
    expect(invalid.state.values).toEqual({});
    expect(invalid.state.nodeId).toBe("email");
    const valid = run(graph, "ana@example.com", invalid.state);
    expect(valid.state.values.email).toBe("ana@example.com");
    expect(valid.state.status).toBe("completed");
  });
  it("requires an attachment for photo fields", () => {
    const graph = linear(node("photo", "collect", { prompt: "Foto?", fieldKey: "photo", fieldType: "photo" }));
    const initial = run(graph);
    const invalid = run(graph, "kam një foto", initial.state);
    expect(invalid.state.values).toEqual({});
    expect(run(graph, "", invalid.state, true).state.values.photo).toBe("photo_received");
  });
  it.each([".......", "(---)--", "123-456"])("refuses invalid phone %s", text => {
    const graph = linear(node("phone", "collect", { prompt: "Telefon?", fieldKey: "phone", fieldType: "phone" }));
    const result = run(graph, text, run(graph).state);
    expect(result.state.status).toBe("waiting");
    expect(result.state.values.phone).toBeUndefined();
  });
  it("accepts a formatted international phone", () => {
    const graph = linear(node("phone", "collect", { prompt: "Telefon?", fieldKey: "phone", fieldType: "phone" }));
    expect(run(graph, "+355 69 123 4567", run(graph).state).state.status).toBe("completed");
  });
  it("requires numeric content and bounds collected text", () => {
    const graph = linear(node("quantity", "collect", { prompt: "Sasia?", fieldKey: "quantity", fieldType: "number" }));
    const initial = run(graph);
    expect(run(graph, "dy", initial.state).state.status).toBe("waiting");
    expect(run(graph, "2", initial.state).state.values.quantity).toBe("2");
    const textGraph = linear(node("name", "collect", { prompt: "Emri?", fieldKey: "name" }));
    expect(run(textGraph, "a".repeat(2001), run(textGraph).state).state.values).toEqual({});
  });
  it("unknown confirmation repeats; no opens correction; yes completes", () => {
    const graph = confirmation();
    const initial = run(graph);
    const email = run(graph, "ana@example.com", initial.state);
    expect(email.state.nodeId).toBe("confirm");
    const unclear = run(graph, "ndoshta", email.state);
    expect(unclear.state.nodeId).toBe("confirm");
    const correction = run(graph, "Jo", unclear.state);
    expect(correction.state.nodeId).toBe("email");
    expect(correction.state.values.email).toBe("ana@example.com");
    const corrected = run(graph, "ana2@example.com", correction.state);
    const confirmed = run(graph, "Po", corrected.state);
    expect(confirmed.state.status).toBe("completed");
    expect(confirmed.state.values.email).toBe("ana2@example.com");
  });
  it("knowledge advances its cursor exactly once before a following question", () => {
    const graph = linear(node("knowledge", "knowledge"), node("email", "collect", { prompt: "Email?", fieldKey: "email", fieldType: "email" }));
    const answer = run(graph, "Përshëndetje");
    expect(answer.action.kind).toBe("knowledge");
    expect(answer.state).toMatchObject({ nodeId: "email", awaiting: false });
    const prompt = run(graph, "", answer.state);
    expect(prompt.action).toMatchObject({ kind: "prompt", nodeId: "email" });
    expect(prompt.state.values).toEqual({});
  });
  it("keeps terminal and handoff states stable and refuses a version mismatch", () => {
    const graph = starterVisualGraph();
    const answer = run(graph, "Sa kushton?");
    const completed = run(graph, "", answer.state);
    expect(run(graph, "Dua të porosis", completed.state).action.kind).toBe("end");
    const handoff = run(graph, "Dua të flas me stafin");
    expect(handoff.state.status).toBe("handoff");
    expect(run(graph, "Po", handoff.state).action.kind).toBe("handoff");
    expect(() => run(graph, "Po", { ...handoff.state, versionId: "other" })).toThrow("workflow_version_mismatch");
  });
});

it("validates canonical phone fields even if the editor field type is text",()=>{
 const graph={version:1 as const,name:"Phone",nodes:[{id:"start",kind:"start" as const,label:"Start",position:{x:0,y:0},config:{}},{id:"phone",kind:"collect" as const,label:"Phone",position:{x:1,y:0},config:{fieldKey:"customer_phone",fieldType:"text" as const,prompt:"Telefoni?"}},{id:"end",kind:"end" as const,label:"End",position:{x:2,y:0},config:{}}],edges:[{id:"e1",source:"start",target:"phone",port:"next" as const},{id:"e2",source:"phone",target:"end",port:"next" as const}]};
 const first=advanceVisualWorkflow({graph,versionId:"v",message:"",hasPhoto:false,intent:"unknown",sharedValues:{}});
 const second=advanceVisualWorkflow({graph,versionId:"v",state:first.state,message:"gabim",hasPhoto:false,intent:"unknown",sharedValues:{}});
 expect(second.state.nodeId).toBe("phone");expect(second.state.values.customer_phone).toBeUndefined();
});
