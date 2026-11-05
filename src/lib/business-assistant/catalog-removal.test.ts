import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ prepare: vi.fn(), execute: vi.fn(), model: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/actions/operations/service", () => ({ prepareOperation: m.prepare, executeOperation: m.execute }));
vi.mock("@/lib/capabilities/assessment", () => ({ assessBusinessCapabilities: async () => [], summarizeCapabilityAssessments: () => [] }));
vi.mock("openai", () => ({ default: class { responses = { create: m.model }; } }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
import { planRequest } from "./service";
const access = { businessId: "business", userId: "owner", modules: ["products"], catalogSource: "internal" };
const context = { page: "products", entryPoint: "contextual" as const, searchQuery: "", filters: { status: "all" } };
beforeEach(() => {
  vi.clearAllMocks(); process.env.TOKEN_ENCRYPTION_KEY = "synthetic-test-key";
  m.prepare.mockResolvedValue({ version: 1, key: "product.remove", requestId: "batch", input: { scope: "ids", ids: ["verified"] }, snapshot: { rows: [] }, preview: { title: "Hiq 12 produkte", subject: "12 për fshirje · 0 për arkivim", fields: [] } });
});
it.each(["Fshi të gjitha produktet e listuara", "fshiji te gjitha", "Remove every listed product", "Elimina los productos seleccionados"])("requires AI interpretation even for familiar removal phrasing: %s", async text => {
  vi.stubEnv("OPENAI_API_KEY", "");
  await expect(planRequest(access, text, [], context)).rejects.toThrow("AI nuk është konfiguruar");
  expect(m.prepare).not.toHaveBeenCalled();
  expect(m.execute).not.toHaveBeenCalled();
});

it.each(["Hiq çdo produkt nga katalogu", "Fshi të gjitha produktet", "Delete all products"])("routes %s through the model and server-scoped operation", async text => {
  process.env.OPENAI_API_KEY = "synthetic-key";
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `Synthetic ${i}` }));
  m.from.mockImplementation(() => {
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, returns: async () => ({ data: rows, count: 12, error: null }) };
    return q;
  });
  m.model.mockResolvedValue({ output_text: JSON.stringify({ action: "operation", id: null, message: "Janë 13 produkte", planRelation: "new", changes: [
    { field: "key", value: "product.remove" }, { field: "input", value: JSON.stringify({ scope: "all" }) },
  ] }) });
  const result = await planRequest(access, text, [], context);
  expect(JSON.parse(m.model.mock.calls[0][0].input).data.product).toMatchObject({ total: 12, returnedCount: 12, partial: false });
  expect(result).toMatchObject({ token: expect.any(String), replacePlan: true });
  expect(result.message).toContain("12 produkte"); expect(result.message).not.toContain("13");
  expect(m.execute).not.toHaveBeenCalled();
});
