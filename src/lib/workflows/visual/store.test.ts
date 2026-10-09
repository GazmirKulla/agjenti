import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("@/lib/discovery/load-process", () => ({ loadBusinessProcess: m.process }));
import { loadVisualVersion, loadVisualWorkspace } from "./store";
import { starterVisualGraph } from "./model";

type Result = { data: unknown; error: { code?: string; message?: string } | null };
const fixtures: Record<string, Result> = {};
let queries: { table: string; filters: [string, unknown][] }[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  fixtures.visual_workflows = { data: { enabled: true, published_version_id: "v2", revision: 3, draft: starterVisualGraph() }, error: null };
  fixtures.visual_workflow_versions = { data: { id: "v1", graph: starterVisualGraph(), created_at: "2026-10-10" }, error: null };
  m.process.mockResolvedValue({ process: null });
  m.from.mockImplementation((table: string) => {
    const query = { table, filters: [] as [string, unknown][] };
    queries.push(query);
    const chain = { select: () => chain, eq: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; }, maybeSingle: async () => fixtures[table] };
    return chain;
  });
});

describe("visual workflow storage reads", () => {
  it("pins a conversation to a version using both tenant and version filters", async () => {
    const version = await loadVisualVersion("business-a", "v1");
    expect(version).toMatchObject({ id: "v1", businessId: "business-a" });
    expect(queries).toEqual([{ table: "visual_workflow_versions", filters: [["business_id", "business-a"], ["id", "v1"]] }]);
  });
  it("fails when the pinned version is unavailable instead of choosing the current version", async () => {
    fixtures.visual_workflow_versions = { data: null, error: null };
    await expect(loadVisualVersion("business-a", "foreign-version")).rejects.toThrow("nuk është i disponueshëm");
    expect(queries).toHaveLength(1);
  });
  it("loads the current enabled publication through the same tenant filter", async () => {
    fixtures.visual_workflow_versions.data = { id: "v2", graph: starterVisualGraph(), created_at: "2026-10-10" };
    expect(await loadVisualVersion("business-a")).toHaveProperty("id", "v2");
    expect(queries).toEqual([
      { table: "visual_workflows", filters: [["business_id", "business-a"]] },
      { table: "visual_workflow_versions", filters: [["business_id", "business-a"], ["id", "v2"]] },
    ]);
  });
  it("starts no workflow when disabled, but still loads a previously pinned run", async () => {
    fixtures.visual_workflows.data = { enabled: false, published_version_id: "v2" };
    expect(await loadVisualVersion("business-a")).toBeNull();
    expect(queries).toHaveLength(1);
    expect(await loadVisualVersion("business-a", "v1")).toHaveProperty("id", "v1");
  });
  it("returns an unavailable starter when migrations are missing", async () => {
    fixtures.visual_workflows = { data: null, error: { code: "42P01" } };
    expect(await loadVisualVersion("business-a")).toBeNull();
    const workspace = await loadVisualWorkspace("business-a");
    expect(workspace).toMatchObject({ revision: 0, enabled: false, available: false, generated: true });
    expect(m.process).toHaveBeenCalledWith("business-a");
  });
  it("refuses invalid stored drafts and invalid published graphs", async () => {
    fixtures.visual_workflows.data = { draft: {} };
    await expect(loadVisualWorkspace("business-a")).rejects.toThrow("Drafti");
    fixtures.visual_workflow_versions.data = { id: "v1", graph: { ...starterVisualGraph(), edges: [] } };
    await expect(loadVisualVersion("business-a", "v1")).rejects.toThrow("nuk është e vlefshme");
  });
  it("does not disguise operational database errors as an absent workflow", async () => {
    fixtures.visual_workflows = { data: null, error: { code: "08006", message: "connection failed" } };
    await expect(loadVisualVersion("business-a")).rejects.toThrow();
    await expect(loadVisualWorkspace("business-a")).rejects.toThrow();
  });
});
