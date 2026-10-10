import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  generate: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/agents/generate", () => ({
  generateAgentReply: mocks.generate,
  agentModel: () => "configured-model",
}));
vi.mock("@/lib/catalogs/retrieval", () => ({
  retrieveBusinessSources: mocks.retrieve,
}));
import { processAgentTurn } from "./process-agent-turn";
import { emptyState } from "@/lib/workflows/engine";
const fixtures: Record<string, unknown> = {};
let queries: { table: string; filters: unknown[][] }[] = [];
let failedTable = "";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.retrieve.mockResolvedValue(null);
  queries = [];
  failedTable = "";
  Object.assign(fixtures, {
    products: [
      {
        id: "product-a",
        name: "Bluzë",
        description: "Pambuk i butë",
        product_type_id: "type-a",
        workflow_id: "workflow-a",
        price_amount: 1800,
        currency: "ALL",
      },
    ],
    ai_agents: { instructions: "Udhëzimet vetëm të biznesit A" },
    agent_training_memories: [],
    business_discovery: null,
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

it("answers test attachments without treating their text as customer profile or changing the saved workflow", async () => {
  const state = { ...emptyState(), product_id: "product-a", step_key: "awaiting_photo", fields: { collect_size: "M" } };
  const result = await processAgentTurn({ businessId: "business-a", mode: "test", message: "Çfarë sheh?", state, hasPhoto: true, hasAttachments: true, attachmentContext: "Blue shirt. Phone: 0690000000" });
  expect(mocks.generate.mock.calls.at(-1)?.[0].documentContext).toContain("Customer attachments (unverified excerpts");
  expect(result.nextState.customer.phone).toBeNull();
  expect(result.nextState.fields.collect_size).toBe("M");
  const production = await processAgentTurn({ businessId: "business-a", mode: "production", message: "Çfarë sheh?", state, hasPhoto: false, hasAttachments: true, attachmentContext: "Private test-only content" });
  expect(production).toHaveProperty("reply");
  expect(JSON.stringify(mocks.generate.mock.calls.at(-1)?.[0])).not.toContain("Private test-only content");
});

it("uses the same saved training in production and test without skipping workflow steps", async () => {
  fixtures.agent_training_memories = [
    { id: "style", kind: "style", instruction: "Pa emoji", customer_message: "", desired_response: "", workflow_id: null, step_key: null, is_active: true, updated_at: "2026-10-08", revision: 1 },
    { id: "size", kind: "workflow", instruction: "Shpjego madhësitë shkurt", customer_message: "", desired_response: "", workflow_id: "workflow-a", step_key: "collect_size", is_active: true, updated_at: "2026-10-08", revision: 1 },
    { id: "foreign", kind: "workflow", instruction: "Other workflow", customer_message: "", desired_response: "", workflow_id: "workflow-b", step_key: "collect_size", is_active: true, updated_at: "2026-10-08", revision: 1 },
  ];
  for (const mode of ["production", "test"] as const) {
    const result = await processAgentTurn({ businessId: "business-a", message: "Bluzë", hasPhoto: false, mode });
    expect(result.nextState.step_key).toBe("collect_size");
    expect(result.debug.trainingMemoryIds).toEqual(["size", "style"]);
    expect(mocks.generate.mock.calls.at(-1)?.[0].trainingContext.rules.map((r: { id: string }) => r.id)).toEqual(["size", "style"]);
  }
  expect(queries.find(q => q.table === "agent_training_memories")?.filters).toEqual([["business_id", "business-a"], ["is_active", true]]);
  const next = await processAgentTurn({ businessId: "business-a", message: "M", hasPhoto: false, state: { ...emptyState(), product_id: "product-a", step_key: "collect_size" } });
  expect(next.nextState.step_key).toBe("awaiting_photo");
  expect(next.debug.trainingMemoryIds).toEqual(["style"]);
});

it("loads business training for informational service and catalog replies too", async () => {
  fixtures.agent_training_memories = [{ id: "style", kind: "style", instruction: "Pa emoji", customer_message: "", desired_response: "", workflow_id: null, step_key: null, is_active: true, updated_at: "2026-10-08", revision: 1 }];
  fixtures.products = [];
  fixtures.knowledge_entries = [{ title: "Pastrim dentar", body: "Shërbim dentar", intent_key: "service" }];
  await processAgentTurn({ businessId: "business-a", message: "Pastrim dentar", hasPhoto: false });
  expect(mocks.generate.mock.calls.at(-1)?.[0].trainingContext.rules[0].id).toBe("style");
  mocks.retrieve.mockResolvedValue({ context: { query: "katalog", requirements: {} }, documents: [], evidence: "Verified excerpt" });
  await processAgentTurn({ businessId: "business-a", message: "Katalog", hasPhoto: false });
  expect(mocks.generate.mock.calls.at(-1)?.[0].trainingContext.rules[0].id).toBe("style");
});
it("loads the tenant customer journey for both live and test replies without changing product workflow execution", async () => {
  const journey = { version: 1, source: "generated", enabled: true, name: "Materialet PDF", summary: "Materialet merren në website.", steps: [{ title: "Shkarko", description: "Shkarko nga website-i.", evidence: "Shkarko tani PDF", sourceRef: "instagram:studio" }], unknowns: [] };
  fixtures.business_discovery = { operating_workflow: journey, process_revision: 1 };
  for (const mode of ["test", "production"] as const) {
    const turn = await processAgentTurn({ businessId: "business-a", message: "Bluzë", hasPhoto: false, mode });
    expect(turn.nextState.step_key).toBe("collect_size");
    expect(mocks.generate.mock.calls.at(-1)?.[0].businessProcess).toContain("Materialet PDF");
  }
  expect(queries.find(query => query.table === "business_discovery")?.filters).toEqual([["business_id", "business-a"]]);
  fixtures.business_discovery = { operating_workflow: { ...journey, enabled: false } };
  await processAgentTurn({ businessId: "business-a", message: "Bluzë", hasPhoto: false });
  expect(mocks.generate.mock.calls.at(-1)?.[0].businessProcess).toBe("");
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
        catalogSummary: "Bluzë — 1800 ALL — Pambuk i butë",
        previousResponseId: null,
      }),
    );
    for (const table of [
      "products",
      "ai_agents",
      "knowledge_entries",
      "workflows",
    ])
      expect(queries.find((q) => q.table === table)?.filters).toContainEqual([
        "business_id",
        "business-a",
      ]);
    expect(queries.some((q) => q.table === "product_types")).toBe(false);
    for (const table of ["products", "ai_agents", "knowledge_entries"])
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
      fields: { product_query: "Bluzë", collect_size: "M" },
    });
    expect(first.nextState.fields).toEqual({ product_query: "Bluzë" });
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
      fields: { product_query: "Bluzë", photo: true },
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
  it("matches a product mentioned inside a natural sentence", async () => {
    const r = await processAgentTurn({
      businessId: "business-a",
      message: "Pershendetje, dua nje Bluze ju lutem",
      hasPhoto: false,
    });
    expect(r.nextState).toMatchObject({
      product_id: "product-a",
      step_key: "collect_size",
    });
    expect(r.productName).toBe("Bluzë");
    expect(
      r.workflowProgress.some(
        (s) => s.key === "collect_size" && s.status === "current",
      ),
    ).toBe(true);
  });
});

