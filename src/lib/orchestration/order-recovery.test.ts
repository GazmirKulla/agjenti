import { beforeEach, expect, it, vi } from "vitest";
import { orderAdapter } from "./order";
import type { Action } from "./contracts";
import { digest } from "./definition";
const { reads, rpc } = vi.hoisted(() => ({ reads: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc, from: (table: string) => {
  const filters: Record<string, string> = {};
  const chain = { select: () => chain, eq: (key: string, value: string) => { filters[key] = value; return chain; }, maybeSingle: () => reads(table, filters) };
  return chain;
} }) }));
beforeEach(() => { reads.mockReset(); rpc.mockReset(); });
const approval = { waitId: "review", stepId: "confirm", fieldIds: [], factDigest: "digest", eventId: "event", expiresAt: 1 };
const action: Action = { id: "action", instanceId: "instance", stepId: "save", tool: "order.create", toolVersion: 1, status: "unknown", input: {}, inputDigest: digest({}), approval };
const context = { businessId: "business", conversationId: "conversation", revision: 10, signal: new AbortController().signal };
const adapter = () => orderAdapter({ businessId: "business", conversationId: "conversation", lease: { jobId: 1, leaseToken: "lease" }, instance: () => undefined });
it("recovers an expired awaiting-staff review as a historical receipt without creating an order", async () => {
  reads.mockImplementation(async table => ({ data: table === "process_order_reviews" ? { confirmation: { inputDigest: action.inputDigest, approval } } : null, error: null }));
  expect(await adapter().reconcile!(action, context)).toEqual({ status: "succeeded", output: { submissionStatus: "awaiting_staff", localOrderCreated: false, externalOrderSent: false } });
  expect(reads).toHaveBeenCalledWith("process_order_reviews", { business_id: "business", conversation_id: "conversation", action_id: "action" });
  expect(rpc).not.toHaveBeenCalled();
});
it("cannot recover another approval or cross a tenant boundary", async () => {
  reads.mockImplementation(async table => ({ data: table === "process_order_reviews" ? { confirmation: { inputDigest: action.inputDigest, approval: { ...approval, waitId: "other" } } } : null, error: null }));
  expect(await adapter().reconcile!(action, context)).toBeNull();
  reads.mockClear();
  expect(await adapter().reconcile!(action, { ...context, businessId: "foreign" })).toBeNull();
  expect(reads).not.toHaveBeenCalled();
});
it("prefers the actual submitted order over its earlier staff-review receipt", async () => {
  reads.mockResolvedValue({ data: { order_id: "order", status: "accepted", confirmation: { inputDigest: action.inputDigest } }, error: null });
  expect(await adapter().reconcile!(action, context)).toMatchObject({ status: "succeeded", output: { orderId: "order", localOrderCreated: true, externalOrderSent: true } });
  expect(reads).toHaveBeenCalledOnce();
  expect(rpc).not.toHaveBeenCalled();
});
