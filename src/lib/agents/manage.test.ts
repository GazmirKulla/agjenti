import { expect, it, vi } from "vitest";
const id = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, order: async () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", name: "Agent", instructions: "Published", is_active: true }], error: null }) };
  return q;
} }) }));
import { prepareManagedAgent } from "./manage";
it("prevents metadata operations from bypassing communication publication", async () => {
  await expect(prepareManagedAgent("tenant", { id, instructions: "Unreviewed" })).rejects.toThrow("draft");
});
it("preserves name/activation editing and creation with initial instructions", async () => {
  expect(await prepareManagedAgent("tenant", { id, name: "Renamed", is_active: false })).toMatchObject({ values: { name: "Renamed", instructions: "Published", is_active: false } });
  expect(await prepareManagedAgent("tenant", { name: "New", instructions: "Initial", is_active: false })).toMatchObject({ before: null, values: { name: "New", instructions: "Initial" } });
});
