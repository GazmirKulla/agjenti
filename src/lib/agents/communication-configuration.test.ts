import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), filters: [] as unknown[][], row: {} as Record<string, unknown> }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
const saved = vi.hoisted(() => ({ saveConfiguration: vi.fn() }));
vi.mock("@/lib/agent-configuration/service", async (original) => ({ ...(await original<object>()), saveConfiguration: saved.saveConfiguration }));
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
it("saves through the shared configuration change, fenced by the agent as the owner saw it", async () => {
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "apply", instructions: "Updated" });
  saved.saveConfiguration.mockResolvedValue({ revision: 3, created: true, replayed: false, message: "", lines: [] });
  const result = await saveCommunicationConfiguration("tenant", "owner", p, "11111111-1111-4111-8111-111111111112");
  expect(result).toMatchObject({ path: "agents" }); expect(result.message).toContain("versioni 3");
  expect(saved.saveConfiguration).toHaveBeenCalledWith("tenant", "owner", [{ type: "agent.update", id, instructions: "Updated", communication: p.values!.communication, expected: "stamp" }],
    "owner", "11111111-1111-4111-8111-111111111112");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("says an inactive agent does not answer yet, and an unchanged save changed nothing", async () => {
  m.row.is_active = false;
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "apply", instructions: "Updated" });
  saved.saveConfiguration.mockResolvedValue({ revision: 3, created: true, replayed: false, message: "", lines: [] });
  expect((await saveCommunicationConfiguration("tenant", "owner", p)).message).toContain("joaktiv");
  saved.saveConfiguration.mockResolvedValue({ revision: 2, created: false, replayed: false, message: "", lines: [] });
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
it("does not report success for a rejected change, and applies or drops a pending draft as one change", async () => {
  m.row.configuration_draft = { instructions: "Draft", communication: defaultCommunicationPolicy, baseRevision: 2 };
  const p = await prepareCommunicationConfiguration("tenant", { id, mode: "publish" });
  saved.saveConfiguration.mockRejectedValue(new Error("network"));
  await expect(saveCommunicationConfiguration("tenant", "owner", p)).rejects.toThrow("nuk u ruajt");
  saved.saveConfiguration.mockResolvedValue({ revision: 3, created: true, replayed: false, message: "", lines: [] });
  await saveCommunicationConfiguration("tenant", "owner", p);
  expect(saved.saveConfiguration).toHaveBeenLastCalledWith("tenant", "owner", [{ type: "agent.draft", id, action: "apply", expected: "stamp" }], "owner", undefined);
  await saveCommunicationConfiguration("tenant", "owner", await prepareCommunicationConfiguration("tenant", { id, mode: "discard" }));
  expect(saved.saveConfiguration).toHaveBeenLastCalledWith("tenant", "owner", [{ type: "agent.draft", id, action: "discard", expected: "stamp" }], "owner", undefined);
});
