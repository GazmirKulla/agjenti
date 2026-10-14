import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState } from "@/lib/workflows/engine";
import {
  IsolationViolation,
  snapshotExternalActions,
} from "@/lib/runtime/execution-context";
import { isolatedWithoutAdapters, runIsolated } from "@/lib/runtime/isolated-run";
import { bookingReviewKey, processBookingTurn, type BookingDraft } from "@/lib/calendar/agent";
import { availableSlots, persistBooking } from "@/lib/calendar/service";
import { googleBusy, syncBooking } from "@/lib/calendar/google";
import { sendInstagramText } from "@/lib/instagram/send";
import { enqueueWorkflowMessage } from "@/lib/conversations/workflow-queue";
import { submitConfirmedOrder } from "@/lib/orders/submission";

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  profile: vi.fn(),
  visual: vi.fn(),
  writes: [] as { table: string; method: string; payload?: unknown }[],
  cfg: {
    agent_booking_enabled: true,
    timezone: "Europe/Tirane",
    confirmation_mode: "manual",
    hours: [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" })),
    closed_dates: [] as string[],
  },
  services: [
    {
      id: "service",
      name: "Prerje",
      duration_minutes: 30,
      buffer_minutes: 0,
      is_active: true,
      booking_enabled: true,
      business_id: "business",
      hours: null,
    },
  ],
  connection: {
    id: "connection",
    business_id: "business",
    calendar_id: "calendar@example.com",
    calendar_name: "Studio",
    connected: true,
    access_token_encrypted: "access",
    refresh_token_encrypted: "refresh",
    expires_at: "2000-01-01T00:00:00.000Z",
  },
}));

vi.mock("@/lib/dashboard/profile/service", () => ({
  loadDashboardProfile: mocks.profile,
}));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: mocks.visual }));
vi.mock("@/lib/calendar/agent-parser", () => ({ extractBookingDetails: mocks.extract }));
vi.mock("@/lib/agents/generate", () => ({
  generateAgentReply: vi.fn(async () => ({ reply: "Përgjigje e simuluar", responseId: null, source: "fallback" as const, fallbackReason: "test" })),
  agentModel: () => "test-model",
}));
vi.mock("@/lib/catalogs/retrieval", () => ({ retrieveBusinessSources: vi.fn(async () => ({ context: {}, documents: [], evidence: "" })) }));
vi.mock("@/lib/crypto/tokens", () => ({
  decryptSecret: (value: string) => value,
  encryptSecret: (value: string) => `encrypted-${value}`,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    rpc: (fn: string, payload?: unknown) => {
      mocks.writes.push({ table: "rpc", method: fn, payload });
      return Promise.resolve({ data: null, error: { message: `${fn} blocked` } });
    },
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return chain;
        },
        in: () => chain,
        lt: () => chain,
        gt: () => chain,
        neq: () => chain,
        limit: () => chain,
        throwOnError: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => void, reject?: (error: unknown) => void) =>
          Promise.resolve({
            data: table === "booking_services" ? mocks.services.filter((service) =>
              filters.every(([key, value]) => service[key as keyof typeof service] === value),
            ) : [],
            error: null,
          }).then(resolve, reject),
        order: () => chain,
        maybeSingle: async () => ({
          data:
            table === "google_calendar_connections"
              ? mocks.connection
              : table === "business_calendar_settings"
                ? mocks.cfg
                : null,
          error: null,
        }),
        single: async () => {
          if (table === "booking_services") {
            const match = mocks.services.find((service) =>
              filters.every(([key, value]) => service[key as keyof typeof service] === value),
            );
            return match
              ? { data: match, error: null }
              : { data: null, error: { message: "not found" } };
          }
          if (table === "google_calendar_connections") {
            return { data: { id: mocks.connection.id }, error: null };
          }
          return { data: null, error: { message: "not found" } };
        },
        update: (payload: unknown) => {
          mocks.writes.push({ table, method: "update", payload });
          return chain;
        },
        insert: (payload: unknown) => {
          mocks.writes.push({ table, method: "insert", payload });
          return chain;
        },
        upsert: (payload: unknown) => {
          mocks.writes.push({ table, method: "upsert", payload });
          return chain;
        },
        delete: () => {
          mocks.writes.push({ table, method: "delete" });
          return chain;
        },
      };
      return chain;
    },
  }),
}));

