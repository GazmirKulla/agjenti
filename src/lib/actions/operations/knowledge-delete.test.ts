import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), from: vi.fn(), remove: vi.fn(), filters: [] as unknown[], result: {} as { data: unknown; error: unknown } }));
vi.mock("./access", () => ({ operationActor: m.actor }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: m.from }) }));
import { prepareOperation, executeOperation } from "./service";
const id = "00000000-0000-4000-8000-000000000001";
const row = { id, title: "Orari", body: "Hapur paradite", updated_at: "2026-11-05T00:00:00Z" };
beforeEach(() => {
  vi.clearAllMocks(); m.filters = []; m.result = { data: row, error: null };
  m.actor.mockResolvedValue({ userId: "owner", business: { id: "business", name: "Business" } });
  m.rpc.mockResolvedValue({ data: { execute: true }, error: null });
  m.from.mockImplementation((table: string) => {
    const q = { delete: () => { m.remove(); return q; }, update: () => q, select: () => q, returns: () => q,
      eq: (...args: unknown[]) => { m.filters.push([table, ...args]); return q; },
      maybeSingle: async () => table === "knowledge_entries" ? m.result : { data: { id }, error: null },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
    return q;
  });
});
it("previews the selected knowledge without deleting and fences confirmation by business, ID and revision", async () => {
  const prepared = await prepareOperation("business", "owner", "knowledge.delete", { id });
  expect(prepared.preview.subject).toBe(row.title);
  expect(prepared.preview.notice).toContain("përfundimtare");
  expect(m.remove).not.toHaveBeenCalled();
  expect(await executeOperation("business", "owner", prepared)).toMatchObject({ message: "Njohuria u fshi." });
  expect(m.remove).toHaveBeenCalledOnce();
  expect(m.filters).toEqual(expect.arrayContaining([
    ["knowledge_entries", "business_id", "business"], ["knowledge_entries", "id", id],
    ["knowledge_entries", "updated_at", row.updated_at],
  ]));
});
it.each([
  [{ data: null, error: null }, "ndryshoi ose u hoq"],
  [{ data: null, error: { code: "23503" } }, "lidhur me një shërbim"],
  [{ data: null, error: { code: "unavailable" } }, "nuk u fshi"],
])("does not report success for a conflict or database failure", async (result, message) => {
  const prepared = await prepareOperation("business", "owner", "knowledge.delete", { id });
  m.result = result;
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
  expect(m.remove).not.toHaveBeenCalled();
});
it("replays a completed confirmation without deleting again", async () => {
  const prepared = await prepareOperation("business", "owner", "knowledge.delete", { id });
  m.rpc.mockResolvedValue({ data: { execute: false, state: "completed", result: { message: "Njohuria u fshi.", path: "knowledge" } }, error: null });
  await expect(executeOperation("business", "owner", prepared)).resolves.toMatchObject({ message: "Njohuria u fshi." });
  expect(m.remove).not.toHaveBeenCalled();
});
