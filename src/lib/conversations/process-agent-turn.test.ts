import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/agents/generate", () => ({
  generateAgentReply: mocks.generate,
  agentModel: () => "configured-model",
}));
import { processAgentTurn } from "./process-agent-turn";
import { emptyState } from "@/lib/workflows/engine";
const fixtures: Record<string, unknown> = {};
let queries: { table: string; filters: unknown[][] }[] = [];
let failedTable = "";
beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  failedTable = "";
  Object.assign(fixtures, {
    products: [
      {
        id: "product-a",
        name: "Bluzë",
        product_type_id: "type-a",
        workflow_id: "workflow-a",
        price_amount: 1800,
        currency: "ALL",
      },
    ],
    ai_agents: { instructions: "Udhëzimet vetëm të biznesit A" },
    knowledge_entries: [{ title: "Dërgesa", body: "Brenda dy ditësh" }],
    workflows: { id: "workflow-a" },
    workflow_steps: [
      { key: "collect_size", kind: "choice", position: 0 },
      { key: "awaiting_photo", kind: "photo", position: 1 },
      { key: "collect_customer", kind: "customer", position: 2 },
    ],
  });
  mocks.from.mockImplementation((table: string) => {
    const query = { table, filters: [] as unknown[][] };
    queries.push(query);
    const result = () => ({
      data: fixtures[table] ?? null,
      error: failedTable === table ? { message: "unavailable" } : null,
    });
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((...args: unknown[]) => {
        query.filters.push(args);
        return chain;
      }),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => result()),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve),
    };
    return chain; // No write methods: accidental writes fail the tests.
  });
  mocks.generate.mockResolvedValue({
    reply: "Çfarë madhësie doni?",
    responseId: "resp_1",
    source: "ai",
    fallbackReason: null,
  });
});
describe("shared business turn processor", () => {
  it("uses tenant agent, active knowledge, catalog prices and product workflow", async () => {
    const result = await processAgentTurn({
      businessId: "business-a",
      message: "Bluzë",
      hasPhoto: false,
    });
    expect(result.nextState).toMatchObject({
      product_id: "product-a",
      product_type_id: "type-a",
      step_key: "collect_size",
      fields: {},
    });
    expect(result.workflowId).toBe("workflow-a");
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: "Udhëzimet vetëm të biznesit A",
        knowledge: "Dërgesa: Brenda dy ditësh",
        catalogSummary: "Bluzë — 1800 ALL",
        previousResponseId: null,
      }),
    );
    for (const table of ["products", "ai_agents", "knowledge_entries", "workflows"])
      expect(queries.find((q) => q.table === table)?.filters).toContainEqual([
        "business_id",
        "business-a",
      ]);
    expect(queries.some((q) => q.table === "product_types")).toBe(false);
    for (const table of ["ai_agents", "knowledge_entries"])
      expect(queries.find((q) => q.table === table)?.filters).toContainEqual([
        "is_active",
        true,
      ]);
  });
  it("carries multiple turns and simulated photos through the same engine", async () => {
    const first = await processAgentTurn({
      businessId: "business-a",
      message: "Bluzë",
      hasPhoto: false,
    });
    const second = await processAgentTurn({
      businessId: "business-a",
      message: "M",
      hasPhoto: false,
      state: first.nextState,
      previousResponseId: first.previousResponseId,
    });
    expect(second.nextState).toMatchObject({
      step_key: "awaiting_photo",
      fields: { collect_size: "M" },
    });
    expect(first.nextState.fields).toEqual({});
    expect(mocks.generate).toHaveBeenLastCalledWith(
      expect.objectContaining({ previousResponseId: "resp_1" }),
    );
    const third = await processAgentTurn({
      businessId: "business-a",
      message: "",
      hasPhoto: true,
      state: second.nextState,
    });
    expect(third.nextState).toMatchObject({
      step_key: "collect_customer",
      fields: { photo: true },
    });
  });
  it("does not accept a product/type injected from another business", async () => {
    const result = await processAgentTurn({
      businessId: "business-a",
      message: "Përshëndetje",
      hasPhoto: false,
      state: {
        ...emptyState(),
        product_id: "foreign-product",
        product_type_id: "foreign-type",
        step_key: "order_ready",
      },
    });
    expect(result.nextState.product_id).toBeNull();
    expect(result.nextState.step_key).toBe("choose_product");
    expect(queries.some((q) => q.table === "workflows")).toBe(false);
  });
  it("does not load steps for a workflow outside the business", async () => {
    fixtures.workflows = null;
    const result = await processAgentTurn({
      businessId: "business-a",
      message: "Bluzë",
      hasPhoto: false,
    });
    expect(result.workflowId).toBeNull();
    expect(queries.some((q) => q.table === "workflow_steps")).toBe(false);
  });
  it("exposes fallback/default-agent status honestly without requiring Instagram", async () => {
    fixtures.ai_agents = null;
    fixtures.knowledge_entries = [];
    mocks.generate.mockResolvedValue({
      reply: "Cilin produkt dëshironi?",
      responseId: null,
      source: "fallback",
      fallbackReason: "missing_api_key",
    });
    const result = await processAgentTurn({
      businessId: "business-a",
      message: "Përshëndetje",
      hasPhoto: false,
    });
    expect(result.debug).toMatchObject({
      agentConfigured: false,
      knowledgeCount: 0,
      source: "fallback",
      fallbackReason: "missing_api_key",
    });
    expect(
      queries.some((q) =>
        /instagram|messages|conversations|orders/.test(q.table),
      ),
    ).toBe(false);
  });
  it("fails closed if business configuration cannot be loaded", async () => {
    failedTable = "knowledge_entries";
    await expect(
      processAgentTurn({
        businessId: "business-a",
        message: "Hi",
        hasPhoto: false,
      }),
    ).rejects.toThrow();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("leaves ambiguous product matches at product selection", async () => {
    fixtures.products = [
      { id: "one", name: "Bluzë M" },
      { id: "two", name: "Bluzë S" },
    ];
    const r = await processAgentTurn({
      businessId: "business-a",
      message: "Bluzë",
      hasPhoto: false,
    });
    expect(r.nextState.step_key).toBe("choose_product");
  });
});
