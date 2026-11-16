import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/crypto/tokens", () => ({ decryptSecret: () => "fixture-token" }));
vi.mock("./confirmation", () => ({ confirmMarketingWithdrawal: vi.fn() }));
vi.mock("@/lib/conversations/channel", () => ({ channelAdapter: () => ({ table: "instagram_connections", account: "ig_user_id", send: mocks.send }) }));
import { runCampaignQueue } from "./worker";
const claim = { id: "recipient", token: "lease", participant_id: "customer", body: "Owner-approved text", channel: "instagram" };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.from.mockImplementation((table: string) => {
    const result = { data: table === "marketing_campaigns" ? [{ id: "campaign", business_id: "business", channel: "instagram" }] : table === "marketing_campaign_recipients" ? [{ id: "recipient", connection_id: "connection", participant_id: "customer" }] : table === "instagram_connections" ? { id: "connection", access_token_ciphertext: "encrypted", ig_user_id: "account" } : [], error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "order", "limit", "update"]) builder[method] = () => builder;
    builder.maybeSingle = () => Promise.resolve(result);
    builder.then = (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "begin_marketing_send" ? claim : null, error: null }));
  mocks.send.mockResolvedValue({ ok: true, messageId: "provider-id", parts: [{ status: "sent" }] });
});
afterEach(() => vi.useRealTimers());
async function run() { const promise = runCampaignQueue("business"); await vi.runAllTimersAsync(); await promise; }
describe("campaign external-send boundary", () => {
  it("sends only a claimed frozen body through the standard channel transport", async () => {
    await run();
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ accountId: "account", token: "fixture-token", to: "customer", body: "Owner-approved text" });
    expect(mocks.rpc).toHaveBeenCalledWith("finish_marketing_send", { p_recipient: "recipient", p_token: "lease", p_status: "sent", p_external: "provider-id", p_reason: null });
  });
  it("does not contact the provider when the atomic check declines the recipient", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await run(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps a timeout uncertain and never retries it", async () => {
    mocks.send.mockRejectedValue(new Error("timeout"));
    await run(); expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("finish_marketing_send", expect.objectContaining({ p_status: "uncertain", p_external: null }));
  });
  it("pauses on a revoked token through the durable finish boundary", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "token_revoked", parts: [{ status: "failed" }] });
    await run(); expect(mocks.rpc).toHaveBeenCalledWith("finish_marketing_send", expect.objectContaining({ p_status: "failed", p_reason: "token_revoked" }));
  });
  it("does not treat a receipt-write failure as permission to send again", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "begin_marketing_send" ? claim : null, error: name === "finish_marketing_send" ? { message: "database offline" } : null }));
    await expect(runCampaignQueue("business")).rejects.toThrow("campaign_receipt_unavailable");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
