import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc }) }));
import { saveProductsWithVisualFlow, visualSelection } from "./visual-selection";
beforeEach(() => rpc.mockReset());
it("keeps visual references distinct from legacy UUIDs and rejects malformed revisions", () => {
  expect(visualSelection("11111111-1111-4111-8111-111111111111")).toBeNull();
  expect(visualSelection("visual:7:lead-flow")).toEqual({ revision: 7, flowId: "lead-flow" });
  expect(() => visualSelection("visual:-1:flow")).toThrow();
});
it("sends product and binding changes through one transaction and never publishes", async () => {
  rpc.mockResolvedValue({ data: 1, error: null });
  expect(await saveProductsWithVisualFlow("business", "owner", { flowId: "sales", revision: 4 }, "create", [{ name: "Product" }])).toHaveProperty("success");
  expect(rpc).toHaveBeenCalledExactlyOnceWith("save_products_with_visual_flow", { p_business: "business", p_user: "owner", p_revision: 4, p_flow: "sales", p_mode: "create", p_products: [{ name: "Product" }] });
});
it("reports stale revisions, missing migration and ambiguous acknowledgements without success", async () => {
  for (const result of [{ data: null, error: { code: "P0001", message: "stale_workflow" } }, { data: null, error: { code: "PGRST202", message: "missing" } }, { data: null, error: null }]) {
    rpc.mockResolvedValue(result);
    const saved = await saveProductsWithVisualFlow("b", "u", { flowId: "sales", revision: 1 }, "bind", [{ id: "p" }]);
    expect(saved.error).toBeTruthy(); expect(saved.success).toBeUndefined();
  }
});
