import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), version: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: m.version }));
import { hasOrderConfiguration, hasOrderPath, hasSubmissionWorkflow } from "./workflow-readiness";
import { starterVisualGraph, upgradeVisualGraph } from "@/lib/workflows/visual/model";
import { migrateContext } from "@/lib/workflows/context";
import { emptyState } from "@/lib/workflows/engine";
const graph = () => upgradeVisualGraph(starterVisualGraph());
let linear: { id: string; steps: unknown[] } | null;
let queries: [string, unknown][];
let count: number;
beforeEach(() => {
  vi.clearAllMocks(); linear = null; count = 0; queries = [];
  m.version.mockResolvedValue(null);
  m.from.mockImplementation(() => {
    const q = { select: () => q, eq: (k: string, v: unknown) => { queries.push([k, v]); return q; },
      maybeSingle: async () => ({ data: linear, error: null }), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ count, error: null }).then(resolve) };
    return q;
  });
});
it("catalog activity alone does not imply an order workflow; a candidate is configuration, not a grant", async () => {
  expect(await hasOrderConfiguration("tenant")).toBe(false);
  expect(await hasOrderConfiguration("tenant", graph())).toBe(true);
  expect(m.version).toHaveBeenCalledTimes(1);
  expect(queries).toContainEqual(["business_id", "tenant"]);
  expect(queries).toContainEqual(["workflows.business_id", "tenant"]);
});
it("accepts a published general order workflow and a configured legacy workflow", async () => {
  m.version.mockResolvedValue({ id: "published", businessId: "tenant", graph: graph() });
  expect(await hasOrderConfiguration("tenant")).toBe(true);
  m.version.mockResolvedValue(null); count = 1;
  expect(await hasOrderConfiguration("tenant")).toBe(true);
});
it("rejects missing, malformed and informational-only workflow configuration", () => {
  const g = graph(); g.edges = [];
  expect(hasOrderPath(g)).toBe(false);
  const info = graph(); info.nodes.find(n => n.kind === "product")!.kind = "knowledge"; info.flows.find(f => f.kind === "order")!.kind = "information";
  expect(hasOrderPath(info)).toBe(false);
});
it("requires tenant-owned persisted execution evidence; catalog and confirmation alone are insufficient", async () => {
  const s = migrateContext(emptyState()); s.product_id = "product";
  expect(await hasSubmissionWorkflow("tenant", s)).toBe(false);
  s.context!.execution.linear = { id: "workflow", versionId: "pinned-v1", name: "Order", steps: [{ key: "customer", kind: "customer" }] };
  expect(await hasSubmissionWorkflow("tenant", s)).toBe(false);
  linear = { id: "pinned-v1", steps: [{ kind: "customer", key: "customer" }] };
  expect(await hasSubmissionWorkflow("tenant", s)).toBe(true); // JSONB object key ordering is irrelevant.
  expect(queries).toEqual(expect.arrayContaining([["business_id", "tenant"], ["workflow_id", "workflow"], ["id", "pinned-v1"]]));
  linear.steps = [];
  expect(await hasSubmissionWorkflow("tenant", s)).toBe(false);
});
it("preserves immutable visual version pins, but rejects preview, foreign and wrong-product bindings", async () => {
  const s = migrateContext(emptyState()); s.product_id = "00000000-0000-4000-8000-000000000001";
  s.visual = { versionId: "pinned", nodeId: "product", awaiting: true, status: "waiting", visited: ["product"], values: {} };
  m.version.mockResolvedValue({ id: "pinned", businessId: "tenant", graph: graph() });
  expect(await hasSubmissionWorkflow("tenant", s)).toBe(true);
  expect(m.version).toHaveBeenCalledWith("tenant", "pinned");
  const g = graph(); g.flows.find(f => f.kind === "order")!.productIds = ["00000000-0000-4000-8000-000000000002"];
  m.version.mockResolvedValue({ id: "pinned", businessId: "tenant", graph: g });
  expect(await hasSubmissionWorkflow("tenant", s)).toBe(false);
  m.version.mockResolvedValue({ id: "pinned", businessId: "foreign", graph: graph() });
  expect(await hasSubmissionWorkflow("tenant", s)).toBe(false);
  s.visual.versionId = "preview:hash";
  expect(await hasSubmissionWorkflow("tenant", s)).toBe(false);
});
