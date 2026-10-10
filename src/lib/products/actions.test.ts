import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  bindings: vi.fn(),
  or: vi.fn(),
}));
vi.mock("./workflow-binding", () => ({ publishedProductBindings: m.bindings }));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: m.user,
  requireBusinessAccess: m.access,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: m.from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { bulkConfigureProducts, createProduct, updateProduct } from "./actions";
let rows: Record<string, unknown>[];
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  m.bindings.mockResolvedValue(new Map());
  rows = [
    { id, product_type_id: "type", workflow_id: "workflow", price_amount: 25 },
  ];
  m.user.mockResolvedValue({ id: "user" });
  m.access.mockResolvedValue({ business: { id: "business" } });
  m.from.mockImplementation(() => {
    let writing = false;
    const q = {
      select: vi.fn(() => q),
      eq: vi.fn(() => q),
      in: vi.fn(() => q),
      not: vi.fn(() => q),
      or: vi.fn((filter: string) => { m.or(filter); return q; }),
      update: vi.fn((v) => {
        writing = true;
        m.update(v);
        return q;
      }),
      insert: vi.fn((v) => {
        writing = true;
        m.insert(v);
        return q;
      }),
      maybeSingle: vi.fn(async () => ({ data: { id } })),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: writing ? rows.map((p) => ({ id: p.id })) : rows,
          error: null,
        }).then(resolve),
    };
    return q;
  });
});

it("bulk activates verified visual assignments while retaining tenant-scoped selection", async () => {
  rows[0].workflow_id = null;
  m.bindings.mockResolvedValue(new Map([[id, { versionId: "v", flowId: "order", name: "Porositë" }]]));
  expect((await bulkConfigureProducts("test", payload)).success).toBeTruthy();
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ is_active: true }));
  expect(m.or).toHaveBeenCalledWith(`workflow_id.not.is.null,id.in.(${id})`);
});
it("refuses to activate a product with only a draft or disabled visual assignment", async () => {
  rows[0].workflow_id = null;
  expect((await bulkConfigureProducts("test", payload)).error).toContain("workflow");
  expect(m.update).not.toHaveBeenCalled();
});
it("edits an active product linked to a published visual flow without demanding a linear definition", async () => {
  m.bindings.mockResolvedValue(new Map([[id, { versionId: "v", flowId: "order", name: "Porositë" }]]));
  const form = new FormData();
  Object.entries({ name: "Puzzle", currency: "EUR", price: "25", product_type_id: "00000000-0000-4000-8000-000000000003", product_id: id, is_active: "on" }).forEach(([key,value])=>form.set(key,value));
  expect((await updateProduct("test", form)).success).toBeTruthy();
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ workflow_id: null, is_active: true }));
});
const payload = {
  ids: [id],
  productTypeId: null,
  workflowId: null,
  mode: "activate" as const,
};
describe("catalog writes", () => {
  it("enforces authentication and tenant ownership for bulk edits", async () => {
    m.user.mockResolvedValue(null);
    expect((await bulkConfigureProducts("test", payload)).error).toBeTruthy();
    expect(m.update).not.toHaveBeenCalled();
    m.user.mockResolvedValue({ id: "u" });
    rows = [];
    expect((await bulkConfigureProducts("test", payload)).error).toBeTruthy();
    expect(m.update).not.toHaveBeenCalled();
  });
  it("does not activate a partial selection when any product lacks required setup", async () => {
    rows = [
      {
        id,
        price_amount: null,
        product_type_id: "type",
        workflow_id: "workflow",
      },
    ];
    expect((await bulkConfigureProducts("test", payload)).error).toContain(
      "çmim",
    );
    expect(m.update).not.toHaveBeenCalled();
  });
  it("maps and activates selected tenant products in one mutation", async () => {
    expect(
      (
        await bulkConfigureProducts("test", {
          ...payload,
          productTypeId: "type",
          workflowId: "workflow",
        })
      ).success,
    ).toBeTruthy();
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: true,
        product_type_id: "type",
        workflow_id: "workflow",
      }),
    );
  });
  it("allows incomplete drafts but blocks incomplete active products", async () => {
    const form = new FormData();
    form.set("name", "Puzzle");
    form.set("currency", "EUR");
    form.set("is_active", "on");
    expect((await createProduct("test", form)).error).toBeTruthy();
    expect(m.insert).not.toHaveBeenCalled();
    form.set("save_mode", "draft");
    expect((await createProduct("test", form)).success).toBeTruthy();
    expect(m.insert).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false, price_amount: null }),
    );
    form.set("product_id", id);
    expect((await updateProduct("test", form)).success).toBeTruthy();
  });
});
