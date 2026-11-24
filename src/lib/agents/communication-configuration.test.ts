import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), filters: [] as unknown[][], row: {} as Record<string, unknown> }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
import { prepareCommunicationConfiguration, saveCommunicationConfiguration, loadCommunicationDraft } from "./communication-configuration";
import { defaultCommunicationPolicy } from "./communication-policy";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.clearAllMocks(); m.filters = [];
  m.row = { id, name: "Agent", instructions: "Published", communication: defaultCommunicationPolicy, configuration_revision: 2, updated_at: "stamp", configuration_draft: null };
  m.from.mockImplementation(() => {
    const q = { select: () => q, eq: (...args: unknown[]) => { m.filters.push(args); return q; }, maybeSingle: async () => ({ data: m.row, error: null }) };
    return q;
  });
});
it("merges a partial policy into the instructions in use and writes nothing before confirmation", async () => {
  m.row.configuration_draft = { instructions: "Old draft", communication: { ...defaultCommunicationPolicy, emoji: "none" }, baseRevision: 2 };
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "apply", communication: { tone: "neutral" } });
  // A pending draft is never the base of a direct change.
  expect(p.values).toEqual({ instructions: "Published", communication: { ...defaultCommunicationPolicy, tone: "neutral" } });
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.filters).toContainEqual(["business_id", "tenant"]);
});
it("binds the write to the server-read timestamp and authenticated actor, and says the new version is in use", async () => {
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "apply", instructions: "Updated" });
  m.rpc.mockResolvedValue({ data: { published: true, revision: 3, active: true }, error: null });
  const result = await saveCommunicationConfiguration("tenant", "owner", p);
  expect(result).toMatchObject({ path: "agents" }); expect(result.message).toContain("versionin 3");
  expect(m.rpc).toHaveBeenCalledWith("save_agent_communication", { p_business: "tenant", p_user: "owner", p_agent: id, p_expected: "stamp", p_mode: "apply", p_values: p.values });
});
it("says an inactive agent does not answer yet, and an unchanged save changed nothing", async () => {
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "apply", instructions: "Updated" });
  m.rpc.mockResolvedValue({ data: { published: true, revision: 3, active: false }, error: null });
  expect((await saveCommunicationConfiguration("tenant", "owner", p)).message).toContain("joaktiv");
  m.rpc.mockResolvedValue({ data: { published: true, revision: 2, active: true }, error: null });
  expect((await saveCommunicationConfiguration("tenant", "owner", p)).message).toContain("Nuk kishte");
});
it("no longer prepares drafts; reverting needs an earlier version", async () => {
  for (const mode of ["draft", "restore"]) await expect(prepareCommunicationConfiguration("tenant", { id, mode, instructions: "X" })).rejects.toThrow("Zgjidh");
  await expect(prepareCommunicationConfiguration("tenant", { id, mode: "revert", revision: 2 })).rejects.toThrow("në përdorim");
  await expect(prepareCommunicationConfiguration("tenant", { id, mode: "revert", revision: 1, instructions: "X" })).rejects.toThrow("Ruaj");
});
it.each([null, { instructions: "Draft", communication: defaultCommunicationPolicy, baseRevision: 1 }])("rejects applying a missing or outdated pending draft %j", async draft => {
  m.row.configuration_draft = draft;
  await expect(prepareCommunicationConfiguration("tenant", { id, mode: "publish" })).rejects.toThrow("pritje");
  await expect(loadCommunicationDraft("tenant", id)).rejects.toThrow("Drafti");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("applies only the pending draft as it was saved, never inline edits", async () => {
  m.row.configuration_draft = { instructions: "Draft", communication: defaultCommunicationPolicy, baseRevision: 2 };
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "publish" });
  expect(p.preview).toEqual(m.row.configuration_draft); expect(p.values).toBeNull();
  await expect(prepareCommunicationConfiguration("tenant", { id, mode: "publish", instructions: "Unreviewed" })).rejects.toThrow("Ruaj");
});
it("does not report success for rejected writes or missing receipts", async () => {
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "discard" });
  for (const value of [{ data: null, error: null }, { data: null, error: { message: "stale_agent" } }]) {
    m.rpc.mockResolvedValue(value);
    await expect(saveCommunicationConfiguration("tenant", "owner", p)).rejects.toThrow("nuk u ruajt");
  }
});
