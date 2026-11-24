import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), from: vi.fn(), remove: vi.fn(), filters: [] as unknown[], result: {} as { data: unknown; error: unknown }, apply: {} as { data: unknown; error: unknown } }));
vi.mock("./access", () => ({ operationActor: m.actor }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: m.from }) }));
import { prepareOperation, executeOperation } from "./service";
const id = "00000000-0000-4000-8000-000000000001";
const row = { id, title: "Orari", body: "Hapur paradite", updated_at: "2026-11-05T00:00:00Z" };
beforeEach(() => {
  vi.clearAllMocks(); m.filters = []; m.result = { data: row, error: null };
  m.actor.mockResolvedValue({ userId: "owner", business: { id: "business", name: "Business" } });
  m.rpc.mockImplementation(async (name: string) => name === "apply_agent_configuration" ? m.apply : { data: { execute: true }, error: null });
  m.apply = { data: { revision: 4, created: true }, error: null };
  m.from.mockImplementation((table: string) => {
    const q = { delete: () => { m.remove(); return q; }, update: () => q, select: () => q, returns: () => q,
      eq: (...args: unknown[]) => { m.filters.push([table, ...args]); return q; },
      maybeSingle: async () => table === "knowledge_entries" ? m.result : { data: { id }, error: null },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
    return q;
  });
});
it("previews the selected knowledge without deleting and applies it as one configuration change fenced by its stamp", async () => {
  const prepared = await prepareOperation("business", "owner", "knowledge.delete", { id });
  expect(prepared.preview.subject).toBe(row.title);
  expect(prepared.preview.configuration).toBe(true);
  expect(prepared.preview.notice).toContain("Historiku");
  expect(m.rpc).not.toHaveBeenCalledWith("apply_agent_configuration", expect.anything());
  expect(await executeOperation("business", "owner", prepared)).toMatchObject({ message: expect.stringContaining("U zbatua") });
  expect(m.rpc).toHaveBeenCalledWith("apply_agent_configuration", expect.objectContaining({ p_business: "business", p_user: "owner", p_request: prepared.requestId,
    p_changes: [{ type: "knowledge.delete", id, expected: row.updated_at }] }));
  expect(m.remove).not.toHaveBeenCalled();
});
it.each([
  [{ data: null, error: { message: "stale_configuration_target" } }, "ndryshoi ndërkohë"],
  [{ data: null, error: { code: "23503", message: "fk" } }, "lidhur me një shërbim"],
  [{ data: null, error: { message: "network" } }, "nuk u zbatua"],
])("does not report success for a conflict or database failure", async (result, message) => {
  const prepared = await prepareOperation("business", "owner", "knowledge.delete", { id });
  m.apply = result;
  await expect(executeOperation("business", "owner", prepared)).rejects.toThrow(message);
});
it("rejects a missing or foreign entry during preparation", async () => {
  m.result = { data: null, error: null };
  await expect(prepareOperation("business", "owner", "knowledge.delete", { id })).rejects.toThrow("nuk u gjet");
  expect(m.remove).not.toHaveBeenCalled();
});
it("rechecks access at confirmation and never deletes after revocation", async () => {
  const prepared = await prepareOperation("business", "owner", "knowledge.delete", { id });
  m.actor.mockRejectedValue(Error("Revoked"));
  await expect(executeOperation("business", "owner", prepared)).rejects.toThrow("Revoked");
  expect(m.rpc).not.toHaveBeenCalledWith("apply_agent_configuration", expect.anything());
});
it("replays a completed confirmation without deleting again", async () => {
  const prepared = await prepareOperation("business", "owner", "knowledge.delete", { id });
  m.rpc.mockResolvedValue({ data: { execute: false, state: "completed", result: { message: "Njohuria u fshi.", path: "knowledge" } }, error: null });
  await expect(executeOperation("business", "owner", prepared)).resolves.toMatchObject({ message: "Njohuria u fshi." });
  expect(m.rpc).not.toHaveBeenCalledWith("apply_agent_configuration", expect.anything());
});
