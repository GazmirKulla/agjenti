import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ prepare: vi.fn(), execute: vi.fn(), model: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/actions/operations/service", () => ({ prepareOperation: m.prepare, executeOperation: m.execute }));
vi.mock("@/lib/capabilities/assessment", () => ({ assessBusinessCapabilities: async () => [], summarizeCapabilityAssessments: () => [] }));
vi.mock("openai", () => ({ default: class { responses = { create: m.model }; } }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
import { planRequest, openTicket } from "./service";
const access = { businessId: "business", userId: "owner", modules: ["products"], catalogSource: "internal" };
const context = { page: "products", entryPoint: "contextual" as const, searchQuery: "", filters: { status: "all" } };
beforeEach(() => {
  vi.clearAllMocks(); process.env.TOKEN_ENCRYPTION_KEY = "synthetic-test-key";
  m.prepare.mockResolvedValue({ version: 1, key: "product.remove", requestId: "batch", input: { scope: "ids", ids: ["verified"] }, snapshot: { rows: [] }, preview: { title: "Hiq 12 produkte", subject: "12 për fshirje · 0 për arkivim", fields: [] } });
});
it("reproduces the screenshot follow-ups: immediately prepares a review despite a stale count and unrelated plan", async () => {
  const prior = { version: 1 as const, request: "Si ta kompletoj agjentin?", actionPlan: { id: "old", request: "old", assessedAt: "", assumptions: [], questions: [], steps: [] } };
  const history = [{ role: "user" as const, content: "Fshi të gjitha produktet e listuara" }, { role: "assistant" as const, content: "Në katalog janë 13 produkte. Cilat produkte?" }];
  for (const text of ["Fshi të gjitha produktet e listuara", "fshiji te gjitha"]) {
    const result = await planRequest(access, text, history, context, undefined, [], undefined, prior);
    expect(result).toMatchObject({ replacePlan: true, token: expect.any(String), message: expect.stringContaining("12 produkte") });
    expect(result.message).not.toContain("13");
    expect(openTicket(result.token!, access).values.operation).toMatchObject({ key: "product.remove", input: { ids: ["verified"] } });
  }
  expect(m.prepare).toHaveBeenCalledWith("business", "owner", "product.remove", { scope: "listed", query: "", status: "all" }, undefined);
  expect(m.model).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled();
});
it("preserves current filter and cannot reuse an old target", async () => {
  await planRequest(access, "Fshi të gjitha produktet e listuara", [], { ...context, searchQuery: "test", filters: { status: "draft" } });
  expect(m.prepare).toHaveBeenCalledWith("business", "owner", "product.remove", { scope: "listed", query: "test", status: "draft" }, undefined);
});
it("rejects disabled products before preparation", async () => {
  await expect(planRequest({ ...access, modules: [] }, "Fshi të gjitha produktet e listuara", [], context)).rejects.toThrow("aktivë");
  expect(m.prepare).not.toHaveBeenCalled();
});

it("routes natural phrasing through the same batch operation and uses server totals over model prose", async () => {
  process.env.OPENAI_API_KEY = "synthetic-key";
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `Synthetic ${i}` }));
  m.from.mockImplementation(() => {
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, returns: async () => ({ data: rows, count: 12, error: null }) };
    return q;
  });
  m.model.mockResolvedValue({ output_text: JSON.stringify({ action: "operation", id: null, message: "Janë 13 produkte", planRelation: "new", changes: [
    { field: "key", value: "product.remove" }, { field: "input", value: JSON.stringify({ scope: "all" }) },
  ] }) });
  const result = await planRequest(access, "Hiq çdo produkt nga katalogu", [], context);
  expect(JSON.parse(m.model.mock.calls[0][0].input).data.product).toMatchObject({ total: 12, returnedCount: 12, partial: false });
  expect(result).toMatchObject({ token: expect.any(String), replacePlan: true });
  expect(result.message).toContain("12 produkte"); expect(result.message).not.toContain("13");
  expect(m.execute).not.toHaveBeenCalled();
});
