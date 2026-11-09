import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn(), access: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { manageCustomer } from "./actions";

const id = "11111111-2222-3333-4444-555555555555";
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "owner" });
  m.access.mockResolvedValue({ admin: false, business: { id: "b1", slug: "shop" } });
  m.rpc.mockResolvedValue({ data: { action: "archive" }, error: null });
});

describe("managing customers", () => {
  it("archives through the database function for the verified user and business", async () => {
    expect(await manageCustomer("shop", id, "archive")).toEqual({ success: expect.stringContaining("Të arkivuar") });
    expect(m.rpc).toHaveBeenCalledWith("manage_customer", { p_business: "b1", p_user: "owner", p_customer: id, p_action: "archive" });
    expect(m.revalidate).toHaveBeenCalledWith("/b/shop/customers");
  });
  it("reports deleted orders and that conversations stay", async () => {
    m.rpc.mockResolvedValue({ data: { action: "delete", orders: 2, conversations_kept: 1 }, error: null });
    const result = await manageCustomer("shop", id, "delete");
    expect(result.success).toContain("2 porosi");
    expect(result.success).toContain("Bisedat mbeten");
  });
  it("explains that only the owner may remove customers", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "customer_forbidden" } });
    expect(await manageCustomer("shop", id, "delete")).toEqual({ error: expect.stringContaining("pronari") });
  });
  it("rejects unknown actions and ids without touching the database", async () => {
    expect((await manageCustomer("shop", "nope", "archive")).error).toBeTruthy();
    expect((await manageCustomer("shop", id, "wipe" as never)).error).toBeTruthy();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("refuses people without access to the business", async () => {
    m.access.mockResolvedValue(null);
    expect((await manageCustomer("other", id, "archive")).error).toContain("qasje");
  });
});
