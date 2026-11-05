import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, isPlatformAdmin: m.admin, requireBusinessAccess: m.access }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`); }, notFound: () => { throw Error("not-found"); } }));
import Page from "./page";
const open = (draft?: string) => Page({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve({ draft }) });
beforeEach(() => {
 vi.clearAllMocks(); m.user.mockResolvedValue({ id: "operator" }); m.admin.mockResolvedValue(true);
 m.access.mockResolvedValue({ business: { id: "tenant", slug: "demo" } });
});
it("denies tenant users before resolving a lab bookmark", async () => {
 m.admin.mockResolvedValue(false); await expect(open()).rejects.toThrow("redirect:/auth/continue"); expect(m.access).not.toHaveBeenCalled();
});
it("redirects old bookmarks to the single workspace, preserving business and draft", async () => {
 await expect(open("saved-draft")).rejects.toThrow("redirect:/admin/chat-lab?business=tenant&draft=saved-draft");
});
it("does not route an unknown business into another business's chat", async () => {
 m.access.mockResolvedValue(null); await expect(open()).rejects.toThrow("not-found");
});
