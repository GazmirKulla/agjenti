import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  queries: [] as { table: string; filters: unknown[][] }[],
  flows: [] as unknown[],
  products: [] as unknown[],
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }),
}));
import { prepareOrderFlow, loadOrderFlows, refineOrderFlowProposal } from "./orderflow-service";
import { executeTicket, openTicket, type Access } from "./service";
import { parseOrderSteps } from "@/lib/workflows/order-definition";
const workflowId = "11111111-1111-4111-8111-111111111111",
  productId = "22222222-2222-4222-8222-222222222222";
const access: Access = {
  businessId: "business",
  userId: "owner",
  modules: ["workflows", "products"],
  catalogSource: "internal",
};
const steps = [
  {
    key: "customer",
    kind: "customer",
    label: "Emri, telefoni dhe adresa?",
    required: true,
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  m.queries.length = 0;
  process.env.TOKEN_ENCRYPTION_KEY = "orderflow-test-key";
  m.flows = [
    {
      id: workflowId,
      name: "Porosia",
      workflow_steps: steps.map((s, i) => ({
        ...s,
        position: i,
        config: { label: s.label },
      })),
    },
  ];
  m.products = [
    {
      id: productId,
      name: "Barrierë",
      workflow_id: workflowId,
      updated_at: "2026-10-10T10:00:00Z",
    },
  ];
  m.from.mockImplementation((table: string) => {
    const query = { table, filters: [] as unknown[][] };
    m.queries.push(query);
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => {
        query.filters.push(args);
        return chain;
      },
      order: () => chain,
      limit: async () => ({
        data: table === "products" ? m.products : m.flows,
        error: null,
      }),
    };
    return chain;
  });
  m.rpc.mockResolvedValue({ error: null });
});
it("requires both modules and reads only tenant-owned workflows/products", async () => {
  await expect(
    loadOrderFlows({ ...access, modules: ["workflows"] }),
  ).rejects.toThrow();
  expect(m.from).not.toHaveBeenCalled();
  await loadOrderFlows(access, workflowId);
  expect(
    m.queries.every((q) =>
      q.filters.some((f) => f[0] === "business_id" && f[1] === "business"),
    ),
  ).toBe(true);
  expect(m.queries[0].filters).toContainEqual(["id", workflowId]);
});
it("shows affected products, preserves the source and writes only after confirmation", async () => {
  const result = await prepareOrderFlow(access, {
    action: "orderflow_update",
    id: workflowId,
    message: "Kontrollo",
    changes: [
      { field: "name", value: "Porosia e re" },
      { field: "scope", value: "all" },
    ],
  });
  expect(result.preview?.fields.some((f) => f.label === "Barrierë")).toBe(true);
  expect(m.rpc).not.toHaveBeenCalled();
  const ticket = openTicket(result.token!, access);
  expect(ticket.id).not.toBe(workflowId);
  expect(ticket.before?.id).toBe(workflowId);
  await executeTicket(access, result.token!);
  expect(m.rpc).toHaveBeenCalledWith(
    "apply_assistant_orderflow",
    expect.objectContaining({
      p_business: "business",
      p_user: "owner",
      p_request: ticket.id,
      p_before: ticket.before,
    }),
  );
});
it("refuses ambiguous scope, external catalogs, stale sources and unrelated products", async () => {
  const proposal = {
    action: "orderflow_update" as const,
    id: workflowId,
    message: "",
    changes: [{ field: "name", value: "New" }],
  };
  await expect(prepareOrderFlow(access, proposal)).rejects.toThrow("të gjitha");
  await expect(
    prepareOrderFlow({ ...access, catalogSource: "external" }, proposal),
  ).rejects.toThrow("jashtëm");
  await expect(
    prepareOrderFlow(access, proposal, {
      id: workflowId,
      name: "Old",
      steps: [],
    }),
  ).rejects.toThrow("gjatë analizës");
  m.products = [
    { id: productId, name: "Barrierë", workflow_id: null, updated_at: "v1" },
  ];
  await expect(
    prepareOrderFlow(access, {
      ...proposal,
      changes: [
        ...proposal.changes,
        { field: "scope", value: "selected" },
        { field: "product_ids", value: JSON.stringify([productId]) },
      ],
    }),
  ).rejects.toThrow("përdorin këtë rrjedhë");
});
it("validates executable step ordering and refuses unsupported capabilities", () => {
  expect(parseOrderSteps(steps)).toEqual(steps);
  for (const invalid of [
    [],
    [{ ...steps[0], kind: "payment" }],
    [steps[0], { key: "after_customer", kind: "text", label: "Too late" }],
    [{ ...steps[0], required: false }],
    [{ ...steps[0], key: "__proto__" }],
  ])
    expect(() => parseOrderSteps(invalid)).toThrow();
});

it("retains unconfirmed steps and product scope during a name correction",async()=>{
  const original=await prepareOrderFlow(access,{action:"orderflow_update",id:workflowId,message:"",changes:[{field:"name",value:"Emri i parë"},{field:"scope",value:"all"}]});
  const ticket=openTicket(original.token!,access);
  const refined=refineOrderFlowProposal(ticket,{action:"orderflow_update",id:workflowId,message:"",changes:[{field:"name",value:"Emri i korrigjuar"}]});
  const fields=Object.fromEntries(refined.changes.map(c=>[c.field,c.value]));
  expect(fields.name).toBe("Emri i korrigjuar");
  expect(fields.scope).toBe("all");
  expect(JSON.parse(fields.steps)).toEqual(steps);
  expect(()=>refineOrderFlowProposal(ticket,{...refined,id:productId})).toThrow("rrjedhë tjetër");
});
