import { beforeEach, expect, it, vi } from "vitest";
import { orderStatusAdapter } from "./order-status";
import { runIsolated } from "@/lib/runtime/isolated-run";
import type { Action } from "./contracts";
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/orders/own-orders", () => ({ ownOrders: read }));
vi.mock("@/lib/capabilities/enforcement", () => ({ requireRuntimeModules: async () => undefined }));
const action: Action = { id: "a", instanceId: "i", stepId: "status", tool: "orders.status", toolVersion: 1, input: {}, inputDigest: "d", status: "prepared" };
const context = { businessId: "b", conversationId: "c", revision: 1, signal: new AbortController().signal };
const identity = { conversationId: "c", instagramConnectionId: "connection", instagramParticipantId: "customer" };
beforeEach(() => read.mockReset());
it("uses only the verified channel identity", async () => {
  read.mockResolvedValue([{ id: "own-order", status: "confirmed", created_at: "today" }]);
  const result = await orderStatusAdapter({ businessId: "b", conversationId: "c", identity }).execute(action, context);
  expect(read).toHaveBeenCalledWith("b", identity); expect(result.status).toBe("succeeded");
});
it("does not expose customer orders without identity, across tenants or in isolated execution", async () => {
  expect((await orderStatusAdapter({ businessId: "b", conversationId: "c" }).execute(action, context)).status).toBe("failed");
  const adapter = orderStatusAdapter({ businessId: "b", conversationId: "c", identity });
  await expect(adapter.execute(action, { ...context, businessId: "foreign" })).rejects.toThrow("effect_scope_mismatch");
  await expect(runIsolated(() => adapter.execute(action, context))).rejects.toThrow("effect_scope_mismatch");
  await runIsolated(() => adapter.simulate!(action)); expect(read).not.toHaveBeenCalled();
});
