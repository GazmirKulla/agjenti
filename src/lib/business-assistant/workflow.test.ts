import { describe, expect, it } from "vitest";
import {
  starterVisualGraph,
  validateVisualGraph,
  upgradeVisualGraph,
} from "@/lib/workflows/visual/model";
import { applyWorkflowOperations, workflowPreview } from "./workflow";
import { readProposal } from "./model";

describe("assistant workflow operations", () => {
  it("inserts a phone question on one branch, preserving unrelated nodes and branches", () => {
    const before = starterVisualGraph();
    const existing = before.edges.find(
      (e) => e.source === "order" && e.port === "yes",
    )!;
    const after = applyWorkflowOperations(
      before,
      JSON.stringify([
        {
          op: "put_node",
          node: {
            id: "phone",
            kind: "collect",
            label: "Telefoni",
            position: { x: 500, y: 300 },
            config: {
              fieldKey: "contact_phone",
              fieldType: "phone",
              prompt: "Cili është numri i telefonit?",
            },
          },
        },
        { op: "put_edge", edge: { ...existing, target: "phone" } },
        {
          op: "put_edge",
          edge: {
            id: "phone_next",
            source: "phone",
            target: existing.target,
            port: "next",
          },
        },
      ]),
    );
    expect(validateVisualGraph(after).errors).toEqual([]);
    expect(after.nodes.filter((n) => n.id !== "phone")).toEqual(before.nodes);
    expect(after.edges.filter((e) => e.source === "support")).toEqual(
      before.edges.filter((e) => e.source === "support"),
    );
    expect(before.nodes.some((n) => n.id === "phone")).toBe(false);
    const diff = workflowPreview(before, after);
    expect(
      diff.fields.some(
        (f) => f.label === "Hap i shtuar" && f.after.includes("Telefoni"),
      ),
    ).toBe(true);
    expect(
      diff.fields.some(
        (f) =>
          f.label === "Hap i ndryshuar" && f.after.includes("Po → Telefoni"),
      ),
    ).toBe(true);
  });
  it("rejects unknown operations, removing start, nonexistent targets and executable node types", () => {
    for (const ops of [
      [],
      [{ op: "delete_business" }],
      [{ op: "remove_node", id: "start" }],
      [{ op: "remove_node", id: "absent" }],
      [{ op: "remove_edge", id: "absent" }],
      [
        {
          op: "put_node",
          node: {
            id: "pay",
            kind: "payment",
            label: "Pay",
            position: { x: 0, y: 0 },
            config: {},
          },
        },
      ],
    ]) {
      expect(() =>
        applyWorkflowOperations(starterVisualGraph(), JSON.stringify(ops)),
      ).toThrow();
    }
  });
  it("requires a valid proposal shape and forbids hiding edits in read or publish", () => {
    expect(
      readProposal({
        action: "workflow_read",
        id: null,
        message: "",
        changes: [],
      }).action,
    ).toBe("workflow_read");
    expect(() =>
      readProposal({
        action: "workflow_publish",
        id: null,
        message: "",
        changes: [{ field: "operations", value: "[]" }],
      }),
    ).toThrow();
  });
});

it("adds a booking flow through explicit operations without changing existing branches", () => {
  const before=starterVisualGraph();
  const after=applyWorkflowOperations(before,JSON.stringify([
    {op:"upgrade"},
    {op:"put_node",node:{id:"booking",kind:"booking",label:"Rezervim",position:{x:800,y:0},config:{}}},
    {op:"put_edge",edge:{id:"booking-end",source:"booking",target:"end",port:"next"}},
    {op:"put_flow",flow:{id:"booking",kind:"booking",label:"Rezervimet",entryNodeId:"booking",nodeIds:["booking"]}},
  ]));
  expect(after.version).toBe(2);
  expect(validateVisualGraph(after).errors).toEqual([]);
  expect(after.edges.filter(e=>e.source!=="booking")).toEqual(before.edges);
  expect(workflowPreview(before,after).fields.some(f=>f.label==="Procesi në qendrën e mesazhit"&&f.after.includes("Rezervimet"))).toBe(true);
});

it("preserves grouped flow definitions when editing a node and requires an explicit replacement entry", () => {
  const grouped=applyWorkflowOperations(starterVisualGraph(),JSON.stringify([{op:"upgrade"}]));
  if(grouped.version!==2) throw new Error("Expected v2");
  const edited=applyWorkflowOperations(grouped,JSON.stringify([{op:"put_node",node:{...grouped.nodes.find(n=>n.id==="product")!,label:"Porosia"}}]));
  expect(edited.version===2&&edited.flows).toEqual(grouped.flows);
  expect(()=>applyWorkflowOperations(grouped,JSON.stringify([{op:"put_flow",flow:{...grouped.flows[0],entryNodeId:"absent"}}]))).toThrow();
});

it("adds a real order-status information flow while preserving every existing process", () => {
  const before = upgradeVisualGraph(starterVisualGraph());
  const after = applyWorkflowOperations(before, JSON.stringify([
    { op: "put_node", node: { id: "order_status", kind: "order_status", label: "Statusi i porosisë", position: { x: 800, y: 200 }, config: {} } },
    { op: "put_edge", edge: { id: "status-end", source: "order_status", target: "end", port: "next" } },
    { op: "put_flow", flow: { id: "order_status", kind: "information", label: "Statusi i porosisë", entryNodeId: "order_status", nodeIds: ["order_status"] } },
  ]));
  expect(validateVisualGraph(after).errors).toEqual([]);
  expect(after.nodes.filter(node => node.id !== "order_status")).toEqual(before.nodes);
  expect(after.edges.filter(edge => edge.source !== "order_status")).toEqual(before.edges);
  expect(after.version === 2 && after.flows.filter(flow => flow.id !== "order_status")).toEqual(before.flows);
  expect(after.nodes.find(node => node.id === "knowledge")?.kind).toBe("knowledge");
  expect(workflowPreview(before, after).fields).toContainEqual(expect.objectContaining({
    label: "Hap i shtuar", after: expect.stringContaining("Lexon vetëm statusin e porosive të klientit të kësaj bisede"),
  }));
});

it("requires a v2 upgrade for order status and still rejects arbitrary executable nodes", () => {
  const node = { id: "status", kind: "order_status", label: "Statusi", position: { x: 0, y: 0 }, config: {} };
  expect(() => applyWorkflowOperations(starterVisualGraph(), JSON.stringify([{ op: "put_node", node }]))).toThrow();
  expect(applyWorkflowOperations(starterVisualGraph(), JSON.stringify([{ op: "upgrade" }, { op: "put_node", node }])).nodes).toContainEqual(node);
  for (const kind of ["payment", "sql", "webhook", "http_request", "order_cancel"]) {
    expect(() => applyWorkflowOperations(upgradeVisualGraph(starterVisualGraph()), JSON.stringify([{ op: "put_node", node: { ...node, kind } }]))).toThrow();
  }
});