it("keeps an order untouched when answering a document inquiry", async () => {
  const state = {
    ...emptyState(),
    product_id: "product-a",
    step_key: "awaiting_photo",
    fields: { collect_size: "M" },
  };
  mocks.retrieve.mockResolvedValue({
    context: { query: "katalog", requirements: {}, turns: 0 },
    clarification: null,
    documents: [
      {
        id: "cat-a",
        title: "Katalog",
        url: "https://agjenti.app/api/catalogs/share/token",
      },
    ],
    evidence: "Pumps: 400 L/min, page 3",
  });
  const result = await processAgentTurn({
    businessId: "business-a",
    message: "Më dërgo katalogun",
    hasPhoto: false,
    state,
  });
  expect(result.nextState.step_key).toBe("awaiting_photo");
  expect(result.nextState.fields.collect_size).toBe("M");
  expect(result.workflowId).toBe("workflow-a");
  expect(result.reply).toContain(
    "https://agjenti.app/api/catalogs/share/token",
  );
  expect(result.debug.retrievedCatalogIds).toEqual(["cat-a"]);
  expect(mocks.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      documentContext: expect.stringContaining("400 L/min"),
      previousResponseId: null,
    }),
  );
  expect(state.fields).toEqual({ collect_size: "M" });
});

it("captures real context and workflow without changing the production result", async () => {
  const onTrace = vi.fn();
  const input = { businessId: "business-a", message: "Bluzë", hasPhoto: false };
  const production = await processAgentTurn(input);
  const test = await processAgentTurn({ ...input, mode: "test", source: "admin_chat_lab", onTrace });
  expect({ ...test, debug: { ...test.debug, elapsedMs: 0 } }).toEqual({ ...production, debug: { ...production.debug, elapsedMs: 0 } });
  expect(onTrace.mock.calls.map(([event]) => event.label)).toEqual(["Message received", "loadBusinessContext", "Business context loaded", "Intent routed", "Context retrieval completed", "Workflow resolved"]);
  expect(onTrace.mock.calls.at(-1)?.[0].data).toMatchObject({ workflowId: "workflow-a", state: { step_key: "collect_size" }, steps: [{ key: "collect_size", required: true }, { key: "awaiting_photo", required: true }, { key: "collect_customer", required: true }] });
});

