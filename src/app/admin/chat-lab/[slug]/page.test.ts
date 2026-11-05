import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const m = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), access: vi.fn(), from: vi.fn(), draft: vi.fn(), eq: vi.fn(), order: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, isPlatformAdmin: m.admin, requireBusinessAccess: m.access }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("@/lib/agents/communication-configuration", () => ({ loadCommunicationDraft: m.draft }));
vi.mock("@/lib/agents/training/actions", () => ({ listAgentTraining: vi.fn(), saveAgentTraining: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`); }, notFound: () => { throw Error("not-found"); } }));
import Page from "./page";
const render = async (draft?: string) => renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve({ draft }) }));
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "operator" });
  m.admin.mockResolvedValue(true);
  m.access.mockResolvedValue({ business: { id: "tenant", slug: "demo", name: "Demo" } });
  m.from.mockReturnValue({ select: () => ({ eq: m.eq }) });
  m.eq.mockReturnValue({ order: m.order });
  m.order.mockResolvedValue({ data: [{ id: "draft-a", name: "Agent", configuration_revision: 2, configuration_draft: { baseRevision: 2 } }], error: null });
  m.draft.mockResolvedValue({});
});
it("denies business members before loading privileged configuration", async () => {
  m.admin.mockResolvedValue(false);
  await expect(render()).rejects.toThrow("redirect:/auth/continue");
  expect(m.from).not.toHaveBeenCalled();
  expect(m.access).not.toHaveBeenCalled();
});
it("scopes draft selection to the authorized business and preserves advanced controls", async () => {
  const html = await render("draft-a");
  expect(m.eq).toHaveBeenCalledWith("business_id", "tenant");
  expect(m.draft).toHaveBeenCalledWith("tenant", "draft-a");
  expect(html).toContain("Simulo foto");
  expect(html).toContain("Eksporto bisedën");
  expect(html).toContain("Rrjedha");
  expect(html).toContain('aria-checked="false" disabled=""');
});
it("does not silently use published configuration when the requested draft is invalid", async () => {
  m.draft.mockRejectedValue(Error("foreign or stale"));
  const html = await render("foreign-draft");
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('id="agent-test-message"');
});
it("keeps published testing available and reports failure to load the draft list", async () => {
  m.order.mockResolvedValue({ data: null, error: { message: "offline" } });
  const html = await render();
  expect(html).toContain("Lista e drafteve nuk u ngarkua");
  expect(html).toContain('id="agent-test-message"');
});
