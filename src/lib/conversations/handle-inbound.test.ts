import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  process: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from }),
}));
vi.mock("./process-agent-turn", () => ({ processAgentTurn: mocks.process }));
vi.mock("@/lib/crypto/tokens", () => ({
  decryptSecret: () => "fake-meta-token",
}));
vi.mock("@/lib/instagram/send", () => ({ sendInstagramText: mocks.send }));
vi.mock("@/lib/instagram/user-profile", () => ({
  fetchInstagramUserProfile: async () => ({
    username: "customer_ig",
    name: "Klient Test",
  }),
}));

import { handleInboundMessage } from "./handle-inbound";
import { emptyState } from "@/lib/workflows/engine";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
const message: NormalizedIncomingMessage = {
  channel: "instagram",
  externalMessageId: "msg-a",
  externalParticipantId: "customer-ig",
  phone: null,
  senderUsername: null,
  senderDisplayName: null,
  text: "Bluzë",
  attachments: [],
  timestamp: new Date("2026-10-03T10:00:00Z"),
  contextMetadata: { instagramAccountId: "ig-a" },
  rawPayload: {},
};
let paused = false;
let auto = true;
let writes: { table: string; operation: string; data: unknown }[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  paused = false;
  auto = true;
  writes = [];
  mocks.process.mockResolvedValue({
    reply: "Përgjigje nga pipeline",
    nextState: { ...emptyState(), step_key: "collect_size" },
    previousResponseId: "resp_new",
    workflowId: "workflow-a",
  });
  mocks.send.mockResolvedValue({ ok: true, messageId: "meta-reply" });
  mocks.from.mockImplementation((table: string) => {
    let op = "select";
    const result = () => ({
      error: null,
      data:
        table === "webhook_events"
          ? op === "select"
            ? null
            : { id: "event-a" }
          : table === "instagram_connections"
            ? {
                id: "connection-a",
                business_id: "business-a",
                ig_user_id: "ig-a",
                access_token_ciphertext: "sealed",
                status: "connected",
              }
            : table === "conversations"
                ? {
                    id: "conversation-a",
                    status: paused ? "paused" : "active",
                    auto_reply: null,
                    openai_previous_response_id: "resp_old",
                  }
                : table === "businesses"
                  ? { auto_reply: auto }
                  : table === "conversation_states"
                    ? { collected: emptyState(), workflow_id: null }
                    : { id: "row-a" },
    });
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: async () => result(),
      single: async () => result(),
      throwOnError: async () => result(),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve),
      insert: (data: unknown) => {
        op = "insert";
        writes.push({ table, operation: op, data });
        return chain;
      },
      update: (data: unknown) => {
        op = "update";
        writes.push({ table, operation: op, data });
        return chain;
      },
      upsert: (data: unknown) => {
        op = "upsert";
        writes.push({ table, operation: op, data });
        return chain;
      },
    };
    return chain;
  });
});
describe("real inbound integration with shared processor", () => {
  it("persists the shared next state and sends its exact reply only from the real transport", async () => {
    await handleInboundMessage(message);
    expect(mocks.process).toHaveBeenCalledWith({
      businessId: "business-a",
      message: "Bluzë",
      hasPhoto: false,
      state: emptyState(),
      previousResponseId: "resp_old",
    });
    expect(writes.some((w) => w.table === "customers")).toBe(false);
    expect(writes).toContainEqual({
      table: "conversation_states",
      operation: "upsert",
      data: expect.objectContaining({
        workflow_id: "workflow-a",
        collected: expect.objectContaining({ step_key: "collect_size" }),
        business_id: "business-a",
      }),
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Përgjigje nga pipeline",
        accountId: "ig-a",
        to: "customer-ig",
      }),
    );
    expect(writes).toContainEqual({
      table: "conversations",
      operation: "update",
      data: expect.objectContaining({
        openai_previous_response_id: "resp_new",
      }),
    });
  });
  it("does not create a CRM customer on first inbound message", async () => {
    // Force new conversation path: open lookup returns null.
    mocks.from.mockImplementation((table: string) => {
      let op = "select";
      let selectCount = 0;
      const result = () => {
        if (table === "webhook_events") {
          return {
            error: null,
            data: op === "select" ? null : { id: "event-a" },
          };
        }
        if (table === "instagram_connections") {
          return {
            error: null,
            data: {
              id: "connection-a",
              business_id: "business-a",
              ig_user_id: "ig-a",
              access_token_ciphertext: "sealed",
              status: "connected",
            },
          };
        }
        if (table === "conversations") {
          selectCount += 1;
          // first open lookup + completed lookup => null; insert returns id
          if (op === "insert") {
            return { error: null, data: { id: "conversation-new" } };
          }
          return { error: null, data: null };
        }
        if (table === "businesses") {
          return { error: null, data: { auto_reply: false } };
        }
        return { error: null, data: { id: "row-a" } };
      };
      const chain = {
        select: vi.fn(() => {
          op = "select";
          return chain;
        }),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        in: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: async () => result(),
        single: async () => result(),
        insert: (data: unknown) => {
          op = "insert";
          writes.push({ table, operation: "insert", data });
          return chain;
        },
        update: (data: unknown) => {
          op = "update";
          writes.push({ table, operation: "update", data });
          return chain;
        },
        upsert: (data: unknown) => {
          op = "upsert";
          writes.push({ table, operation: "upsert", data });
          return chain;
        },
      };
      void selectCount;
      return chain;
    });
    await handleInboundMessage({
      ...message,
      externalMessageId: "msg-new-thread",
    });
    expect(writes.some((w) => w.table === "customers")).toBe(false);
    expect(writes).toContainEqual({
      table: "conversations",
      operation: "insert",
      data: expect.objectContaining({
        customer_id: null,
        instagram_participant_id: "customer-ig",
        participant_username: "customer_ig",
      }),
    });
  });
  it("preserves the paused/auto-off production gate", async () => {
    paused = true;
    await handleInboundMessage(message);
    paused = false;
    auto = false;
    await handleInboundMessage({ ...message, externalMessageId: "second" });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps Meta dashboard synthetic events out of real conversations", async () => {
    await handleInboundMessage({
      ...message,
      contextMetadata: { metaDashboardTest: true },
    });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(writes.every((w) => w.table === "webhook_events")).toBe(true);
  });
  it("ignores repeated Meta dashboard tests with the same mid", async () => {
    let seen = false;
    mocks.from.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: async () =>
          table === "webhook_events" && seen
            ? { error: null, data: { id: "event-existing" } }
            : { error: null, data: null },
        insert: (data: unknown) => {
          seen = true;
          writes.push({ table, operation: "insert", data });
          return chain;
        },
      };
      return chain;
    });
    const synthetic = {
      ...message,
      externalMessageId: "random_mid",
      contextMetadata: { metaDashboardTest: true },
    };
    await handleInboundMessage(synthetic);
    await handleInboundMessage(synthetic);
    expect(writes).toHaveLength(1);
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