it("keeps the sealed order steps when the product is assigned to a new workflow", async () => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "snapshot-test-key");
  try {
    const first = await processAgentTurn({businessId:"business-a",message:"Bluzë",hasPhoto:false});
    expect(first.nextState.orderWorkflowSnapshot).toBeTruthy();
    fixtures.products = [{id:"product-a",name:"Bluzë",product_type_id:"type-a",workflow_id:"workflow-new"}];
    fixtures.workflows = {id:"workflow-new",name:"New"};
    fixtures.workflow_steps = [{key:"new_question",kind:"text",position:0},{key:"customer",kind:"customer",position:1}];
    queries = [];
    const next = await processAgentTurn({businessId:"business-a",message:"M",hasPhoto:false,state:first.nextState});
    expect(next.workflowId).toBe("workflow-a");
    expect(next.nextState.step_key).toBe("awaiting_photo");
    expect(queries.some(q => q.table === "workflow_steps")).toBe(false);
    await expect(processAgentTurn({businessId:"business-b",message:"M",hasPhoto:false,state:first.nextState})).rejects.toThrow("nuk u verifikua");
  } finally { vi.unstubAllEnvs(); }
});
it("resolves a pre-upgrade order from the workflow id persisted by the inbound server", async () => {
  fixtures.products = [{id:"product-a",name:"Bluzë",workflow_id:"workflow-new"}];
  fixtures.workflows = {id:"workflow-old",name:"Original"};
  const state = {...emptyState(),product_id:"product-a",step_key:"collect_size"};
  const result = await processAgentTurn({businessId:"business-a",message:"M",hasPhoto:false,state,persistedWorkflowId:"workflow-old"});
  expect(result.workflowId).toBe("workflow-old");
  expect(queries.find(q => q.table === "workflows")?.filters).toContainEqual(["id","workflow-old"]);
  expect(queries.find(q => q.table === "workflows")?.filters).toContainEqual(["business_id","business-a"]);
});

it("pins linear product versions and reuses a phone collected before product selection", async () => {
  const {migrateContext,extractExplicitFacts}=await import("@/lib/workflows/context");
  fixtures.linear_workflow_versions={id:"version-a",name:"Saved order",steps:[{key:"customer",kind:"customer"}]};
  const state=migrateContext(emptyState());extractExplicitFacts(state,"Telefon: +355691234567");
  const first=await processAgentTurn({businessId:"business-a",message:"Bluzë",hasPhoto:false,state});
  expect(first.nextState.context?.execution.linear?.versionId).toBe("version-a");
  expect(first.reply).not.toContain("telefonin");
  fixtures.linear_workflow_versions={id:"version-b",name:"New order",steps:[{key:"photo",kind:"photo"}]};
  const second=await processAgentTurn({businessId:"business-a",message:"Emri: Ana; Qyteti: Tiranë; Adresa: Rruga A",hasPhoto:false,state:first.nextState});
  expect(second.nextState.context?.execution.linear?.versionId).toBe("version-a");
  expect(second.nextState.step_key).toBe("order_confirm");
  const third=await processAgentTurn({businessId:"business-a",message:"po",hasPhoto:false,state:second.nextState});
  expect(third.nextState.step_key).toBe("order_ready");expect(third.reply).toContain("gati për stafin");
  expect(queries.some(q=>["orders","order_items","conversation_profiles"].includes(q.table))).toBe(false);
});


