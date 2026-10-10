import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  from: vi.fn(),
  slots: vi.fn(),
  persist: vi.fn(),
  queries: [] as { table: string; calls: [string, unknown[]][] }[],
  responses: [] as unknown[],
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: m.from }),
}));
vi.mock("@/lib/calendar/service", () => ({
  availableSlots: m.slots,
  persistBooking: m.persist,
  bookingColumns: "id,revision",
}));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "test" }));
import { encryptSecret } from "@/lib/crypto/tokens";
import {
  searchContext,
  prepareProposal,
  executeTicket,
  openTicket,
  type Access,
  type Ticket,
} from "./service";
const id = "11111111-1111-4111-8111-111111111111";
const access: Access = {
  userId: "user",
  businessId: "business",
  modules: ["products", "services", "knowledge", "settings", "bookings"],
  catalogSource: "internal",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.queries.length = 0;
  m.responses.length = 0;
  process.env.TOKEN_ENCRYPTION_KEY = "assistant-test-only-key";
  m.from.mockImplementation((table: string) => {
    const calls: [string, unknown[]][] = [];
    m.queries.push({ table, calls });
    const result = m.responses.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown) => void) =>
        Promise.resolve(result).then(resolve),
    };
    for (const name of [
      "select",
      "eq",
      "update",
      "insert",
      "returns",
      "maybeSingle",
      "ilike",
      "order",
      "limit",
    ])
      chain[name] = (...args: unknown[]) => {
        calls.push([name, args]);
        return chain;
      };
    return chain;
  });
});
const ticket = (overrides: Partial<Ticket> = {}) =>
  encryptSecret(
    JSON.stringify({
      purpose: "business-assistant-v1",
      userId: access.userId,
      businessId: access.businessId,
      expires: Date.now() + 60000,
      action: "product_update",
      id,
      before: { id, updated_at: "old" },
      values: { price_amount: 45 },
      ...overrides,
    }),
  );
it("rejects tampering, expiry, other tenants/users and disabled modules before database writes", async () => {
  for (const token of [
    ticket() + "x",
    ticket({ businessId: "foreign" }),
    ticket({ userId: "other" }),
    ticket({ expires: Date.now() - 1 }),
  ])
    await expect(executeTicket(access, token)).rejects.toThrow();
  expect(() => openTicket(ticket(), { ...access, modules: [] })).toThrow();
  expect(() =>
    openTicket(ticket(), { ...access, catalogSource: "external" }),
  ).toThrow();
  expect(m.from).not.toHaveBeenCalled();
});
it("scopes row lookup to the tenant and does not prepare missing targets", async () => {
  await expect(
    prepareProposal(
      access,
      {
        action: "product_update",
        id,
        message: "",
        changes: [{ field: "price_amount", value: "45" }],
      },
      "Europe/Tirane",
    ),
  ).rejects.toThrow();
  expect(m.queries[0].calls).toContainEqual([
    "eq",
    ["business_id", "business"],
  ]);
  expect(m.queries[0].calls).toContainEqual(["eq", ["id", id]]);
});
it("prepares a product draft without writing, then inserts only on confirmation", async () => {
  const result = await prepareProposal(
    access,
    {
      action: "product_create",
      id: null,
      message: "Kontrollo",
      changes: [{ field: "name", value: "Barrierë" }],
    },
    "Europe/Tirane",
  );
  expect(m.from).not.toHaveBeenCalled();
  expect(result.preview?.notice).toContain("joaktiv");
  await executeTicket(access, result.token!);
  expect(m.queries[0].calls).toContainEqual([
    "insert",
    [
      expect.objectContaining({
        business_id: "business",
        name: "Barrierë",
        is_active: false,
      }),
    ],
  ]);
});
it("compares the prior version to avoid overwriting changes or replaying an update", async () => {
  await expect(executeTicket(access, ticket())).rejects.toThrow(
    "kanë ndryshuar",
  );
  expect(m.queries[0].calls).toContainEqual([
    "eq",
    ["business_id", "business"],
  ]);
  expect(m.queries[0].calls).toContainEqual(["eq", ["updated_at", "old"]]);
});
it("handles a retried create only when the same generated id already exists in this tenant", async () => {
  m.responses.push({ error: { code: "23505" } }, { data: { id }, error: null });
  await expect(
    executeTicket(access, ticket({ action: "product_create", before: null })),
  ).resolves.toHaveProperty("message");
  expect(m.queries[1].calls).toContainEqual([
    "eq",
    ["business_id", "business"],
  ]);
  expect(m.queries[1].calls).toContainEqual(["eq", ["id", id]]);
  m.responses.push({ error: { code: "23505" } }, { data: null, error: null });
  await expect(
    executeTicket(access, ticket({ action: "product_create", before: null })),
  ).rejects.toThrow();
});
it("cannot directly edit knowledge maintained by services", async () => {
  m.responses.push({ data: { id, intent_key: "service" }, error: null });
  await expect(
    prepareProposal(
      access,
      {
        action: "knowledge_update",
        id,
        message: "",
        changes: [{ field: "body", value: "new" }],
      },
      "Europe/Tirane",
    ),
  ).rejects.toThrow("shërbimin");
});
it("checks availability before preparing an appointment and uses the existing booking writer", async () => {
  m.responses.push({
    data: {
      id,
      name: "Konsultë",
      is_active: true,
      booking_enabled: true,
      duration_minutes: 30,
      updated_at: "v1",
    },
    error: null,
  });
  m.slots.mockResolvedValue([{ start: "2026-10-12T08:00:00.000Z" }]);
  const result = await prepareProposal(
    access,
    {
      action: "booking_create",
      id: null,
      message: "Kontrollo",
      changes: Object.entries({
        service_id: id,
        customer_name: "Arta",
        customer_contact: "0690000000",
        date: "2026-10-12",
        time: "10:00",
      }).map(([field, value]) => ({ field, value })),
    },
    "Europe/Tirane",
  );
  expect(m.persist).not.toHaveBeenCalled();
  m.responses.push({ data: { id, updated_at: "v1" }, error: null });
  m.persist.mockResolvedValue({ booking: { id }, syncError: null });
  await executeTicket(access, result.token!);
  expect(m.persist).toHaveBeenCalledWith(
    "business",
    expect.objectContaining({
      serviceId: id,
      start: "2026-10-12T08:00:00.000Z",
      requestKey: expect.stringMatching(/^assistant:/),
    }),
  );
});
it("rejects unavailable slots and never prepares a write", async () => {
  m.responses.push({
    data: {
      id,
      name: "Konsultë",
      is_active: true,
      booking_enabled: true,
      duration_minutes: 30,
      updated_at: "v1",
    },
    error: null,
  });
  m.slots.mockResolvedValue([]);
  await expect(
    prepareProposal(
      access,
      {
        action: "booking_create",
        id: null,
        message: "",
        changes: Object.entries({
          service_id: id,
          customer_name: "Arta",
          customer_contact: "123",
          date: "2026-10-12",
          time: "10:00",
        }).map(([field, value]) => ({ field, value })),
      },
      "Europe/Tirane",
    ),
  ).rejects.toThrow("nuk është e lirë");
  expect(m.persist).not.toHaveBeenCalled();
});
it("rechecks the service version and reports Google sync failures as saved", async () => {
  const token = ticket({
    action: "booking_update",
    before: { id, revision: 2 },
    serviceVersion: { id, updatedAt: "v1" },
    values: {
      service_id: id,
      customer_name: "Arta",
      customer_contact: "123",
      starts_at: "2026-10-12T08:00:00Z",
      status: "confirmed",
      notes: "",
    },
  });
  m.responses.push({ data: { id, updated_at: "v2" }, error: null });
  await expect(executeTicket(access, token)).rejects.toThrow(
    "Shërbimi ka ndryshuar",
  );
  expect(m.persist).not.toHaveBeenCalled();
  m.responses.push({ data: { id, updated_at: "v1" }, error: null });
  m.persist.mockResolvedValue({ booking: { id }, syncError: "offline" });
  await expect(executeTicket(access, token)).resolves.toMatchObject({
    message: expect.stringContaining("u ruajt, por"),
  });
  expect(m.persist).toHaveBeenCalledWith(
    "business",
    expect.objectContaining({ id, revision: 2 }),
  );
});