import { processConversationMessage } from "@/lib/conversations/process-conversation-message";

function confirmState() {
  const draft: BookingDraft = {
    serviceId: "service",
    date: "2026-10-15",
    time: "09:00",
    name: "Klienti",
    phase: "confirm",
    nonce: "request-1",
    expires: Date.now() + 600000,
  };
  draft.review = { factsKey: bookingReviewKey("business", draft) };
  return { ...emptyState(), fields: { booking: draft } };
}

function providerFetch(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) =>
    /googleapis|oauth2\.google|graph\.facebook|graph\.instagram|accounts\.google/i.test(String(url)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writes.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00Z"));
  mocks.profile.mockResolvedValue({ enabledModules: ["bookings", "services"] });
  mocks.visual.mockResolvedValue(null);
  mocks.extract.mockResolvedValue({
    bookingIntent: true,
    cancel: false,
    serviceId: "service",
    date: "2026-10-15",
    time: "09:00",
    name: "Klienti",
    contact: null,
  });
  mocks.connection.expires_at = "2000-01-01T00:00:00.000Z";
  mocks.connection.connected = true;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("W6a Chat Lab isolation", () => {
  it("cannot refresh a real Google Calendar token during isolated booking", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const turn = await processBookingTurn({
      businessId: "business",
      message: "Konfirmoj",
      state: confirmState(),
      mode: "test",
    });
    expect(turn?.reply).toContain("Nuk u krijua rezervim real");
    expect(turn?.externalActions?.some((action) => action.kind === "booking.create" && action.disposition === "SIMULATED")).toBe(true);
    expect(providerFetch(fetch)).toEqual([]);
    expect(mocks.writes.filter((write) => write.table === "google_calendar_connections")).toEqual([]);
  });

  it("makes no provider HTTP calls while collecting isolated availability", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const turn = await processBookingTurn({
      businessId: "business",
      message: "Dua rezervim",
      mode: "test",
    });
    expect(turn?.reply).toContain("Konfirmon");
    expect(providerFetch(fetch)).toEqual([]);
    expect(mocks.writes).toEqual([]);
  });

  it("does not mutate business booking or credential records", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await processBookingTurn({
      businessId: "business",
      message: "Konfirmoj",
      state: confirmState(),
      mode: "test",
      conversationKey: "conversation",
    });
    expect(mocks.writes).toEqual([]);
    await runIsolated(() =>
      expect(
        persistBooking("business", {
          serviceId: "service",
          name: "Klienti",
          contact: "",
          start: "2026-10-15T07:00:00Z",
          status: "pending",
          notes: "",
        }),
      ).rejects.toBeInstanceOf(IsolationViolation),
    );
  });

  it("does not perform a real order, booking, payment or staff handoff", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await runIsolated(async () => {
      await expect(submitConfirmedOrder({ businessId: "business", conversationId: "c", userId: "u" })).rejects.toBeInstanceOf(IsolationViolation);
      await expect(sendInstagramText({ accountId: "ig", token: "t", to: "customer", body: "Hi" })).rejects.toBeInstanceOf(IsolationViolation);
      await expect(
        enqueueWorkflowMessage({
          channel: "instagram",
          externalMessageId: "mid",
          externalParticipantId: "user",
          phone: null,
          senderUsername: null,
          senderDisplayName: null,
          text: "hi",
          attachments: [],
          timestamp: new Date(),
          contextMetadata: { instagram_business_account_id: "ig" },
          rawPayload: {},
        }),
      ).rejects.toBeInstanceOf(IsolationViolation);
      expect(snapshotExternalActions().every((action) => action.disposition === "BLOCKED")).toBe(true);
    });
    expect(providerFetch(fetch)).toEqual([]);
  });

  it("exercises the real booking adapter through the conversation coordinator", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const turn = await processConversationMessage({
      businessId: "business",
      message: "Dua rezervim",
      hasPhoto: false,
      mode: "test",
      source: "admin_chat_lab",
    });
    expect(turn.conversationRouting?.process).toBe("booking");
    expect(turn.reply).toContain("Konfirmon");
    expect(turn.externalActions?.some((action) => action.kind === "booking.availability" && action.disposition === "SIMULATED")).toBe(true);
    expect(providerFetch(fetch)).toEqual([]);
    expect(mocks.writes).toEqual([]);
  });

  it("keeps visual booking transitions on the isolated adapter", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { executeVisualTurn } = await import("@/lib/workflows/visual/execute");
    const graph = {
      version: 2 as const,
      name: "Rezervim",
      nodes: [
        { id: "start", kind: "start" as const, label: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "booking", kind: "booking" as const, label: "Rezervim", position: { x: 1, y: 0 }, config: {} },
        { id: "end", kind: "end" as const, label: "End", position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [
        { id: "s", source: "start", target: "booking", port: "next" as const },
        { id: "e", source: "booking", target: "end", port: "next" as const },
      ],
      flows: [{ id: "reservation", kind: "booking" as const, label: "Rezervim", entryNodeId: "booking", nodeIds: ["booking", "end"] }],
    };
    const result = await processConversationMessage({
      businessId: "business",
      message: "Dua rezervim",
      hasPhoto: false,
      mode: "test",
      source: "admin_chat_lab",
      visualPreview: { id: "preview:booking", businessId: "business", graph, createdAt: "2026-10-09T00:00:00Z" },
      bookingTurn: (state) => processBookingTurn({ businessId: "business", message: "Dua rezervim", state, mode: "test", routed: true }),
    });
    expect(result.nextState.visual?.nodeId).toBe("booking");
    expect(result.reply).toMatch(/Konfirmon|Telefoni|datë|orar/i);
    expect(providerFetch(fetch)).toEqual([]);
    expect(executeVisualTurn).toBeTypeOf("function");
  });

  it("does not let a linear preview route into live Google availability", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const state = emptyState();
    state.context = {
      profile: {},
      order: {},
      execution: {
        linear: {
          id: "product",
          versionId: "linear-preview:abc",
          name: "Porosi",
          steps: [{ key: "size", kind: "choice" }],
        },
      },
    };
    const turn = await processConversationMessage({
      businessId: "business",
      message: "Dua rezervim",
      hasPhoto: false,
      mode: "test",
      linearPreview: true,
      state,
    });
    expect(providerFetch(fetch)).toEqual([]);
    expect(mocks.writes).toEqual([]);
    expect(turn.reply).not.toMatch(/u konfirmua|u ruajt rezervim/i);
  });

  it("keeps W1 resume and cancel on isolated booking state", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const first = await processConversationMessage({
      businessId: "business",
      message: "Dua rezervim",
      hasPhoto: false,
      mode: "test",
      source: "admin_chat_lab",
    });
    const paused = structuredClone(first.nextState);
    paused.conversationPaused = true;
    const asked = await processConversationMessage({
      businessId: "business",
      message: "dua te vazhdoj",
      hasPhoto: false,
      mode: "test",
      source: "admin_chat_lab",
      state: paused,
    });
    expect(asked.nextState.processes?.pendingClarification?.kind).toBe("resume_process");
    const cancelled = await processConversationMessage({
      businessId: "business",
      message: "leje fare",
      hasPhoto: false,
      mode: "test",
      source: "admin_chat_lab",
      state: asked.nextState,
    });
    expect(cancelled.conversationRouting?.reason).toMatch(/clarification_cancel/);
    expect(providerFetch(fetch)).toEqual([]);
    expect(mocks.writes).toEqual([]);
  });

  it("keeps W2 confirmation freshness from writing a stale isolated booking", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const stale = confirmState();
    stale.fields.booking.contact = "0692222222";
    const turn = await processBookingTurn({
      businessId: "business",
      message: "Po",
      state: stale,
      mode: "test",
      routed: true,
    });
    expect(turn?.reply).toContain("Konfirmon");
    expect(turn?.reply).not.toContain("Nuk u krijua rezervim real");
    expect(mocks.writes).toEqual([]);
    expect(providerFetch(fetch)).toEqual([]);
  });

  it("rejects a cross-tenant booking confirmation before any provider call", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mocks.services[0].business_id = "other-business";
    const turn = await processBookingTurn({
      businessId: "business",
      message: "Konfirmoj",
      state: confirmState(),
      mode: "test",
      selectedServiceId: "service",
    });
    expect(turn).toBeNull();
    expect(providerFetch(fetch)).toEqual([]);
    expect(mocks.writes).toEqual([]);
    mocks.services[0].business_id = "business";
  });

  it("fails closed when the isolated calendar adapter is missing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await isolatedWithoutAdapters(async () => {
      await expect(availableSlots("business", "service", "2026-10-15")).rejects.toBeInstanceOf(IsolationViolation);
      await expect(googleBusy("business", "2026-10-15T07:00Z", "2026-10-15T08:00Z")).rejects.toBeInstanceOf(IsolationViolation);
      await expect(syncBooking("business", "11111111-1111-4111-8111-111111111111")).rejects.toBeInstanceOf(IsolationViolation);
    });
    expect(providerFetch(fetch)).toEqual([]);
    expect(mocks.writes.filter((write) => write.table === "google_calendar_connections")).toEqual([]);
  });

  it("never reports a simulated booking as a real success", async () => {
    const turn = await processBookingTurn({
      businessId: "business",
      message: "Konfirmoj",
      state: confirmState(),
      mode: "test",
    });
    expect(turn?.reply).toContain("Nuk u krijua rezervim real");
    expect(turn?.reply).not.toMatch(/Rezervimi u konfirmua|Kërkesa u ruajt/);
    expect(turn?.externalActions?.find((action) => action.kind === "booking.create")).toMatchObject({
      disposition: "SIMULATED",
    });
  });

  it("cannot be switched to live by forged state or workflow configuration", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const collected = await processConversationMessage({
      businessId: "business",
      message: "Dua rezervim",
      hasPhoto: false,
      mode: "production",
      source: "admin_chat_lab",
      state: { ...emptyState(), fields: { mode: "production", executionMode: "live" } },
    });
    const turn = await processConversationMessage({
      businessId: "business",
      message: "Konfirmoj",
      hasPhoto: false,
      mode: "production",
      source: "admin_chat_lab",
      state: collected.nextState,
    });
    expect(turn.reply).toContain("Nuk u krijua rezervim real");
    expect(providerFetch(fetch)).toEqual([]);
    expect(mocks.writes).toEqual([]);
  });

  it("blocks repeated and concurrent isolated turns from causing external effects", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const results = await Promise.all([
      processBookingTurn({ businessId: "business", message: "Konfirmoj", state: confirmState(), mode: "test" }),
      processBookingTurn({ businessId: "business", message: "Konfirmoj", state: confirmState(), mode: "test" }),
      processBookingTurn({ businessId: "business", message: "Dua rezervim", mode: "test" }),
    ]);
    expect(results.every((result) => result && !/u konfirmua|u ruajt/.test(result.reply))).toBe(true);
    expect(providerFetch(fetch)).toEqual([]);
    expect(mocks.writes).toEqual([]);
  });

  it("W3 entity corrections stay isolated from provider writes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const state = confirmState();
    state.fields.booking.serviceId = "service";
    const turn = await processConversationMessage({
      businessId: "business",
      message: "Jo, dua orën 10:00",
      hasPhoto: false,
      mode: "test",
      source: "admin_chat_lab",
      state,
    });
    expect(turn.conversationRouting?.process).toBe("booking");
    expect(providerFetch(fetch)).toEqual([]);
    expect(mocks.writes).toEqual([]);
    expect(turn.reply).not.toMatch(/Rezervimi u konfirmua|Kërkesa u ruajt/);
  });
});
