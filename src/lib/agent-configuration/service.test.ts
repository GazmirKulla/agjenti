import { beforeEach, expect, it, vi } from "vitest";
type Row = Record<string, unknown>;
const m = vi.hoisted(() => ({ rpc: vi.fn(), actor: vi.fn(), tables: {} as Record<string, Row[]>, revision: 7 }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: (table: string) => {
  const filters: [string, unknown][] = [];
  const rows = () => table === "agent_configuration_snapshots" ? [{ revision: m.revision, source: "owner", summary: "", created_at: "2026-11-24T10:00:00Z" }]
    : (m.tables[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
  const q = { select: () => q, update: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, order: () => q, limit: () => q, returns: () => q,
    maybeSingle: async () => ({ data: table === "business_operation_receipts" ? { id: 1 } : rows()[0] ?? null, error: null }), then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok) };
  return q;
} }) }));
vi.mock("@/lib/actions/operations/access", () => ({ operationActor: m.actor }));
import { applyConfiguration, prepareConfiguration, saveConfiguration } from "./service";
import { executeOperation, prepareOperation } from "@/lib/actions/operations/service";

const business = "11111111-1111-4111-8111-111111111111";
const service = "22222222-2222-4222-8222-222222222222", agent = "33333333-3333-4333-8333-333333333333";
const request = "44444444-4444-4444-8444-444444444444";
beforeEach(() => {
  vi.clearAllMocks(); m.revision = 7;
  m.actor.mockResolvedValue({ userId: "owner", business: { id: business, name: "Studio", slug: "studio", catalog_source: "internal" } });
  m.tables = {
    booking_services: [{ id: service, business_id: business, name: "Konsulta", booking_enabled: true, updated_at: "2026-11-24T09:00:00.123456+00:00" }],
    ai_agents: [{ id: agent, business_id: business, name: "Agjenti", instructions: "Përgjigju shkurt.", communication: {}, is_active: true, updated_at: "2026-11-24T08:00:00+00:00", configuration_draft: null }],
  };
  m.rpc.mockImplementation(async (name: string) => name === "apply_agent_configuration" ? { data: { revision: 8, created: true }, error: null }
    : name === "claim_business_operation" ? { data: { execute: true }, error: null } : { data: null, error: null });
});

// "Për këtë shërbim jep vetëm informacion; rezervimin ta marrë stafi." — a test scenario, not a coded exception.
const informationOnly = [
  { type: "service.booking" as const, id: service, booking_enabled: false },
  { type: "agent.update" as const, instructions: "Përgjigju shkurt.\nPër Konsultën jep vetëm informacion; rezervimin e merr stafi." },
];

it("prepares one proposal with every part, each object's stamp, the version it rests on and the consequences in words", async () => {
  const prepared = await prepareConfiguration(business, informationOnly);
  expect(prepared.baseRevision).toBe(7);
  expect(prepared.changes).toEqual([
    { type: "service.booking", id: service, booking_enabled: false, expected: "2026-11-24T09:00:00.123456+00:00" },
    expect.objectContaining({ type: "agent.update", id: agent, expected: "2026-11-24T08:00:00+00:00", instructions: expect.stringContaining("e merr stafi") }),
  ]);
  expect(prepared.lines.map(line => line.after).join(" ")).toContain("jep vetëm informacion");
});

it("the Assistant's single confirmation applies the same parts a form would, with its request id, as one whole", async () => {
  const op = await prepareOperation(business, "owner", "agent.configure", { changes: informationOnly });
  expect(op.preview.configuration).toBe(true);
  expect(op.preview.notice).toContain("nuk zbatohet asnjë");
  expect(op.preview.notice).toContain("Rezervimet");
  expect(m.rpc).not.toHaveBeenCalledWith("apply_agent_configuration", expect.anything());
  await executeOperation(business, "owner", op);
  const assistant = m.rpc.mock.calls.find(([name]) => name === "apply_agent_configuration")![1];
  expect(assistant).toMatchObject({ p_business: business, p_user: "owner", p_request: op.requestId, p_base: 7, p_source: "assistant" });
  // The same request through a form's Ruaj writes the same parts (a form is not fenced by the whole version, only by each stamp).
  m.rpc.mockClear();
  await saveConfiguration(business, "owner", informationOnly, "owner", request);
  const form = m.rpc.mock.calls.find(([name]) => name === "apply_agent_configuration")![1];
  expect(form.p_changes).toEqual(assistant.p_changes);
  expect(form).toMatchObject({ p_request: request, p_base: null });
});

it("refuses a proposal whose objects changed after review, and parts the Assistant may not send", async () => {
  await expect(prepareConfiguration(business, [{ type: "agent.update", instructions: "X", expected: "2026-01-01T00:00:00Z" }])).rejects.toThrow("ndryshuan");
  await expect(prepareOperation(business, "owner", "agent.configure", { changes: [{ type: "proposal.decide", id: service, decision: "accept", expected: "x" }] })).rejects.toThrow("panjohur");
  await expect(prepareConfiguration(business, [{ type: "service.booking", id: "55555555-5555-4555-8555-555555555555", booking_enabled: false }])).rejects.toThrow("nuk u gjet");
});

it("maps every database refusal to a message that says nothing was applied, and never reports a missing receipt as success", async () => {
  const prepared = await prepareConfiguration(business, informationOnly);
  for (const [message, words] of [["stale_configuration", "Asgjë nuk u zbatua"], ["stale_configuration_target", "ndryshoi ndërkohë"],
    ["configuration_target_missing", "nuk ekziston më"], ["network down", "Asgjë nuk u ruajt pjesërisht"]] as const) {
    m.rpc.mockResolvedValueOnce({ data: null, error: { message } });
    await expect(applyConfiguration(business, "owner", prepared, request, "owner")).rejects.toThrow(words);
  }
  m.rpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(applyConfiguration(business, "owner", prepared, request, "owner")).rejects.toThrow("nuk u konfirmua");
  m.rpc.mockResolvedValueOnce({ data: { revision: 7, created: false }, error: null });
  expect((await applyConfiguration(business, "owner", prepared, request, "owner")).message).toContain("Nuk kishte");
});

it("a new knowledge entry keeps the id it was prepared with, so a retried request creates it once", async () => {
  const prepared = await prepareConfiguration(business, [{ type: "knowledge.save", title: "Orari", body: "09–17", newId: request }]);
  expect(prepared.changes[0]).toMatchObject({ type: "knowledge.save", id: request, is_active: true });
});
