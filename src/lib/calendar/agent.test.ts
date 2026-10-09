import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState } from "@/lib/workflows/engine";
const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  slots: vi.fn(),
  persist: vi.fn(),
  profile: vi.fn(),
  visual: vi.fn(),
  cfg: {
    agent_booking_enabled: true,
    timezone: "Europe/Tirane",
    confirmation_mode: "manual",
  },
  services: [
    {
      id: "service",
      name: "Prerje",
      duration_minutes: 30,
      buffer_minutes: 0,
      is_active: true,
    },
  ],
}));
vi.mock("./agent-parser", () => ({ extractBookingDetails: mocks.extract }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: mocks.visual }));
vi.mock("./service", () => ({
  availableSlots: mocks.slots,
  persistBooking: mocks.persist,
}));
vi.mock("@/lib/dashboard/profile/service", () => ({
  loadDashboardProfile: mocks.profile,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: async () => ({ data: mocks.services }),
        maybeSingle: async () => ({ data: mocks.cfg }),
      };
      return chain;
    },
  }),
}));
import {
  explicitBookingConfirmation,
  processBookingTurn,
  type BookingDraft,
} from "./agent";
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00Z"));
  mocks.cfg.agent_booking_enabled = true;
  mocks.cfg.confirmation_mode = "manual";
  mocks.profile.mockResolvedValue({ enabledModules: ["bookings"] });
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
  mocks.slots.mockResolvedValue([
    {
      start: "2026-10-15T07:00:00Z",
      end: "2026-10-15T07:30:00Z",
      blockedUntil: "2026-10-15T07:30:00Z",
    },
  ]);
  mocks.persist.mockResolvedValue({
    booking: { status: "pending" },
    syncError: null,
  });
});
afterEach(() => vi.useRealTimers());
const confirmState = () => ({
  ...emptyState(),
  fields: {
    booking: {
      serviceId: "service",
      date: "2026-10-15",
      time: "09:00",
      name: "Klienti",
      phase: "confirm",
      nonce: "request-1",
      expires: Date.now() + 600000,
    } satisfies BookingDraft,
  },
});
it.each(["running", "waiting", "handoff"] as const)("does not interrupt a %s visual workflow", async (status) => {
  const state = { ...emptyState(), visual: { versionId: "version", nodeId: "collect", status, visited: ["collect"], values: {}, awaiting: true } };
  expect(await processBookingTurn({ businessId: "business", message: "dua rezervim", state })).toBeNull();
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(mocks.persist).not.toHaveBeenCalled();
});
it("routes new booking requests through the published visual graph", async () => {
  mocks.visual.mockResolvedValue({ id: "published-version" });
  expect(await processBookingTurn({ businessId: "business", message: "dua rezervim" })).toBeNull();
  expect(mocks.extract).not.toHaveBeenCalled();
});
it("finishes an existing booking when a visual graph is newly published", async () => {
  mocks.visual.mockResolvedValue({ id: "published-version" });
  const turn = await processBookingTurn({ businessId: "business", message: "konfirmoj", state: confirmState(), mode: "test" });
  expect(turn?.reply).toContain("Nuk u krijua rezervim real");
  expect(mocks.persist).not.toHaveBeenCalled();
});
it("requires exact customer confirmation, not instructions from an AI parse", async () => {
  expect(explicitBookingConfirmation("po konfirmoj")).toBe(true);
  expect(explicitBookingConfirmation("po por ora 10")).toBe(false);
  const turn = await processBookingTurn({
    businessId: "business",
    message: "dua rezervim",
    conversationKey: "conversation",
  });
  expect(turn?.reply).toContain("Konfirmon");
  expect(mocks.persist).not.toHaveBeenCalled();
});
it("creates a pending request when business approval is required", async () => {
  const turn = await processBookingTurn({
    businessId: "business",
    message: "Konfirmoj",
    state: confirmState(),
    conversationKey: "conversation",
  });
  expect(mocks.persist).toHaveBeenCalledWith(
    "business",
    expect.objectContaining({
      status: "pending",
      requestKey: "ig:conversation:request-1",
    }),
  );
  expect(turn?.reply).toContain("ende nuk është konfirmuar");
});
it("creates a confirmed booking only in explicitly enabled automatic mode", async () => {
  mocks.cfg.confirmation_mode = "automatic";
  mocks.persist.mockResolvedValue({ booking: { status: "confirmed" } });
  await processBookingTurn({
    businessId: "business",
    message: "Po",
    state: confirmState(),
    conversationKey: "conversation",
  });
  expect(mocks.persist).toHaveBeenCalledWith(
    "business",
    expect.objectContaining({ status: "confirmed" }),
  );
});
it("test chat confirmation cannot write any reservation", async () => {
  const turn = await processBookingTurn({
    businessId: "business",
    message: "Konfirmoj",
    state: confirmState(),
    mode: "test",
  });
  expect(turn?.reply).toContain("Nuk u krijua rezervim real");
  expect(mocks.persist).not.toHaveBeenCalled();
});
it("fails closed when availability is unavailable", async () => {
  mocks.slots.mockRejectedValue(new Error("Google offline"));
  const turn = await processBookingTurn({
    businessId: "business",
    message: "dua rezervim",
  });
  expect(turn?.reply).toContain("Nuk u verifikua");
  expect(mocks.persist).not.toHaveBeenCalled();
});
it("does not commandeer a product order or disabled booking business", async () => {
  expect(
    await processBookingTurn({
      businessId: "business",
      message: "rezervim",
      state: { ...emptyState(), product_id: "product" },
    }),
  ).toBeNull();
  mocks.cfg.agent_booking_enabled = false;
  expect(
    await processBookingTurn({ businessId: "business", message: "rezervim" }),
  ).toBeNull();
  expect(mocks.extract).not.toHaveBeenCalled();
});
it("rejects expired confirmation without a write", async () => {
  const state = confirmState();
  state.fields.booking.expires = Date.now() - 1;
  const turn = await processBookingTurn({
    businessId: "business",
    message: "Po",
    state,
    conversationKey: "conversation",
  });
  expect(turn?.reply).toContain("skadoi");
  expect(mocks.persist).not.toHaveBeenCalled();
});
