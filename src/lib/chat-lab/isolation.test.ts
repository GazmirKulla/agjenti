import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runIsolated } from "@/lib/runtime/isolated-run";
import { IsolationViolation, snapshotExternalActions } from "@/lib/runtime/execution-context";
import { initialSnapshot, type Action, type ProcessDefinition } from "@/lib/orchestration/contracts";
import { executePreparedAction, type ToolAdapter } from "@/lib/orchestration/execute";
import { digest } from "@/lib/orchestration/definition";
import { bookingAdapter } from "@/lib/orchestration/booking";
import { orderAdapter } from "@/lib/orchestration/order";
import { businessProvisionAdapter } from "@/lib/orchestration/business-provision";
import { orderStatusAdapter } from "@/lib/orchestration/order-status";
import { processConversationMessage } from "@/lib/conversations/process-conversation-message";
import { emptyState } from "@/lib/workflows/state";
import { persistBooking } from "@/lib/calendar/service";
import { submitConfirmedOrder } from "@/lib/orders/submission";
import { sendInstagramText } from "@/lib/instagram/send";
import type { Environment } from "@/lib/orchestration/transition";
const { database } = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: database }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: async () => null }));
vi.mock("@/lib/orchestration/version-store", async original => ({ ...await original<object>(), loadCurrentLinearVersions: async () => [] }));
beforeEach(() => { database.mockReset(); database.mockImplementation(() => { throw new Error("Unexpected database access"); }); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected provider access"); })); });
afterEach(() => vi.unstubAllGlobals());
const adapters = [bookingAdapter(), orderAdapter(), businessProvisionAdapter(), orderStatusAdapter()];
function fixture(adapter: ToolAdapter) {
  const state = initialSnapshot("business", "conversation", "test");
  const values: Record<string, string> = adapter.key === "business.provision" ? { name: "Test business", email: "test@example.test" } : {};
  const fields = Object.keys(values).map(id => ({ id, subject: "request", label: id, type: "text" as const, required: true }));
  const definition: ProcessDefinition = { id: "request", versionId: "version", businessId: "business", name: "Isolated adapter fixture", purpose: "Exercise isolation only", offerPolicy: "on_request", entry: "effect", fields,
    steps: [{ id: "effect", kind: "effect", tool: adapter.key, toolVersion: 1, inputs: Object.fromEntries(Object.keys(values).map(key => [key, key])), next: "done", failed: "done" }, { id: "done", kind: "end", label: "Done" }] };
  const action: Action = { id: "action", instanceId: "instance", stepId: "effect", tool: adapter.key, toolVersion: 1, input: values, inputDigest: digest(values), status: "prepared" };
  state.instances.instance = { id: "instance", definitionId: "request", versionId: "version", stepId: "effect", status: "waiting_effect",
    facts: Object.fromEntries(Object.entries(values).map(([fieldId, value]) => [fieldId, { fieldId, subject: "request", value, evidence: "fixture", eventId: "event", revision: 0 }])), action };
  const env: Environment = { mode: "test", now: Date.now(), promptTtlMs: 1000, definitions: [definition], startableVersionIds: new Set(["version"]),
    tools: [{ key: adapter.key, version: 1, effect: adapter.key === "orders.status" ? "read" : "write", approval: "none", allowed: true, inputs: fields.map(f => ({ key: f.id, type: f.type, required: true })) }] };
  return { state, env, instanceId: "instance", actionId: "action", adapters: [adapter], deadline: Date.now() + 5000,
    store: { claim: vi.fn(async (snapshot: typeof state) => ({ state: snapshot, replayed: false })), finish: vi.fn(async () => {}) } };
}
it.each(adapters)("simulates $key through the shared executor without business reads, writes or provider calls", async adapter => {
  await runIsolated(async () => {
    const result = await executePreparedAction(fixture(adapter));
    expect(result.state.instances.instance.action?.status).toBe("simulated");
    expect(snapshotExternalActions().some(action => action.disposition === "SIMULATED")).toBe(true);
  });
  expect(database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it.each(adapters)("cannot call the live $key adapter from an isolated session", async adapter => {
  const input = fixture(adapter), action = input.state.instances.instance.action!;
  await runIsolated(() => expect(adapter.execute(action, { businessId: "business", conversationId: "conversation", revision: 0, signal: new AbortController().signal })).rejects.toThrow("effect_scope_mismatch"));
  expect(database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("blocks a forged live snapshot entering through Chat Lab before any business access", async () => {
  await expect(processConversationMessage({ businessId: "business", message: "Proceed", hasPhoto: false, mode: "production", source: "admin_chat_lab",
    state: { ...emptyState(), runtime: initialSnapshot("business", "conversation", "live") } })).rejects.toThrow("event_scope_mismatch");
  expect(database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("cannot switch a sealed test snapshot to live execution", async () => {
  const input = fixture(adapters[0]); input.env.mode = "live";
  await expect(executePreparedAction(input)).rejects.toThrow("execution_mode_mismatch");
  expect(input.store.claim).not.toHaveBeenCalled(); expect(database).not.toHaveBeenCalled();
});
it("isolates repeated concurrent simulations from all providers", async () => {
  await Promise.all(Array.from({ length: 8 }, () => runIsolated(() => executePreparedAction(fixture(adapters[0])))));
  expect(database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("protects direct domain writers even if a caller bypasses the coordinator", async () => {
  await runIsolated(async () => {
    await expect(persistBooking("business", { serviceId: "service", name: "Customer", contact: "", start: "2026-11-10T10:00:00Z", status: "pending", notes: "" })).rejects.toBeInstanceOf(IsolationViolation);
    await expect(submitConfirmedOrder({ businessId: "business", conversationId: "conversation", userId: "user" })).rejects.toBeInstanceOf(IsolationViolation);
    await expect(sendInstagramText({ accountId: "account", token: "synthetic", to: "customer", body: "Message" })).rejects.toBeInstanceOf(IsolationViolation);
  });
  expect(database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