it("searches beyond the initial context using tenant-scoped escaped names", async () => {
  m.responses.push({ data: [{ id, name: "Barrierë" }], error: null });
  const result = await searchContext(access, {
    action: "search",
    id: null,
    message: "",
    changes: [
      { field: "kind", value: "product" },
      { field: "query", value: "50%_" },
    ],
  });
  expect(result.rows).toHaveLength(1);
  expect(m.queries[0].calls).toContainEqual([
    "eq",
    ["business_id", "business"],
  ]);
  expect(m.queries[0].calls.find(([name]) => name === "ilike")?.[1][1]).toBe(
    "%50\\%\\_%",
  );
  await expect(
    searchContext(access, {
      action: "search",
      id: null,
      message: "",
      changes: [
        { field: "kind", value: "users" },
        { field: "query", value: "test" },
      ],
    }),
  ).rejects.toThrow();
});
it("rejects records changed while the model was composing a proposal", async () => {
  m.responses.push({
    data: { id, name: "Barrierë", updated_at: "v2" },
    error: null,
  });
  await expect(
    prepareProposal(
      access,
      {
        action: "product_update",
        id,
        message: "",
        changes: [{ field: "price_amount", value: "45" }],
      },
      "Europe/Tirane",
      { id, updated_at: "v1" },
    ),
  ).rejects.toThrow("gjatë analizës");
});

it("routes instruction edits through confirmation with tenant and content version checks", async () => {
  const agentAccess = { ...access, modules: ["agents"] };
  const before = {
    id,
    name: "Shitjet",
    instructions: "Udhëzimet e vjetra",
    updated_at: "v1",
  };
  m.responses.push({ data: before });
  const result = await prepareProposal(
    agentAccess,
    {
      action: "agent_update",
      id,
      message: "Kontrollo",
      changes: [{ field: "instructions", value: "Përgjigju shkurt." }],
    },
    "Europe/Tirane",
  );
  expect(result.preview?.subject).toBe("Shitjet");
  expect(m.queries).toHaveLength(1);
  m.responses.push({ data: { id } });
  expect(await executeTicket(agentAccess, result.token!)).toHaveProperty(
    "path",
    "agents",
  );
  expect(m.queries[1].table).toBe("ai_agents");
  expect(m.queries[1].calls).toContainEqual([
    "eq",
    ["business_id", "business"],
  ]);
  expect(m.queries[1].calls).toContainEqual([
    "eq",
    ["instructions", before.instructions],
  ]);
  await expect(
    executeTicket({ ...agentAccess, modules: [] }, result.token!),
  ).rejects.toThrow();
});
