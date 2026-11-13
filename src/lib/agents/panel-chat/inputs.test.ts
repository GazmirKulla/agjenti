import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => { throw new Error("no live database in tests"); } }));
import { applyPanelInputs, readPanelInputs } from "./inputs";

function fakeDb(conversation: unknown) {
  const updates: { table: string; payload: unknown; filters: unknown[][] }[] = [];
  const from = (table: string) => {
    const call = { table, payload: undefined as unknown, filters: [] as unknown[][] };
    const builder: Record<string, unknown> = {
      select: () => builder, eq: (...args: unknown[]) => { call.filters.push(args); return builder; },
      update: (payload: unknown) => { call.payload = payload; updates.push(call); return builder; },
      maybeSingle: () => Promise.resolve({ data: conversation, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return builder;
  };
  return { db: { from } as never, updates };
}
const scope = { businessId: "biz", userId: "admin", streamId: "stream" };

describe("Real chat inputs", () => {
  it("accepts a valid Instagram account and name, and refuses invalid ones", () => {
    expect(readPanelInputs({ message: "x", senderInstagram: " @Dyqani.AL ", customerName: " Ana " })).toEqual({ senderInstagram: "dyqani.al", customerName: "Ana" });
    expect(readPanelInputs({ message: "x", senderInstagram: "" })).toEqual({});
    expect(readPanelInputs({ senderInstagram: "not a user!" })).toHaveProperty("error");
    expect(readPanelInputs({ customerName: "x".repeat(81) })).toHaveProperty("error");
    expect(readPanelInputs({ senderInstagram: 5 })).toHaveProperty("error");
  });
  it("gives the chat and its customer the name and Instagram account", async () => {
    const { db, updates } = fakeDb({ id: "conv", customer_id: "cust" });
    await expect(applyPanelInputs(scope, { senderInstagram: "dyqani.al" }, db)).resolves.toBe(true);
    expect(updates.find(u => u.table === "conversations")?.payload).toEqual({ participant_username: "dyqani.al", participant_display_name: "@dyqani.al" });
    expect(updates.find(u => u.table === "customers")?.payload).toEqual({ username: "dyqani.al", display_name: "@dyqani.al" });
    const named = fakeDb({ id: "conv", customer_id: "cust" });
    await applyPanelInputs(scope, { senderInstagram: "dyqani.al", customerName: "Ana" }, named.db);
    expect(named.updates.find(u => u.table === "customers")?.payload).toEqual({ username: "dyqani.al", display_name: "Ana" });
  });
  it("touches nothing without inputs or outside the admin's own Real chat", async () => {
    const empty = fakeDb({ id: "conv", customer_id: "cust" });
    await expect(applyPanelInputs(scope, {}, empty.db)).resolves.toBe(true);
    expect(empty.updates).toHaveLength(0);
    const missing = fakeDb(null);
    await expect(applyPanelInputs(scope, { customerName: "Ana" }, missing.db)).resolves.toBe(false);
    expect(missing.updates).toHaveLength(0);
  });
});
