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
it("merges a partial policy into the saved draft without writing or changing live instructions", async () => {
  m.row.configuration_draft = { instructions: "Draft", communication: { ...defaultCommunicationPolicy, emoji: "none" }, baseRevision: 2 };
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "draft", communication: { tone: "neutral" } });
  expect(p.values).toEqual({ instructions: "Draft", communication: { ...defaultCommunicationPolicy, emoji: "none", tone: "neutral" } });
  expect(m.row.instructions).toBe("Published"); expect(m.rpc).not.toHaveBeenCalled();
  expect(m.filters).toContainEqual(["business_id", "tenant"]);
});
it("binds the write to the server-read timestamp and authenticated actor", async () => {
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "draft", instructions: "Updated" });
  m.rpc.mockResolvedValue({ data: { published: false, revision: 2, active: true }, error: null });
  expect(await saveCommunicationConfiguration("tenant", "owner", p)).toHaveProperty("path", "agents");
  expect(m.rpc).toHaveBeenCalledWith("save_agent_communication", { p_business: "tenant", p_user: "owner", p_agent: id, p_expected: "stamp", p_mode: "draft", p_values: p.values });
});
it.each([null, { instructions: "Draft", communication: defaultCommunicationPolicy, baseRevision: 1 }])("rejects missing or stale publication %j", async draft => {
  m.row.configuration_draft = draft;
  await expect(prepareCommunicationConfiguration("tenant", { id, mode: "publish" })).rejects.toThrow("Drafti");
  await expect(loadCommunicationDraft("tenant", id)).rejects.toThrow("Drafti");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("publishes only the saved reviewed draft, never inline edits", async () => {
  m.row.configuration_draft = { instructions: "Draft", communication: defaultCommunicationPolicy, baseRevision: 2 };
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "publish" });
  expect(p.preview).toEqual(m.row.configuration_draft); expect(p.values).toBeNull();
  await expect(prepareCommunicationConfiguration("tenant", { id, mode: "publish", instructions: "Unreviewed" })).rejects.toThrow("draft");
});
it("does not report success for rejected writes or missing receipts", async () => {
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "discard" });
  for (const value of [{ data: null, error: null }, { data: null, error: { message: "stale_agent" } }]) {
    m.rpc.mockResolvedValue(value);
    await expect(saveCommunicationConfiguration("tenant", "owner", p)).rejects.toThrow("nuk u ruajt");
  }
});