it("preserves a sealed legacy order when shared context is enabled after reassignment", async () => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "snapshot-test-key");
  try {
    const first = await processAgentTurn({businessId:"business-a",message:"Bluzë",hasPhoto:false});
    vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "business-a");
    fixtures.products = [{id:"product-a",name:"Bluzë",workflow_id:"workflow-new"}];
    first.nextState.linearSnapshot = {id:"workflow-new",versionId:"new",name:"New",steps:[{key:"customer",kind:"customer"}]};
    queries = [];
    const next = await processAgentTurn({businessId:"business-a",message:"M",hasPhoto:false,state:first.nextState});
    expect(next.workflowId).toBe("workflow-a");
    expect(next.nextState.context?.execution.linear?.steps[0].key).toBe("collect_size");
    expect(next.nextState.step_key).toBe("awaiting_photo");
    expect(queries.some(q => ["workflow_steps", "linear_workflow_versions"].includes(q.table))).toBe(false);
  } finally { vi.unstubAllEnvs(); }
});

it("returns to the previous product step and preserves collected customer and order data", async()=>{
 const state={...emptyState(),product_id:"product-a",step_key:"awaiting_photo",fields:{collect_size:"M"},customer:{name:"Ana",phone:"+355691234567",city:"Tiranë",address:"Rruga A"}};
 const back=await processAgentTurn({businessId:"business-a",state,message:"Kthehu pas",hasPhoto:false});
 expect(back.nextState.step_key).toBe("collect_size");
 expect(back.nextState.fields.collect_size).toBe("M");
 expect(back.nextState.customer).toEqual(state.customer);
 const corrected=await processAgentTurn({businessId:"business-a",state:back.nextState,message:"L",hasPhoto:false});
 expect(corrected.nextState.step_key).toBe("awaiting_photo");
 expect(corrected.nextState.fields.collect_size).toBe("L");
 expect(corrected.nextState.recentMessages?.map(m=>m.role)).toEqual(["user","assistant","user","assistant"]);
});
it("does not record an informational question as a product answer",async()=>{
 const state={...emptyState(),product_id:"product-a",step_key:"collect_size",fields:{},customer:{name:"Ana",phone:null,city:null,address:null}};
 const next=await processAgentTurn({businessId:"business-a",state,message:"Sa kushton dërgesa?",hasPhoto:false});
 expect(next.nextState.step_key).toBe("collect_size");
 expect(next.nextState.fields.collect_size).toBeUndefined();
 expect(next.nextState.customer).toEqual(state.customer);
 expect(mocks.generate.mock.calls.at(-1)?.[0].instructions).toContain("informational question");
});
it("reopens a known shared field, retains other facts and invalidates final approval",async()=>{
 const {migrateContext,setFact}=await import("@/lib/workflows/context");
 const state=migrateContext({...emptyState(),product_id:"product-a",step_key:"order_ready"});
 state.context!.execution.linear={id:"workflow-a",versionId:"v1",name:"Order",steps:[{key:"size",kind:"choice",label:"Madhësia"},{key:"customer",kind:"customer",label:"Adresa"}]};
 setFact(state,"size","M","text","step:size");setFact(state,"customer_name","Ana","text","message");setFact(state,"customer_phone","+355691234567","phone","message");setFact(state,"customer_city","Tiranë","text","message");setFact(state,"customer_address","Rruga A","text","message");
 state.context!.execution.orderConfirmed=true;
 const back=await processAgentTurn({businessId:"business-a",state,message:"Ndrysho madhësinë",hasPhoto:false});
 expect(back.nextState.step_key).toBe("size");expect(back.nextState.context?.execution.orderConfirmed).toBe(false);
 expect(back.nextState.context?.order.size.value).toBe("M");
 const correction=await processAgentTurn({businessId:"business-a",state:back.nextState,message:"L",hasPhoto:false});
 expect(correction.nextState.context?.order.size.value).toBe("L");
 expect(correction.nextState.customer).toEqual(state.customer);
 expect(correction.nextState.step_key).toBe("order_confirm");
 expect(correction.nextState.context?.execution.orderConfirmed).toBe(false);
 const confirmed=await processAgentTurn({businessId:"business-a",state:correction.nextState,message:"Po",hasPhoto:false});
 expect(confirmed.nextState.step_key).toBe("order_ready");
});

