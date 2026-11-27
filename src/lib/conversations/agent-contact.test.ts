import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ reads: {} as Record<string, unknown>, filters: [] as string[], ors: [] as string[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const q: Record<string, unknown> = {};
  for (const k of ["select", "order", "limit"]) q[k] = () => q;
  q.eq = (column: string, value: string) => { m.filters.push(`${table}.${column}=${value}`); return q; };
  q.or = (filter: string) => { m.ors.push(`${table}:${filter}`); return q; };
  q.maybeSingle = () => Promise.resolve({ data: m.reads[table] ?? null, error: null });
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: m.reads[table] ?? [], error: null }).then(resolve);
  return q;
} }) }));
import { readAgentContact } from "./profile";

const business = "53f4a562-15a9-41db-8d20-d73c6da946af", conversation = "e2d6dd69-ca41-4a26-ba45-4df308d3fb04";
const identity = { conversationId: conversation, instagramParticipantId: "1107027658404222", channel: "instagram" as const };
beforeEach(() => { m.reads = {}; m.filters = []; m.ors = []; });

it("gives a returning customer the contact of their latest order, as the Inbox shows it", async () => {
  m.reads = {
    conversations: { customer_id: null, customers: null },
    conversation_profiles: null,
    orders: [{ created_at: "2026-11-27T00:32:48Z", delivery: { name: "Miqail", phone: "0694740420", city: "Durres", address: "Lagja 12" } }],
  };
  expect(await readAgentContact(business, identity)).toEqual({
    name: { value: "Miqail", type: "text" }, phone: { value: "0694740420", type: "phone" },
    city: { value: "Durres", type: "text" }, address: { value: "Lagja 12", type: "text" },
  });
  // Every read stays in this business and this conversation.
  expect(m.filters).toEqual(expect.arrayContaining([`conversations.business_id=${business}`, `conversations.id=${conversation}`, `orders.business_id=${business}`]));
  expect(m.ors).toEqual([`orders:conversation_id.eq.${conversation}`]);
});

it("uses the saved customer of this business, never one linked to another business, and drops malformed values", async () => {
  const customer = "11111111-1111-4111-8111-111111111111";
  m.reads = {
    conversations: { customer_id: customer, customers: { business_id: business, display_name: "Ana Hoxha", phone: "not a phone", created_at: "2026-11-01T00:00:00Z", updated_at: null } },
    orders: [],
  };
  expect(await readAgentContact(business, identity)).toEqual({ name: { value: "Ana Hoxha", type: "text" } });
  expect(m.ors).toEqual([`orders:conversation_id.eq.${conversation},customer_id.eq.${customer}`]);

  m.reads = { conversations: { customer_id: customer, customers: { business_id: "99999999-9999-4999-8999-999999999999", display_name: "Tjetër", phone: "0690000000", created_at: null, updated_at: null } }, orders: [] };
  expect(await readAgentContact(business, identity)).toBeUndefined();
});

it("reads nothing for an identity that is not a conversation id", async () => {
  expect(await readAgentContact(business, { ...identity, conversationId: "x' or 1=1" })).toBeUndefined();
  expect(m.filters).toEqual([]);
});
