import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveBusinessProcess } from "./process-actions";
const draft = { name: "Si porositet", summary: "Porosia bëhet në website", steps: [{ title: "Hap website-in", description: "Zgjidh materialet në website", evidence: "untrusted", sourceRef: "other" }], unknowns: [], enabled: false, businessId: "foreign" };
beforeEach(() => { vi.clearAllMocks(); m.user.mockResolvedValue({ id: "owner" }); m.access.mockResolvedValue({ business: { id: "tenant" } }); m.rpc.mockResolvedValue({ data: 2, error: null }); });
describe("business process customization", () => {
  it("derives tenant and author from authenticated access and makes later manual choices authoritative", async () => {
    expect(await saveBusinessProcess("studio", 1, draft)).toMatchObject({ revision: 2, process: { enabled: false, source: "manual" } });
    expect(m.rpc.mock.calls[0][1]).toMatchObject({ p_business: "tenant", p_user: "owner", p_revision: 1, p_process: { source: "manual", steps: [{ evidence: "", sourceRef: "manual" }] } });
    expect(JSON.stringify(m.rpc.mock.calls)).not.toContain("foreign");
  });
  it("rejects unauthorized changes and distinguishes stale saves without exposing database details", async () => {
    m.access.mockResolvedValueOnce(null);
    expect(await saveBusinessProcess("studio", 1, draft)).toHaveProperty("error");
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValueOnce({ error: { message: "stale_process" } });
    expect((await saveBusinessProcess("studio", 1, draft)).error).toContain("Rifresko");
    m.rpc.mockResolvedValueOnce({ error: { message: "private detail" } });
    expect(JSON.stringify(await saveBusinessProcess("studio", 1, draft))).not.toContain("private detail");
  });
});