it("treats a routed request to resume ordering as navigation, not a size answer",async()=>{
 const state={...emptyState(),product_id:"product-a",step_key:"collect_size",fields:{color:"blue"}};
 const turn=await processAgentTurn({businessId:"business-a",state,message:"Fola në WhatsApp dhe dua të porosis",hasPhoto:false,orderRequest:true});
 expect(turn.nextState.step_key).toBe("collect_size");
 expect(turn.nextState.fields).toEqual({color:"blue"});
});
it("allows collecting a later step first, then asks for missing required fields before completing",async()=>{
 const guidance=await import("@/lib/workflows/guidance");
 const spy=vi.spyOn(guidance,"chooseGuidance").mockResolvedValueOnce({action:"route",target:"collect_customer",source:"ai"});
 try {
  const state={...emptyState(),product_id:"product-a",step_key:"collect_size"};
  const routed=await processAgentTurn({businessId:"business-a",state,message:"Dua të jap adresën tani",hasPhoto:false});
  expect(routed.nextState.step_key).toBe("collect_customer");
  const address=await processAgentTurn({businessId:"business-a",state:routed.nextState,message:"Emri: Ana; Telefon: +355691234567; Qyteti: Tiranë; Adresa: Rruga A",hasPhoto:false});
  expect(address.nextState.customer.name).toBe("Ana");
  expect(address.nextState.step_key).toBe("collect_size");
  const size=await processAgentTurn({businessId:"business-a",state:address.nextState,message:"M",hasPhoto:false});
  expect(size.nextState.step_key).toBe("awaiting_photo");
 } finally {spy.mockRestore();}
});

it("routes every message through staff, ordering and back while preserving a live order",async()=>{
 const {starterVisualGraph}=await import("@/lib/workflows/visual/model");
 const graph=starterVisualGraph();
 graph.nodes.find(n=>n.id==="support")!.config={condition:"field_equals",fieldKey:"channel",value:"whatsapp"};
 const visualPreview={id:"v1",businessId:"business-a",graph,createdAt:"2026-10-10T00:00:00Z"};
 const state={...emptyState(),visual:{versionId:"v1",nodeId:"handoff",status:"handoff" as const,awaiting:false,visited:["start","support","handoff"],values:{channel:"whatsapp"}}};
 const resume=await processAgentTurn({businessId:"business-a",mode:"test",visualPreview,state,message:"Ok fola në WhatsApp dhe dua të porosis produkt",hasPhoto:false});
 expect(resume.nextState.visual?.nodeId).toBe("product");
 expect(resume.nextState.step_key).toBe("choose_product");
 const product=await processAgentTurn({businessId:"business-a",mode:"test",visualPreview,state:resume.nextState,message:"Bluzë",hasPhoto:false});
 expect(product.nextState.step_key).toBe("collect_size");
 const staff=await processAgentTurn({businessId:"business-a",mode:"test",visualPreview,state:product.nextState,message:"Dua të flas me stafin",hasPhoto:false});
 expect(staff.nextState.visual?.status).toBe("handoff");
 expect(staff.advisoryHandoff).toBe(true);
 const back=await processAgentTurn({businessId:"business-a",mode:"test",visualPreview,state:staff.nextState,message:"Fola me stafin, tani dua të porosis",hasPhoto:false});
 expect(back.nextState.product_id).toBe("product-a");
 expect(back.nextState.step_key).toBe("collect_size");
 expect(back.nextState.fields.collect_size).toBeUndefined();
 const size=await processAgentTurn({businessId:"business-a",mode:"test",visualPreview,state:back.nextState,message:"M",hasPhoto:false});
 expect(size.nextState.fields.collect_size).toBe("M");
 expect(size.nextState.step_key).toBe("awaiting_photo");
});
it("switches the selected product on a new explicit order request without inheriting old product fields",async()=>{
 fixtures.products=[{id:"product-a",name:"Bluzë",workflow_id:"workflow-a"},{id:"product-b",name:"Filxhan",workflow_id:"workflow-b"}];
 fixtures.workflows={id:"workflow-b",name:"Filxhan"};
 const state={...emptyState(),product_id:"product-a",step_key:"collect_size",fields:{collect_size:"M"},customer:{name:"Ana",phone:"+355691234567",city:"Tiranë",address:"Rruga A"}};
 const turn=await processAgentTurn({businessId:"business-a",state,message:"Dua të porosis Filxhan",hasPhoto:false,orderRequest:true});
 expect(turn.nextState.product_id).toBe("product-b");
 expect(turn.nextState.fields.collect_size).toBeUndefined();
 expect(turn.nextState.customer).toEqual(state.customer);
 expect(turn.workflowId).toBe("workflow-b");
});
