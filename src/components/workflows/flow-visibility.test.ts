import { expect, it } from "vitest";
import { starterVisualGraph, upgradeVisualGraph } from "@/lib/workflows/visual/model";
import { flowVisibleNodeIds } from "./flow-visibility";

it("shows saved conditions and contact steps before a staff endpoint", () => {
  const graph = upgradeVisualGraph(starterVisualGraph());
  graph.nodes.push(
    { id: "channel", kind: "collect", label: "Kanali", position: { x: 0, y: 0 }, config: {} },
    { id: "whatsapp", kind: "condition", label: "WhatsApp?", position: { x: 0, y: 0 }, config: {} },
    { id: "phone", kind: "collect", label: "Telefon", position: { x: 0, y: 0 }, config: {} },
  );
  graph.edges = graph.edges.map(edge => edge.target === "handoff" ? { ...edge, target: "channel" } : edge);
  graph.edges.push(
    { id: "channel-next", source: "channel", target: "whatsapp", port: "next" },
    { id: "whatsapp-yes", source: "whatsapp", target: "phone", port: "yes" },
    { id: "whatsapp-no", source: "whatsapp", target: "handoff", port: "no" },
    { id: "phone-next", source: "phone", target: "handoff", port: "next" },
  );
  const before = structuredClone(graph);
  const visible = flowVisibleNodeIds(graph, "handoff");
  expect([...visible].sort()).toEqual(["channel", "handoff", "phone", "whatsapp"]);
  expect(visible.has("support")).toBe(false); // Shared router also reaches order/information.
  expect(graph).toEqual(before); // Published definitions and entry points remain pinned.
});
it("keeps another flow out while showing a shared ending and an added owned condition", () => {
  const graph = upgradeVisualGraph(starterVisualGraph());
  graph.nodes.push({ id: "new-condition", kind: "condition", label: "Kusht tjetër", position: { x: 0, y: 0 }, config: {} });
  graph.flows.find(flow => flow.id === "knowledge")!.nodeIds.push("new-condition");
  const visible = flowVisibleNodeIds(graph, "knowledge");
  expect(visible.has("new-condition")).toBe(true);
  expect(visible.has("end")).toBe(true);
  expect(visible.has("product")).toBe(false);
});
