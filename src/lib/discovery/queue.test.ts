import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn(), normalize: vi.fn(), classify: vi.fn(), instagram: vi.fn(), website: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: () => { const chain = { select: () => chain, eq: () => chain, single: m.read, maybeSingle: m.read }; return chain; } }) }));
vi.mock("@/lib/business-intelligence/normalization", () => ({ normalizeSource: m.normalize }));
vi.mock("@/lib/business-intelligence/ingestion", () => ({ extractInstagram: m.instagram, extractWebsite: m.website }));
vi.mock("./proposal", async (original) => ({ ...await original<typeof import("./proposal")>(), classifyBusiness: m.classify }));
import { processDiscoveryStep, enqueueDiscovery, runDiscoveryQueue } from "./queue";
import { emptyDraft, parseEntities } from "@/lib/business-intelligence/model";

const job = { id: "job", business_id: "business", source: "website" as const, input: { url: "https://shop.test" }, stage: "capture", checkpoint: {}, lease_token: "lease", attempts: 1 };
beforeEach(() => { vi.clearAllMocks(); m.rpc.mockResolvedValue({ data: true, error: null }); m.read.mockResolvedValue({ data: null, error: null }); });
describe("resumable discovery worker", () => {
  it("captures server-fetched content and skips to images when captions have no useful facts", async () => {
    m.instagram.mockResolvedValue({ text: "", reference: "ig:test", note: "100 posts", images: [{ id: "photo", url: "https://cdn.test/1.jpg" }], postCount: 100, website: null });
    m.read.mockResolvedValue({ data: { id: "connection" }, error: null });
    await processDiscoveryStep({ ...job, source: "instagram", input: { connectionId: "connection", generation: "gen" } });
    expect(m.rpc).toHaveBeenCalledWith("checkpoint_business_discovery", expect.objectContaining({ p_stage: "text", p_checkpoint: expect.objectContaining({ images: [{ id: "photo", url: "https://cdn.test/1.jpg" }] }) }));
    m.normalize.mockRejectedValue(new Error("Nuk u gjetën të dhëna"));
    await processDiscoveryStep({ ...job, stage: "text", checkpoint: { text: "", reference: "ig:test", images: [{ id: "photo", url: "https://cdn.test/1.jpg", caption: "", postUrl: null }] } });
    expect(m.rpc).toHaveBeenLastCalledWith("checkpoint_business_discovery", expect.objectContaining({ p_stage: "images" }));
  });
  it("retries vision failure, then preserves earlier results and continues after the third failure", async () => {
    const entities = parseEntities([{ target: "service", facts: [{ field: "name", value: "Cleaning" }] }], "manual", "test", "");
    const visual = { ...job, stage: "images", checkpoint: { text: "Cleaning", reference: "ig:1", entities, images: Array.from({ length: 6 }, (_, i) => ({ id: String(i), url: `https://cdn.test/${i}.jpg`, caption: "", postUrl: null })) } };
    m.normalize.mockRejectedValue(new Error("provider error SECRET"));
    await expect(processDiscoveryStep(visual)).rejects.toThrow();
    expect(m.rpc).not.toHaveBeenCalled();
    await processDiscoveryStep({ ...visual, attempts: 3 });
    expect(m.rpc).toHaveBeenCalledWith("checkpoint_business_discovery", expect.objectContaining({ p_stage: "images", p_checkpoint: expect.objectContaining({ entities, nextImage: 5, warnings: expect.any(Array) }) }));
    expect(JSON.stringify(m.rpc.mock.calls)).not.toContain("SECRET");
  });
  it("honors user classification and retries publication if the draft changed concurrently", async () => {
    const signals = { businessType: "services", offeringTypes: ["services"] };
    m.read.mockResolvedValue({ data: { draft: emptyDraft(), revision: 7, signals_source: "manual", signals, baseline: { business: { name: "Studio" }, agents: [] } }, error: null });
    m.rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: true, error: null });
    await processDiscoveryStep({ ...job, stage: "finish", checkpoint: { entities: [] } });
    expect(m.classify).not.toHaveBeenCalled();
    expect(m.rpc).toHaveBeenCalledWith("finish_business_discovery", expect.objectContaining({ p_revision: 7, p_signals: signals }));
    expect(m.rpc).toHaveBeenLastCalledWith("checkpoint_business_discovery", expect.objectContaining({ p_stage: "finish" }));
  });
  it("retains omitted sections and manual module choices when a later analysis finishes", async () => {
    const preferences = { excludedTargets: ["product"], excludedEntityIds: [], enabledModules: ["knowledge"] };
    m.read.mockResolvedValue({ data: { draft: { ...emptyDraft(), reviewPreferences: preferences }, revision: 7, signals_source: "manual", signals: { businessType: "ecommerce", offeringTypes: ["standard"] }, baseline: { business: { name: "Studio" }, agents: [] } }, error: null });
    const entities = parseEntities([{ target: "product", facts: [{ field: "name", value: "Bluza" }, { field: "price", value: "10" }, { field: "currency", value: "EUR" }] }], "manual", "test", "");
    await processDiscoveryStep({ ...job, stage: "finish", checkpoint: { entities } });
    const args = m.rpc.mock.calls.find(([name]) => name === "finish_business_discovery")![1];
    expect(args.p_draft.reviewPreferences).toEqual(preferences);
    expect(args.p_draft.entities.some((e: { target: string }) => e.target === "product")).toBe(true);
  });
  it("finishes a source scan by routing FAQ atomically, without applying products", async () => {
    const entities = parseEntities([{ target: "knowledge", facts: [{ field: "title", value: "Dërgesa", evidence: "Dërgesa" }, { field: "body", value: "Dy ditë", evidence: "Dy ditë" }] }], "website", "https://shop.test", "Dërgesa Dy ditë");
    m.read.mockResolvedValue({ data: { draft: emptyDraft(), revision: 7, signals_source: "manual", signals: { businessType: "ecommerce", offeringTypes: ["standard"] }, baseline: { business: { name: "Studio" }, agents: [] } }, error: null });
    await processDiscoveryStep({ ...job, stage: "finish", checkpoint: { entities } });
    const args = m.rpc.mock.calls.find(([name]) => name === "finish_scanned_business_discovery")![1];
    expect(args.p_knowledge).toEqual(entities);
    expect(args.p_draft.entities.some((e: { target: string }) => e.target === "knowledge")).toBe(false);
  });
  it("fences a disconnected/relinked Instagram account before fetching or publishing", async () => {
    await expect(processDiscoveryStep({ ...job, source: "instagram", input: { connectionId: "old", generation: "oldgen" } })).rejects.toThrow("connection_changed");
    expect(m.instagram).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("derives Instagram identity from the business and queues sanitized retry errors", async () => {
    m.read.mockResolvedValue({ data: { id: "server", discovery_generation: "generation" }, error: null });
    await enqueueDiscovery("business", "verified-user", "instagram");
    expect(m.rpc).toHaveBeenCalledWith("enqueue_business_discovery", expect.objectContaining({ p_input: { connectionId: "server", generation: "generation" } }));
    m.rpc.mockResolvedValueOnce({ data: [job], error: null }).mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: [], error: null });
    m.website.mockRejectedValue(new Error("SECRET"));
    expect(await runDiscoveryQueue("business")).toBe(1);
    expect(JSON.stringify(m.rpc.mock.calls)).not.toContain("SECRET");
  });
});
