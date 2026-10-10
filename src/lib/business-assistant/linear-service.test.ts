import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), ticket: null as unknown, fixtures: {} as Record<string, unknown> }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/crypto/tokens", () => ({ encryptSecret: (value: string) => { m.ticket = JSON.parse(value); return "sealed"; } }));
import { prepareLinear, executeLinear, loadLinearContext } from "./linear-service";
import { readProposal } from "./model";
import type { Access, Ticket } from "./service";
const business = "00000000-0000-4000-8000-000000004101", product = "00000000-0000-4000-8000-000000004121", workflow = "00000000-0000-4000-8000-000000004111";
const access: Access = { businessId: business, userId: "user", modules: ["workflows", "products"], catalogSource: "internal" };
const definition = { name: "New order", steps: [{ key: "phone", kind: "text", fieldKey: "customer_phone", fieldType: "phone", label: "Telefoni" }, { key: "customer", kind: "customer", label: "Dorëzimi" }] };
beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", business);
    m.fixtures = { products: [{ id: product, name: "Bluzë", workflow_id: workflow }], linear_workflow_versions: [{ id: "version-1", workflow_id: workflow, name: "Original", steps: [{ key: "customer", kind: "customer", label: "Dorëzimi" }] }], product_workflow_drafts: null };
    m.from.mockImplementation((table: string) => { const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: m.fixtures[table], error: null }), then: (f: (v: unknown) => unknown) => Promise.resolve({ data: m.fixtures[table], error: null }).then(f) }; return chain; });
    m.rpc.mockResolvedValue({ data: 1, error: null });
});
it("prepares a product-only draft with readable preview and no writes", async () => {
    const result = await prepareLinear(access, { action: "linear_draft", id: product, message: "Shto telefonin", changes: [{ field: "definition", value: JSON.stringify(definition) }] });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(result.preview?.fields[0].after).toContain("Telefoni");
    expect(result.preview?.fields[0].after).not.toContain("fieldKey");
    expect(m.ticket).toMatchObject({ values: { scope: "product", operation: "draft" }, before: { versionId: "version-1" } });
    await executeLinear(access, m.ticket as Ticket);
    expect(m.rpc).toHaveBeenCalledWith("save_product_workflow", expect.objectContaining({ p_operation: "draft", p_scope: "product", p_expected: expect.objectContaining({ versionId: "version-1" }) }));
});
it("rejects a stale preview and unavailable modules", async () => {
    const prior = await loadLinearContext(access, product);
    m.fixtures.product_workflow_drafts = { product_id: product, revision: 4, definition, scope: "product", source_workflow_id: workflow };
    await expect(prepareLinear(access, { action: "linear_draft", id: product, message: "x", changes: [{ field: "definition", value: JSON.stringify(definition) }] }, prior)).rejects.toThrow("ndryshoi");
    await expect(loadLinearContext({ ...access, modules: ["workflows"] })).rejects.toThrow();
    expect(m.rpc).not.toHaveBeenCalled();
});
it("does not publish an unsaved or already published draft", async () => {
    const p = { action: "linear_publish" as const, id: product, message: "Publiko", changes: [] };
    await expect(prepareLinear(access, p)).rejects.toThrow("fillimisht");
    m.fixtures.product_workflow_drafts = { product_id: product, revision: 2, published_revision: 2, definition, scope: "product", source_workflow_id: workflow };
    await expect(prepareLinear(access, p)).rejects.toThrow("publikuar tashmë");
});
it("accepts bounded clarification choices and rejects invalid product operations", () => {
    expect(readProposal({ action: "clarify", id: null, message: "Cila degë?", choices: ["Po", "Jo"], changes: [] }).choices).toEqual(["Po", "Jo"]);
    expect(() => readProposal({ action: "linear_publish", id: product, message: "x", changes: [{ field: "definition", value: "{}" }] })).toThrow();
    expect(() => readProposal({ action: "linear_draft", id: null, message: "x", changes: [] })).toThrow();
});
