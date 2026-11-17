import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ model: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/actions/operations/service", () => ({ prepareOperation: m.prepare, executeOperation: vi.fn() }));
vi.mock("@/lib/capabilities/assessment", () => ({ assessBusinessCapabilities: async () => [], summarizeCapabilityAssessments: () => [] }));
vi.mock("openai", () => ({ default: class { responses = { create: m.model }; } }));
vi.mock("@/lib/supabase/service", () => {
  const products = [
    { id: "00000000-0000-4000-8000-000000000001", name: "A", price_amount: 10, currency: "ALL", is_active: true, archived_at: null, updated_at: "t1", attributes: { faqe: "120" } },
    { id: "00000000-0000-4000-8000-000000000002", name: "B", price_amount: 20, currency: "ALL", is_active: true, archived_at: null, updated_at: "t2", attributes: { faqe: "48" } },
  ];
  const result = (table: string, calls: string[]) => table === "products" ? { data: products, count: products.length, error: null }
    : table === "businesses" ? { data: { product_fields: [{ key: "faqe", label: "Faqe", type: "text" }] }, error: null }
    : { data: calls.includes("maybeSingle") ? null : [], error: null };
  return { createServiceSupabase: () => ({ from: (table: string) => {
    const calls: string[] = [];
    const chain: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => Promise.resolve(result(table, calls)).then(resolve) };
    for (const name of ["select", "eq", "in", "order", "limit", "range", "returns", "maybeSingle"]) chain[name] = () => { calls.push(name); return chain; };
    return chain;
  } }) };
});
import { planRequest } from "./service";

const access = { businessId: "business", userId: "owner", modules: ["products"], catalogSource: "internal" };
const context = { page: "products", entryPoint: "contextual" as const, searchQuery: "", filters: { status: "all" } };
const reply = (proposal: Record<string, unknown>) => ({ output_text: JSON.stringify({ planRelation: null, automation: null, choices: [], id: null, message: "", ...proposal }) });
const inputOf = (call: number) => JSON.parse(m.model.mock.calls[call][0].input);
const wrappedSearch = { action: "operation", changes: [{ field: "key", value: "search" }, { field: "input", value: "{\"kind\":\"product\"}" }] };
const search = { action: "search", changes: [{ field: "kind", value: "product" }, { field: "filters", value: JSON.stringify([{ field: "faqe", op: "gt", value: 60 }]) }] };

beforeEach(() => { vi.clearAllMocks(); process.env.OPENAI_API_KEY = "synthetic-key"; process.env.TOKEN_ENCRYPTION_KEY = "synthetic-test-key"; });

it("returns a contract-breaking proposal to the model, then answers from the server's query", async () => {
  m.model.mockResolvedValueOnce(reply(wrappedSearch))
    .mockResolvedValueOnce(reply(search))
    .mockResolvedValueOnce(reply({ action: "clarify", changes: [], message: "1 produkt ka më shumë se 60 faqe." }));
  const result = await planRequest(access, "sa produkte kanë më shumë se 60 faqe?", [], context);
  expect(m.prepare).not.toHaveBeenCalled();
  expect(inputOf(1).data.proposalRepair).toMatchObject({ diagnostic: "unregistered_operation" });
  expect(inputOf(2).data.searchResult).toMatchObject({ mode: "filter", matchedCount: 1, rows: [expect.objectContaining({ name: "A" })] });
  expect(result.message).toBe("1 produkt ka më shumë se 60 faqe.");
});

it("lets the model correct a malformed search", async () => {
  m.model.mockResolvedValueOnce(reply({ action: "search", changes: [{ field: "made_up", value: "x" }] }))
    .mockResolvedValueOnce(reply(search))
    .mockResolvedValueOnce(reply({ action: "clarify", changes: [], message: "ok" }));
  await planRequest(access, "sa produkte kanë më shumë se 60 faqe?", [], context);
  expect(inputOf(1).data.proposalRepair).toMatchObject({ diagnostic: "invalid_search" });
});

it("stops after two corrections without preparing any action", async () => {
  m.model.mockResolvedValue(reply(wrappedSearch));
  await expect(planRequest(access, "sa produkte kanë më shumë se 60 faqe?", [], context)).rejects.toThrow("nuk mbështetet");
  expect(m.model).toHaveBeenCalledTimes(3);
  expect(m.prepare).not.toHaveBeenCalled();
});
