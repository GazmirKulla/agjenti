import { afterEach, beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc }) }));
import { loadWorkflowReadiness } from "./readiness";
beforeEach(() => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "pilot"); vi.stubEnv("CRON_SECRET", "configured");
  rpc.mockResolvedValue({ data: { schemaVersion: 3, scheduled: true, lastSuccessAt: new Date().toISOString() }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("requires tenant activation, schema, a minute schedule and recent successful worker", async () => {
  expect((await loadWorkflowReadiness("pilot")).ready).toBe(true);
  expect((await loadWorkflowReadiness("other")).ready).toBe(false);
  rpc.mockResolvedValue({ data: { schemaVersion: 3, scheduled: false, lastSuccessAt: "2020-01-01T00:00:00Z" }, error: null });
  expect((await loadWorkflowReadiness("pilot")).blockers).toHaveLength(2);
});
it("reports missing migrations without exposing internal errors or secrets", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "private SQL" } });
  const result = await loadWorkflowReadiness("pilot");
  expect(result.ready).toBe(false); expect(JSON.stringify(result)).not.toContain("private SQL");
});
