import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: vi.fn() }));
import { flowChoices } from "./choices";
import type { VisualGraphV2 } from "./types";
const graph: VisualGraphV2 = { version: 2, name: "Business", nodes: [{ id: "info", kind: "knowledge", label: "Informacion", config: {}, position: { x: 0, y: 0 } }], edges: [], flows: [{ id: "support", label: "Ndihma", kind: "information", entryNodeId: "info", nodeIds: ["info"], productIds: ["product"] }] };
it("shows saved draft flows without pretending that their product assignments are live", () => {
  expect(flowChoices(graph, null, false)).toEqual([expect.objectContaining({ id: "support", status: "Draft", inDraft: true, productIds: ["product"], publishedProductIds: [], steps: [{ key: "info", label: "Informacion" }] })]);
});
it("retains published scopes removed from the draft and distinguishes disabled publication", () => {
  const choices = flowChoices({ ...graph, flows: [] }, graph, false);
  expect(choices[0]).toMatchObject({ inDraft: false, status: "Publikuar · joaktiv", publishedProductIds: ["product"], productIds: [] });
  expect(flowChoices(graph, graph, true)[0].status).toBe("Aktiv");
});
it("does not invent a saved flow for an empty workspace", () => expect(flowChoices(null, null, false)).toEqual([]));
