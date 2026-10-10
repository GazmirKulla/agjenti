import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrateContext, setFact } from "@/lib/workflows/context";
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
      booking_enabled: true,
      business_id: "business",
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
      const filters: [string, unknown][] = [];
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
        order: async () => ({ data: mocks.services.filter(service => filters.every(([key, value]) => service[key as keyof typeof service] === value)) }),
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
  mocks.services = [{ id: "service", name: "Prerje", duration_minutes: 30, buffer_minutes: 0, is_active: true, booking_enabled: true, business_id: "business" }];
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
    booking: { id:"booking-1",service_id:"service",service_name:"Prerje",customer_name:"Klienti",customer_contact:"",starts_at:"2026-10-15T07:00:00Z",status:"pending" },
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
    undefined,
  );
  expect(turn?.reply).toContain("ende nuk është konfirmuar");
});
it("creates a confirmed booking only in explicitly enabled automatic mode", async () => {
  mocks.cfg.confirmation_mode = "automatic";
  mocks.persist.mockResolvedValue({ booking: { id:"booking-1",service_id:"service",service_name:"Prerje",customer_name:"Klienti",customer_contact:"",starts_at:"2026-10-15T07:00:00Z",status:"confirmed" } });
  await processBookingTurn({
    businessId: "business",
    message: "Po",
    state: confirmState(),
    conversationKey: "conversation",
  });
  expect(mocks.persist).toHaveBeenCalledWith(
    "business",
    expect.objectContaining({ status: "confirmed" }),
    undefined,
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


it("preserves an explicit booking recipient and contact instead of overwriting them from profile", async () => {
  const state=migrateContext(confirmState());
  setFact(state,"customer_name","Ana","text","prior_order");
  setFact(state,"customer_phone","+355691234567","phone","prior_order");
  const draft=state.fields.booking as BookingDraft;
  draft.name="Bora"; draft.contact="+355699876543";
  const turn=await processBookingTurn({businessId:"business",message:"Konfirmoj",state,conversationKey:"conversation"});
  expect(mocks.persist).toHaveBeenCalledWith("business",expect.objectContaining({name:"Bora",contact:"+355699876543"}),undefined);
  expect(turn?.nextState.context?.profile.name?.value).toBe("Ana");
  expect(turn?.nextState.context?.profile.phone?.value).toBe("+355691234567");
});

it("seeds missing booking contact from shared profile without promoting another person's name", async () => {
  const state=migrateContext(emptyState());
  setFact(state,"customer_name","Ana","text","prior_order");
  setFact(state,"customer_phone","+355691234567","phone","prior_order");
  mocks.extract.mockResolvedValue({bookingIntent:true,cancel:false,serviceId:"service",date:"2026-10-15",time:"09:00",name:null,contact:null});
  const turn=await processBookingTurn({businessId:"business",message:"Dua rezervim",state,mode:"test"});
  expect(turn?.nextState.fields.booking).toMatchObject({name:"Ana",contact:"+355691234567",phase:"confirm"});
  expect(mocks.persist).not.toHaveBeenCalled();
});

it("reports the persisted booking when a replay returns details different from a later draft", async () => {
  const state=confirmState();
  state.fields.booking.time="11:00"; state.fields.booking.name="Bora";
  const turn=await processBookingTurn({businessId:"business",message:"Konfirmoj",state,conversationKey:"conversation"});
  expect(turn?.reply).toContain("09:00");
  expect(turn?.reply).toContain("Klienti");
  expect(turn?.reply).toContain("ndryshimet e fundit nuk u aplikuan");
  expect(turn?.reply).not.toContain("11:00");
  expect(turn?.nextState.fields.booking).toBeUndefined();
});

it.each(["stale_state","ownership_lost","lease_lost","invalid_conversation","workflow_booking_guard_unavailable"])("rethrows %s so the queue can reconcile safely", async error => {
  mocks.persist.mockRejectedValue(new Error(error));
  await expect(processBookingTurn({businessId:"business",message:"Konfirmoj",state:confirmState(),conversationKey:"conversation"})).rejects.toThrow(error);
});

it("retains the confirmation and nonce when a write response is uncertain", async () => {
  mocks.persist.mockRejectedValue(new Error("Temporary timeout"));
  const turn=await processBookingTurn({businessId:"business",message:"Konfirmoj",state:confirmState(),conversationKey:"conversation"});
  expect(turn?.nextState.fields.booking).toMatchObject({phase:"confirm",nonce:"request-1",time:"09:00"});
  expect(turn?.reply).toContain("sërish konfirmimin");
});

it("seeds the bound service and keeps it through collection and confirmation", async () => {
  mocks.services.push({ ...mocks.services[0], id: "other-service", name: "Ngjyrosje" });
  mocks.extract.mockResolvedValue({ bookingIntent: true, cancel: false, serviceId: null, date: "2026-10-15", time: null, name: "Klienti", contact: null });
  const first = await processBookingTurn({ businessId: "business", message: "Dua më 15 tetor", routed: true, selectedServiceId: "service" });
  expect(first?.nextState.fields.booking).toMatchObject({ serviceId: "service", date: "2026-10-15", phase: "collect" });
  expect(first?.reply).not.toContain("Cilin shërbim");
  expect(mocks.extract.mock.calls[0][1].map((service: { id: string }) => service.id)).toEqual(["service"]);
  expect(mocks.slots).toHaveBeenCalledWith("business", "service", "2026-10-15");

  mocks.extract.mockResolvedValue({ bookingIntent: true, cancel: false, serviceId: null, date: null, time: "09:00", name: null, contact: null });
  const second = await processBookingTurn({ businessId: "business", message: "09:00", state: first!.nextState, routed: true, selectedServiceId: "service" });
  expect(second?.nextState.fields.booking).toMatchObject({ serviceId: "service", time: "09:00", phase: "confirm" });
  expect(second?.reply).toContain("Konfirmon Prerje");
  expect(mocks.persist).not.toHaveBeenCalled();
  const guard = { jobId: 1, leaseToken: "lease", conversationId: "conversation", revision: 1 };
  await processBookingTurn({ businessId: "business", message: "Konfirmoj", state: second!.nextState, routed: true, selectedServiceId: "service", conversationKey: "conversation", bookingGuard: guard });
  expect(mocks.persist).toHaveBeenCalledOnce();
  expect(mocks.persist).toHaveBeenCalledWith("business", expect.objectContaining({ serviceId: "service", name: "Klienti" }), guard);
});

it.each([
  { name: "missing", override: null },
  { name: "inactive", override: { is_active: false } },
  { name: "not bookable", override: { booking_enabled: false } },
  { name: "another business", override: { business_id: "other-business" } },
])("rejects a $name bound service before a confirmation can write", async ({ override }) => {
  if (override) mocks.services.push({ ...mocks.services[0], id: "unavailable-service", ...override });
  const state = confirmState();
  state.fields.booking.serviceId = "unavailable-service";
  const original = structuredClone(state);
  expect(await processBookingTurn({ businessId: "business", message: "Konfirmoj", state, selectedServiceId: "unavailable-service", conversationKey: "conversation" })).toBeNull();
  expect(state).toEqual(original);
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(mocks.slots).not.toHaveBeenCalled();
  expect(mocks.persist).not.toHaveBeenCalled();
});

it("does not silently replace an existing booking with another bound service", async () => {
  mocks.services.push({ ...mocks.services[0], id: "other-service", name: "Ngjyrosje" });
  const state = confirmState();
  const original = structuredClone(state);
  const result = await processBookingTurn({ businessId: "business", message: "Konfirmoj", state, selectedServiceId: "other-service", conversationKey: "conversation" });
  expect(result).toBeNull();
  expect(state).toEqual(original);
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(mocks.slots).not.toHaveBeenCalled();
  expect(mocks.persist).not.toHaveBeenCalled();
});
