import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), admin: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access, isPlatformAdmin: m.admin }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { changeAgentTraining, listAgentTraining, saveAgentTraining } from "./actions";
import { issueTrainingReceipt } from "./receipt";
const business = "11111111-1111-4111-8111-111111111111";
const workflow = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
let queries: { table: string; filters: unknown[][]; operation?: string; values?: unknown }[];
let resultData: unknown;
let resultError: { code?: string; message?: string } | null;
let foreignWorkflow: boolean;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64));
  m.user.mockResolvedValue({ id: "owner" }); m.admin.mockResolvedValue(false);
  m.access.mockResolvedValue({ business: { id: business, slug: "shop" } });
  queries = []; resultData = { id }; resultError = null; foreignWorkflow = false;
  m.from.mockImplementation((table: string) => {
    const query = { table, filters: [] as unknown[][], operation: "", values: undefined as unknown }; queries.push(query);
    const result = () => ({ data: table === "workflows" && foreignWorkflow ? null : resultData, error: resultError });
    const chain = { select: () => chain, eq: (...values: unknown[]) => { query.filters.push(values); return chain; }, in: (...values: unknown[]) => { query.filters.push(values); return chain; }, order: () => chain, limit: () => chain,
      insert: (values: unknown) => { query.operation = "insert"; query.values = values; return chain; }, update: (values: unknown) => { query.operation = "update"; query.values = values; return chain; }, delete: () => { query.operation = "delete"; return chain; },
      maybeSingle: async () => result(), single: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return chain;
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("explicit business training mutations", () => {
  it("requires sign-in and tenant authorization before any read or write", async () => {
    m.user.mockResolvedValue(null);
    expect(await saveAgentTraining({ slug: "shop" }, { kind: "style", instruction: "Hi" })).toHaveProperty("error");
    expect(m.from).not.toHaveBeenCalled();
    m.user.mockResolvedValue({ id: "owner" }); m.access.mockResolvedValue(null);
    expect(await listAgentTraining({ slug: "other" })).toHaveProperty("error");
    expect(await changeAgentTraining({ slug: "other" }, { id, revision: 1, action: "delete" })).toHaveProperty("error");
    expect(m.from).not.toHaveBeenCalled();
  });
  it("does not allow a business member to use the admin target bypass", async () => {
    expect(await saveAgentTraining({ businessId: business }, { kind: "style", instruction: "Short" })).toHaveProperty("error");
    expect(m.from).not.toHaveBeenCalled();
    m.admin.mockResolvedValue(true); resultData = { id: business, slug: "shop" };
    expect(await saveAgentTraining({ businessId: business }, { kind: "style", instruction: "Short" })).toEqual({ success: true });
    expect(queries[0].filters).toContainEqual(["id", business]);
  });
  it("stores only an explicitly confirmed lesson for the authorized tenant", async () => {
    expect(await saveAgentTraining({ slug: "shop" }, { kind: "style", instruction: "  Pa shumë emoji  " })).toEqual({ success: true });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ table: "agent_training_memories", operation: "insert", values: { business_id: business, instruction: "Pa shumë emoji", created_by: "owner", source: "manual" } });
    expect(m.revalidate).toHaveBeenCalledWith("/b/shop", "layout");
  });
  it("rejects another business's workflow before writing", async () => {
    foreignWorkflow = true;
    expect(await saveAgentTraining({ slug: "shop" }, { kind: "workflow", instruction: "Explain the photo", workflowId: workflow })).toHaveProperty("error");
    expect(queries[0].filters).toContainEqual(["business_id", business]);
    expect(queries.every(q => !q.operation)).toBe(true);
  });
  it("validates a workflow step and scopes edits with optimistic revision", async () => {
    expect(await saveAgentTraining({ slug: "shop" }, { id, revision: 3, kind: "workflow", instruction: "Explain photo", workflowId: workflow, stepKey: "photo" })).toEqual({ success: true });
    expect(queries[1]).toMatchObject({ table: "workflow_steps", filters: [["workflow_id", workflow], ["key", "photo"]] });
    expect(queries[2]).toMatchObject({ operation: "update", filters: [["business_id", business], ["id", id], ["revision", 3]] });
    resultData = null;
    expect(await saveAgentTraining({ slug: "shop" }, { id, revision: 3, kind: "style", instruction: "Short" })).toHaveProperty("error");
  });
  it("validates sealed feedback provenance and rejects altered questions and cross-tenant receipts", async () => {
    const receipt = issueTrainingReceipt("owner", business, "Hi", "Old", null, null);
    const values = { kind: "example" as const, instruction: "Keep it short", customerMessage: "Hi", desiredResponse: "Hello", receipt };
    expect(await saveAgentTraining({ slug: "shop" }, values)).toEqual({ success: true });
    expect(queries[0].values).toMatchObject({ source: "test_feedback", desired_response: "Hello" });
    m.from.mockClear(); queries = [];
    expect(await saveAgentTraining({ slug: "shop" }, { ...values, customerMessage: "Changed" })).toHaveProperty("error");
    expect(await saveAgentTraining({ slug: "shop" }, { ...values, receipt: issueTrainingReceipt("owner", "another", "Hi", "Old", null, null) })).toHaveProperty("error");
    expect(m.from).not.toHaveBeenCalled();
  });
  it.each(["enable", "disable", "delete"] as const)("%s filters both business and revision", async action => {
    expect(await changeAgentTraining({ slug: "shop" }, { id, revision: 2, action })).toEqual({ success: true });
    expect(queries[0].filters).toEqual([["business_id", business], ["id", id], ["revision", 2]]);
    resultData = null;
    expect(await changeAgentTraining({ slug: "shop" }, { id, revision: 2, action })).toHaveProperty("error");
  });
  it("reports a missing migration without claiming a saved lesson", async () => {
    resultError = { code: "PGRST205", message: "internal details" };
    const result = await saveAgentTraining({ slug: "shop" }, { kind: "style", instruction: "Short" });
    expect(result).toHaveProperty("error");
    expect(JSON.stringify(result)).toContain("migrimin");
    expect(JSON.stringify(result)).not.toContain("internal details");
  });
});
