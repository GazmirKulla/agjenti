// Existing scenarios run with the default platform policy: all modules allowed.
vi.mock("@/lib/dashboard/modules/entitlements", async () => {
  const { MODULE_IDS } = await import("@/lib/dashboard/modules/types");
  return { loadAllowedModules: async () => {
    const { loadDashboardProfile } = await import("@/lib/dashboard/profile/service");
    return (await loadDashboardProfile("fixture"))?.enabledModules ?? [...MODULE_IDS];
  }, requireModuleAllowed: async () => {} };
});
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), submit: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/integrations/zana", () => ({ submitExternalOrder: m.submit }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: m.profile }));
import { reconcileOrder, submissionResponse, submitConfirmedOrder, type SubmissionReceipt } from "./submission";
import { initialSnapshot, type Snapshot } from "@/lib/orchestration/contracts";

const productId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000002";
const args = { businessId: "business", conversationId: "conversation", userId: "actor" };
const actionId = "00000000-0000-4000-8000-000000000003";
function confirmed(): Snapshot {
 const s = initialSnapshot(args.businessId, args.conversationId, "live"); s.revision = 7;
 s.instances.order = { id: "order", definitionId: "definition", versionId: "pinned-v1", stepId: "submit", status: "completed", facts: {},
  action: { id: actionId, instanceId: "order", stepId: "submit", tool: "order.create", toolVersion: 1, input: {}, inputDigest: "digest", status: "succeeded", output: { submissionStatus: "awaiting_staff" } } };
 return s;
}
let state = confirmed();
let product: { id: string; product_type_id: string | null; price_amount: number | null; currency: string } | null;
let ledger: (SubmissionReceipt & { confirmation: unknown }) | undefined;
let cart: unknown[];
let revision: number;
let stateStatus: string;
let filters: [string, string, unknown][];
beforeEach(() => {
  vi.resetAllMocks(); state = confirmed(); ledger = undefined; cart = []; revision = 7; filters = []; stateStatus = "ready";
  product = { id: productId, product_type_id: null, price_amount: 19.5, currency: "EUR" };
  m.from.mockImplementation((table: string) => {
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      maybeSingle: async () => ({ data: table === "conversations" ? { id: args.conversationId }
        : table === "linear_workflow_versions" ? { id: "published-linear", steps: [{ key: "size", kind: "text" }, { key: "customer", kind: "customer" }] }
        : table === "conversation_states" ? { collected: structuredClone(state), cart, revision, status: stateStatus }
        : table === "products" ? product : table === "order_submissions" && ledger
          ? { order_id: ledger.orderId, attempt_id: ledger.attemptId, status: ledger.status, external_order_id: ledger.externalOrderId, confirmation: ledger.confirmation } : null, error: null }) };
    return q;
  });
  // Contract double, NOT proof of PostgreSQL concurrency/atomicity. Actual SQL tests
  // live in supabase/tests/order_submission*. They need an isolated migrated DB.
  m.rpc.mockImplementation(async (name: string, input: Record<string, unknown>) => {
    if (name === "submit_process_order") {
      if (ledger) return { data: { ...ledger, dispatch: false } };
      ledger = { orderId, attemptId: "attempt", dispatch: true, status: "pending_reconciliation", confirmation: { id: actionId },
        payload: { channel: "whatsapp", currency: "EUR", totalAmount: 19.5, items: [{ productId, quantity: 1, unitAmount: 19.5 }] } };
      return { data: { ...ledger } };
    }
    ledger = { ...ledger!, status: input.p_status as SubmissionReceipt["status"], externalOrderId: input.p_external as string, dispatch: false };
    return { data: { ...ledger } };
  });
  m.submit.mockResolvedValue({ ok: true, status: "accepted", orderId: "external-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("W4 order submission boundary", () => {
  it("fences owner approval against the state read inside submission, before any dispatch", async () => {
    await expect(submitConfirmedOrder({ ...args, expectedRevision: revision - 1 })).rejects.toMatchObject({ code: "stale_state" });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("refuses legacy confirmations before RPC or external dispatch", async () => {
    state = { schemaVersion: 3 } as unknown as Snapshot;
    await expect(submitConfirmedOrder(args)).rejects.toMatchObject({ code: "confirmation_required" });
    expect(m.rpc).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
  });
  it("submits only once for concurrent identical requests; both callers see the same local order", async () => {
    let finish!: (v: unknown) => void;
    m.submit.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = submitConfirmedOrder(args);
    await vi.waitFor(() => expect(m.submit).toHaveBeenCalledTimes(1));
    const second = await submitConfirmedOrder(args);
    expect(second).toMatchObject({ orderId, status: "pending_reconciliation", dispatch: false });
    finish({ ok: true, status: "accepted", orderId: "external-1" });
    expect(await first).toMatchObject({ orderId, status: "accepted" });
    expect(m.submit).toHaveBeenCalledTimes(1);
  });
  it("concurrent callers use the transactional receipt; only one gets dispatch permission", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => submitConfirmedOrder(args)));
    expect(new Set(results.map(r => r.orderId))).toEqual(new Set([orderId]));
    expect(m.submit).toHaveBeenCalledTimes(1);
    expect(m.rpc.mock.calls.filter(([name]) => name === "submit_process_order")).toHaveLength(8);
  });
  it("sequential replay returns the persisted result without sending again", async () => {
    await submitConfirmedOrder(args);
    expect(await submitConfirmedOrder(args)).toMatchObject({ orderId, status: "accepted", dispatch: false });
    expect(m.submit).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch when item insertion aborts the atomic RPC", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "item_insert_failure" } });
    await expect(submitConfirmedOrder(args)).rejects.toMatchObject({ code: "persistence_unverified", status: 503 });
    expect(ledger).toBeUndefined(); expect(m.submit).not.toHaveBeenCalled();
    expect(m.from.mock.calls.some(([table]) => ["orders", "order_items", "customers"].includes(table))).toBe(false);
  });
  it.each([{}, { status: "unknown", orderId, attemptId: "attempt", dispatch: false }])("never reports success from a malformed RPC receipt %j", async data => {
    m.rpc.mockResolvedValue({ data });
    await expect(submitConfirmedOrder(args)).rejects.toMatchObject({ code: "persistence_unverified" });
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("never sends after a committed RPC response is lost; retry only reads the pending receipt", async () => {
    const normal = m.rpc.getMockImplementation()!;
    m.rpc.mockImplementationOnce(async (name, input) => { await normal(name, input); return { error: { message: "timeout" }, data: null }; });
    await expect(submitConfirmedOrder(args)).rejects.toMatchObject({ status: 503 });
    expect(await submitConfirmedOrder(args)).toMatchObject({ status: "pending_reconciliation", dispatch: false });
    expect(m.submit).not.toHaveBeenCalled();
  });
  it.each(["timeout", "adapter_throw"])("retains UNKNOWN after provider accepted but %s; retry never sends again", async failure => {
    if (failure === "timeout") m.submit.mockResolvedValue({ ok: false, status: "pending_reconciliation" });
    else m.submit.mockRejectedValue(new Error("connection lost after accept"));
    const first = await submitConfirmedOrder(args), second = await submitConfirmedOrder(args);
    expect(first.status).toBe("pending_reconciliation"); expect(second.orderId).toBe(first.orderId);
    expect(submissionResponse(second)).toMatchObject({ status: 202, body: { ok: false, localOrderCreated: true } });
    expect(m.submit).toHaveBeenCalledTimes(1);
  });
  it("keeps uncertainty after final result persistence fails instead of reporting success", async () => {
    const normal = m.rpc.getMockImplementation()!;
    m.rpc.mockImplementation((name, input) => name === "finish_order_submission" ? Promise.resolve({ error: { message: "offline" } }) : normal(name, input));
    expect(submissionResponse(await submitConfirmedOrder(args))).toMatchObject({ status: 202, body: { ok: false } });
    expect((await submitConfirmedOrder(args)).status).toBe("pending_reconciliation");
    expect(m.submit).toHaveBeenCalledTimes(1);
  });
  it("records explicit provider rejection without redelivery", async () => {
    m.submit.mockResolvedValue({ ok: false, status: "rejected" });
    expect(submissionResponse(await submitConfirmedOrder(args))).toMatchObject({ status: 502, body: { ok: false, orderId } });
    expect((await submitConfirmedOrder(args)).status).toBe("rejected"); expect(m.submit).toHaveBeenCalledTimes(1);
  });
  it("supports local-only persistence and forwards the authoritative RPC currency/channel, not defaults", async () => {
    m.submit.mockResolvedValue({ status: "local_only", ok: true, skipped: true });
    expect(submissionResponse(await submitConfirmedOrder(args))).toMatchObject({ status: 200, body: { submissionStatus: "local_only" } });
    expect(m.submit).toHaveBeenCalledWith({ businessId: args.businessId, attemptId: "attempt",
      payload: { channel: "whatsapp", currency: "EUR", totalAmount: 19.5, items: [{ productId, quantity: 1, unitAmount: 19.5 }] } });
    expect(m.rpc).toHaveBeenCalledWith("submit_process_order", expect.objectContaining({ p_user: "actor", p_revision: 7, p_action: actionId }));
  });
  it.each(["foreign_business", "foreign_conversation", "test_mode", "missing_action", "ambiguous_action"])("rejects %s before the transaction", async cause => {
    if(cause === "foreign_business") state.businessId = "foreign";
    if(cause === "foreign_conversation") state.conversationId = "foreign";
    if(cause === "test_mode") state.mode = "test";
    if(cause === "missing_action") delete state.instances.order.action;
    if(cause === "ambiguous_action") state.instances.other = { ...state.instances.order, id: "other", action: { ...state.instances.order.action!, id: "00000000-0000-4000-8000-000000000004" } };
    await expect(submitConfirmedOrder(args)).rejects.toMatchObject({ code: "confirmation_required" });
    expect(m.rpc).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
  });
  it("cannot execute a cancelled state even if a legacy receipt remains", async () => {
    stateStatus = "cancelled";
    await expect(submitConfirmedOrder(args)).rejects.toMatchObject({ code: "confirmation_required" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("enforces module deactivation before dispatch", async () => {
    
    m.profile.mockResolvedValue({ enabledModules: ["products"] });
    await expect(submitConfirmedOrder(args)).rejects.toMatchObject({ code: "module_disabled" });
    expect(m.rpc).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
  });
  it.each(["stale_state", "unauthorized", "module_disabled", "commercial_terms_changed", "product_unavailable"])("handles a transactional %s race without external writes", async code => {
    m.rpc.mockResolvedValue({ error: { message: code } });
    await expect(submitConfirmedOrder(args)).rejects.toMatchObject({ code });
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("preserves the snapshot and submits only the selected server action", async () => {
    const before = structuredClone(state);
    await submitConfirmedOrder({ ...args, actionId });
    expect(m.rpc).toHaveBeenCalledWith("submit_process_order", { p_business: args.businessId, p_conversation: args.conversationId,
      p_revision: 7, p_action: actionId, p_user: args.userId, p_job: null, p_token: null });
    expect(state).toEqual(before);
  });
  it("scopes all receipt/state reads to both business and conversation", async () => {
    await submitConfirmedOrder(args);
    for (const table of ["conversation_states"]) {
      expect(filters).toContainEqual([table, "business_id", args.businessId]);
      expect(filters).toContainEqual([table, "conversation_id", args.conversationId]);
    }
  });
});

describe("W4 staff reconciliation", () => {
  it("requires explicit evidence and external reference, never calls the provider", async () => {
    await expect(reconcileOrder({ ...args, body: { orderId, status: "accepted" } })).rejects.toMatchObject({ status: 400 });
    expect(m.rpc).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
  });
  it("records the authenticated actor and scoped evidence without changing current conversation state", async () => {
    m.rpc.mockResolvedValue({ data: { orderId, attemptId: "attempt", status: "accepted", dispatch: false } });
    await reconcileOrder({ ...args, body: { orderId, status: "accepted", externalOrderId: "provider-verified", evidence: "Verified in provider console with reference provider-verified" } });
    expect(m.rpc).toHaveBeenCalledWith("reconcile_order_submission", expect.objectContaining({ p_business: "business", p_user: "actor", p_conversation: "conversation", p_order: orderId }));
    expect(m.submit).not.toHaveBeenCalled();
  });
  it.each(["unauthorized", "submission_unavailable", "result_conflict", "submission_in_flight"])("cannot bypass %s", async code => {
    m.rpc.mockResolvedValue({ error: { message: code } });
    await expect(reconcileOrder({ ...args, body: { orderId, status: "rejected", evidence: "Provider verified rejection via support ticket" } })).rejects.toMatchObject({ code });
    expect(m.submit).not.toHaveBeenCalled();
  });
});
