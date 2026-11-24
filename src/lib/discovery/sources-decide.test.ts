import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), save: vi.fn(), reviews: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: () => {
  const chain = { select: () => chain, eq: () => chain, then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: m.reviews.map(review => ({ checkpoint: { review } })), error: null }).then(ok) };
  return chain;
} }) }));
vi.mock("@/lib/agent-configuration/service", async (original) => ({ ...(await original<object>()), saveConfiguration: m.save }));
vi.mock("./queue", () => ({ enqueueDiscovery: vi.fn(), enqueuePublicInstagram: vi.fn() }));
import { decideSourceEntry } from "./sources-step";
import { ConfigurationError } from "@/lib/agent-configuration/service";

const id = "2af8cfe5-5f63-47a1-baf3-959cfea49b79";
const reviewed = "2026-11-24T10:00:00.123456+00:00";
beforeEach(() => { vi.clearAllMocks(); m.save.mockResolvedValue({ revision: 5, created: true }); m.rpc.mockResolvedValue({ data: { kept: 0, removed: 0 }, error: null }); m.reviews = []; });

it("decides one entry through the shared configuration change, against the content the owner reviewed", async () => {
  m.reviews = [{ status: "pending", knowledgeIds: ["other"] }];
  expect(await decideSourceEntry("b", "u", { id, decision: "accept", expected: reviewed, edit: { title: "Dërgesa", body: "Brenda 24 orësh." } })).toEqual({ decided: "accept", closed: false });
  expect(m.save).toHaveBeenCalledWith("b", "u", [{ type: "proposal.decide", id, decision: "accept", expected: reviewed, title: "Dërgesa", body: "Brenda 24 orësh." }], "sources", undefined);
  expect(m.rpc).not.toHaveBeenCalled();
});

it("closes a proposal once nothing is left and it changes nothing else; leaves other changes for their own decision", async () => {
  m.reviews = [{ status: "pending", knowledgeIds: [] }];
  expect(await decideSourceEntry("b", "u", { id, decision: "reject", expected: reviewed })).toMatchObject({ closed: true });
  expect(m.rpc).toHaveBeenCalledWith("review_discovery", { p_business: "b", p_user: "u", p_keep: [] });
  m.rpc.mockClear(); m.reviews = [{ status: "pending", knowledgeIds: [], agent: { instructions: "x" } }];
  expect(await decideSourceEntry("b", "u", { id, decision: "reject", expected: reviewed })).toMatchObject({ closed: false });
  expect(m.rpc).not.toHaveBeenCalled();
});

it("needs the reviewed version and reports a refused change as a conflict, never as decided", async () => {
  await expect(decideSourceEntry("b", "u", { id, decision: "accept" })).rejects.toThrow("versionin e shqyrtuar");
  await expect(decideSourceEntry("b", "u", { id, decision: "maybe", expected: reviewed })).rejects.toThrow();
  m.save.mockRejectedValue(new ConfigurationError("Një element ndryshoi ndërkohë.", "stale"));
  await expect(decideSourceEntry("b", "u", { id, decision: "accept", expected: reviewed })).rejects.toMatchObject({ status: 409 });
  expect(m.rpc).not.toHaveBeenCalled();
});
