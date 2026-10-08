import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), from: vi.fn(), rpc: vi.fn(), enqueue: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/discovery/queue", () => ({ enqueueDiscovery: m.enqueue, runDiscoveryQueue: vi.fn() }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { GET, POST } from "./route";
import { emptyDraft, mergeDraft, parseEntities, value, type Draft } from "@/lib/business-intelligence/model";
import { generateDashboardProfile } from "@/lib/dashboard/profile/generate";
import { basicInstructions } from "@/lib/onboarding/model";
import { signalsFor, withSetupRecommendations } from "@/lib/discovery/proposal";

let state: { draft: Draft; revision: number; intelligence_revision: number; baseline: object; signals: object; confirmed_at: string | null };
let intelligence: { data: Draft; revision: number };
let jobs: unknown[];
const request = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/business-discovery?slug=test", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const readRequest = () => new Request("http://localhost/api/business-discovery?slug=test");
const product = (price: string) => parseEntities([{ target: "product", facts: [{ field: "name", value: "Bluza" }, { field: "price", value: price }, { field: "currency", value: "EUR" }] }], "manual", "test", "")[0];
beforeEach(() => {
  vi.clearAllMocks();
  state = { draft: { ...emptyDraft(), entities: [product("10")] }, revision: 2, intelligence_revision: 0, baseline: { business: { name: "Studio" }, agents: [] }, signals: { businessType: "fashion", offeringTypes: ["standard"] }, confirmed_at: null };
  intelligence = { data: structuredClone(state.draft), revision: 0 }; jobs = [];
  m.user.mockResolvedValue({ id: "verified-user" });
  m.access.mockResolvedValue({ business: { id: "server-business", name: "Studio", slug: "test" } });
  m.rpc.mockResolvedValue({ data: true, error: null });
  m.from.mockImplementation((table: string) => {
    const result = () => ({ data: table === "business_discovery" ? state : table === "business_intelligence" ? intelligence : table === "business_discovery_jobs" ? jobs : null, error: null });
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, single: async () => result(), maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return q;
  });
});
describe("discovery API boundary", () => {
  it("persists omitted sections and module choices, keeping them after GET and applying only allowed entities", async () => {
    const productId = state.draft.entities[0].id;
    const profile = parseEntities([{ target: "profile", facts: [{ field: "name", value: "Studio" }] }], "manual", "test", "")[0];
    state.draft.entities.push(profile);
    const preferences = { excludedTargets: ["product"], excludedEntityIds: [productId], enabledModules: ["knowledge", "orders"] };
    expect((await POST(request({ action: "save", revision: 2, intelligenceRevision: 0, reviewPreferences: preferences }))).status).toBe(200);
    state.draft = m.rpc.mock.calls[0][1].p_draft; state.revision++;
    const loaded = await (await GET(readRequest())).json();
    expect(loaded.draft.reviewPreferences.excludedTargets).toEqual(["product"]);
    expect(loaded.dashboardProfile.enabledModules).not.toContain("products");
    expect(loaded.dashboardProfile.enabledModules).not.toContain("orders");
    expect((await POST(request({ action: "confirm", revision: 3, intelligenceRevision: 0, confirmed: true, selected: [productId, profile.id] }))).status).toBe(400);
    expect((await POST(request({ action: "confirm", revision: 3, intelligenceRevision: 0, confirmed: true, selected: [profile.id] }))).status).toBe(200);
    const args = m.rpc.mock.calls.at(-1)![1];
    expect(args.p_entities.map((e: { id: string }) => e.id)).toEqual([profile.id]);
    expect(args.p_profile.enabledModules).not.toContain("products");
    expect(args.p_profile.source).toBe("manual");
  });
  it("normalizes an existing Lek draft and reports the remaining price issue before confirmation", async () => {
    const e = state.draft.entities[0];
    e.facts.find((fact) => fact.field === "currency")!.value = "Lek";
    e.facts.find((fact) => fact.field === "price")!.value = "-2";
    const response = await POST(request({ action: "confirm", revision: 2, intelligenceRevision: 0, selected: [e.id], confirmed: true }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_failed", issues: [{ entityId: e.id, field: "price" }] });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("reports missing fields only for selected entities and allows saving a partial correction", async () => {
    const e = product(""); state.draft.entities.push(e);
    const payload = { action: "confirm", revision: 2, intelligenceRevision: 0, selected: [e.id], confirmed: true };
    const response = await POST(request(payload));
    expect(await response.json()).toMatchObject({ code: "validation_failed", issues: [{ entityId: e.id, field: "price" }] });
    expect(m.rpc).not.toHaveBeenCalled();
    expect((await POST(request({ ...payload, action: "save", edits: [{ id: e.id, values: { currency: "ALL" } }] }))).status).toBe(200);
    expect(m.rpc.mock.calls[0][0]).toBe("save_business_discovery");
  });
  it("distinguishes changed platform data from storage failures without exposing database details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = { action: "confirm", revision: 2, intelligenceRevision: 0, selected: [state.draft.entities[0].id], confirmed: true };
    m.rpc.mockResolvedValue({ error: { code: "P0001", message: "platform_changed" } });
    expect(await (await POST(request(payload))).json()).toMatchObject({ code: "platform_changed", error: expect.stringContaining("Rifresko nga paneli") });
    m.rpc.mockResolvedValue({ error: { code: "23505", message: "PRIVATE DATABASE DETAIL" } });
    const response = await (await POST(request(payload))).json();
    expect(response.code).toBe("save_failed");
    expect(JSON.stringify(response)).not.toContain("PRIVATE DATABASE DETAIL");
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE DATABASE DETAIL");
    log.mockRestore();
  });
  it("routes existing supported FAQ with authorized identity and removes it from onboarding review", async () => {
    const faq = parseEntities([{ target: "knowledge", facts: [{ field: "title", value: "Dërgesa", evidence: "Dërgesa" }, { field: "body", value: "Dy ditë", evidence: "Dy ditë" }] }], "website", "https://shop.test", "Dërgesa Dy ditë")[0];
    state.draft.entities.push(faq);
    m.rpc.mockResolvedValue({ data: { count: 1, inactiveCount: 0 }, error: null });
    expect((await POST(request({ action: "route_knowledge", revision: 2, intelligenceRevision: 0, businessId: "victim", userId: "victim" }))).status).toBe(200);
    const args = m.rpc.mock.calls[0][1];
    expect(m.rpc.mock.calls[0][0]).toBe("route_discovery_knowledge");
    expect(args).toMatchObject({ p_business: "server-business", p_user: "verified-user", p_knowledge: [faq] });
    expect(args.p_draft.entities.some((e: { target: string }) => e.target === "knowledge")).toBe(false);
  });
  it("rejects unauthenticated, cross-tenant and cross-origin requests before queuing", async () => {
    m.user.mockResolvedValue(null);
    expect((await POST(request({ action: "start", source: "instagram" }))).status).toBe(403);
    m.user.mockResolvedValue({ id: "user" }); m.access.mockResolvedValue(null);
    expect((await GET(readRequest())).status).toBe(403);
    expect((await POST(request({}, "https://attacker.test"))).status).toBe(403);
    expect(m.enqueue).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
  });
  it("uses session identity and authorized business rather than submitted IDs", async () => {
    expect((await POST(request({ action: "start", source: "instagram", businessId: "victim", userId: "victim", connectionId: "spoof" }))).status).toBe(200);
    expect(m.enqueue).toHaveBeenCalledWith("server-business", "verified-user", "instagram", undefined, false);
    expect(m.after).toHaveBeenCalled();
  });
  it("rejects oversized bodies and stale edits before writes", async () => {
    expect((await POST(request({ large: "x".repeat(512001) }))).status).toBe(400);
    expect((await POST(request({ action: "save", revision: 1, intelligenceRevision: 0 }))).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("persists manual correction without resurrecting conflicts from a previously merged revision", async () => {
    const id = state.draft.entities[0].id;
    expect((await POST(request({ action: "save", revision: 2, intelligenceRevision: 0, edits: [{ id, values: { price: "20" } }] }))).status).toBe(200);
    const saved = m.rpc.mock.calls[0][1];
    state = { ...state, draft: saved.p_draft, intelligence_revision: saved.p_intelligence_revision };
    const body = await (await GET(readRequest())).json();
    expect(value(body.draft.entities.find((e: { id: string }) => e.id === id), "price")).toBe("20");
    expect(body.draft.conflicts).toEqual([]);
    intelligence = { data: { ...emptyDraft(), entities: [product("30")] }, revision: 1 };
    expect((await (await GET(readRequest())).json()).draft.conflicts).toHaveLength(1);
  });
  it("requires review, known selected IDs and resolved conflicts", async () => {
    const id = state.draft.entities[0].id;
    const payload = { action: "confirm", revision: 2, intelligenceRevision: 0, selected: [id] };
    expect((await POST(request(payload))).status).toBe(400);
    expect((await POST(request({ ...payload, confirmed: true, selected: ["unknown"] }))).status).toBe(400);
    state.draft = mergeDraft(state.draft, [product("30")]);
    const response = await POST(request({ ...payload, confirmed: true }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "unresolved_conflicts", conflicts: [{ entityId: id, field: "price", name: "Bluza", label: "Çmimi" }] });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("saves keep-current decisions and confirms after reloading without bringing conflicts back", async () => {
    const id = state.draft.entities[0].id;
    state.draft = mergeDraft(state.draft, [product("30")]);
    expect((await POST(request({ action: "save", revision: 2, intelligenceRevision: 0, resolved: [`${id}:price`] }))).status).toBe(200);
    const saved = m.rpc.mock.calls[0][1];
    state.draft = saved.p_draft; state.revision++;
    const loaded = await (await GET(readRequest())).json();
    expect(loaded.draft.conflicts).toEqual([]);
    expect((await POST(request({ action: "confirm", revision: 3, intelligenceRevision: 0, confirmed: true, selected: [id] }))).status).toBe(200);
    expect(m.rpc.mock.calls.at(-1)?.[0]).toBe("confirm_business_discovery");
  });
  it("shows the prepared starter proposal on GET without writing to the database", async () => {
    const baseline = { business: { name: "Studio" }, agents: [{ id: "starter", is_active: false, instructions: basicInstructions("Studio") }] };
    const seeded = parseEntities([{ target: "profile", facts: [{ field: "name", value: "Studio" }] }, { target: "agent", facts: [{ field: "rules", value: basicInstructions("Studio") }] }], "manual", "platform", "");
    seeded[1].id = "starter"; seeded[1].facts[0].confirmedByUser = true;
    state.baseline = baseline; state.signals = signalsFor("ecommerce", ["standard"]);
    const proposed = withSetupRecommendations(emptyDraft(), signalsFor("ecommerce", ["standard"]), baseline).entities.find((e) => e.target === "agent")!;
    state.draft = mergeDraft({ ...emptyDraft(), entities: seeded }, [proposed]);
    const loaded = await (await GET(readRequest())).json();
    expect(loaded.draft.conflicts).toEqual([]);
    expect(value(loaded.draft.entities.find((e: { target: string }) => e.target === "agent"), "rules")).not.toBe(basicInstructions("Studio"));
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("confirms only selected complete entities and preserves manually configured dashboard modules", async () => {
    const manual = { ...generateDashboardProfile({ businessType: "services", offeringTypes: ["services"], selectedUseCases: [], agentCapabilities: [] }), source: "manual" };
    state.baseline = { business: { name: "Studio", dashboard_profile: manual }, agents: [] };
    const incomplete = product(""); state.draft.entities.push(incomplete);
    const id = state.draft.entities[0].id;
    expect((await POST(request({ action: "confirm", revision: 2, intelligenceRevision: 0, confirmed: true, selected: [id] }))).status).toBe(200);
    const args = m.rpc.mock.calls.find(([name]) => name === "confirm_business_discovery")![1];
    expect(args.p_entities).toHaveLength(1);
    expect(args.p_entities[0].facts.every((f: { confirmedByUser: boolean }) => f.confirmedByUser)).toBe(true);
    expect(args).toMatchObject({ p_business: "server-business", p_user: "verified-user", p_profile: { enabledModules: manual.enabledModules, source: "manual" } });
  });
  it("returns sanitized progress without captured texts, image URLs or connection secrets", async () => {
    jobs = [{ id: "job", source: "website", status: "queued", stage: "images", input: { url: "https://shop.test" }, checkpoint: { text: "PRIVATE CAPTURE", images: [{ url: "PRIVATE MEDIA" }], nextImage: 0 }, next_attempt_at: new Date(0).toISOString(), error: null }];
    const text = await (await GET(readRequest())).text();
    expect(text).not.toContain("PRIVATE CAPTURE"); expect(text).not.toContain("PRIVATE MEDIA");
    expect(JSON.parse(text).jobs[0]).toMatchObject({ progress: 30, canResume: true, imageCount: 1 });
  });
});
