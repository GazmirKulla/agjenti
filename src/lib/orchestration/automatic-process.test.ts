import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ own: null as unknown, counts: { products: 1, product_variants: 0, booking_services: 1 } as Record<string, number>,
  calendar: { agent_booking_enabled: true } as unknown, modules: null as string[] | null, rpc: vi.fn(), isolated: false }));
vi.mock("@/lib/capabilities/enforcement", () => ({ runtimeModules: async () => m.modules }));
vi.mock("@/lib/runtime/execution-context", () => ({ isIsolatedExecution: () => m.isolated }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: (table: string) => {
  const query: Record<string, unknown> = {};
  const result = () => table === "visual_workflows" ? { data: m.own, error: null }
    : table === "business_calendar_settings" ? { data: m.calendar, error: null } : { count: m.counts[table] ?? 0, error: null };
  Object.assign(query, { select: () => query, eq: () => query, is: () => query, neq: () => query, not: () => query,
    maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) });
  return query;
} }) }));
import { automaticGraph, automaticReadiness, automaticVersionId, loadAutomaticVersion } from "./automatic-process";
import { compileVisualProcesses } from "./visual-definition";
import { validateVisualGraph } from "@/lib/workflows/visual/model";

const business = "00000000-0000-4000-8000-000000000001";
const facts: { modules: string[] | null; orderableProducts: boolean; bookingCalendar: boolean; bookableServices: boolean } = { modules: null, orderableProducts: true, bookingCalendar: true, bookableServices: true };
beforeEach(() => { m.own = null; m.modules = null; m.isolated = false; m.counts = { products: 1, product_variants: 0, booking_services: 1 };
  m.calendar = { agent_booking_enabled: true }; m.rpc.mockReset(); m.rpc.mockImplementation(async (_name: string, args: { p_id: string }) => ({ data: args.p_id, error: null })); });

describe("which processes the agent gets without a workflow of the owner's", () => {
  it("offers each process only when the business can deliver it, and says why not", () => {
    const ready = (f: Partial<typeof facts>) => Object.fromEntries(automaticReadiness({ ...facts, ...f }).map(r => [r.capability, r.ready]));
    expect(ready({})).toEqual({ orders: true, orderStatus: true, bookings: true, handoff: true });
    expect(ready({ orderableProducts: false })).toMatchObject({ orders: false, orderStatus: true });
    expect(ready({ bookingCalendar: false })).toMatchObject({ bookings: false });
    expect(ready({ bookableServices: false })).toMatchObject({ bookings: false });
    expect(ready({ modules: ["workflows", "inbox", "products"] })).toEqual({ orders: false, orderStatus: false, bookings: false, handoff: true });
    expect(ready({ modules: ["products", "orders", "inbox"] })).toEqual({ orders: false, orderStatus: false, bookings: false, handoff: false });
    expect(automaticReadiness({ ...facts, orderableProducts: false }).find(r => r.capability === "orders")?.reason).toContain("çmim");
  });

  it("builds a valid graph that the real engine compiles into an order, a status read, a booking and a handoff", () => {
    const graph = automaticGraph(automaticReadiness(facts))!;
    expect(validateVisualGraph(graph).errors).toEqual([]);
    const definitions = compileVisualProcesses({ id: "v", businessId: business, graph, createdAt: "" });
    const tools = (id: string) => definitions.find(d => d.id === id)!.steps.flatMap(s => s.kind === "effect" ? [s.tool] : s.kind === "handoff" ? ["handoff"] : []);
    expect(definitions.map(d => d.id)).toEqual(["auto_order", "auto_order_status", "auto_booking", "auto_handoff"]);
    expect(tools("auto_order")).toContain("order.create");
    expect(definitions.find(d => d.id === "auto_order")!.steps.some(s => s.kind === "confirm")).toBe(true);
    expect(tools("auto_order_status")).toEqual(["orders.status"]);
    expect(tools("auto_booking")).toContain("booking.create");
    expect(tools("auto_handoff")).toEqual(["handoff"]);
  });

  it("has no process at all when nothing is ready", () => {
    expect(automaticGraph(automaticReadiness({ ...facts, modules: ["products"] }))).toBeNull();
  });

  it("gives the same version for the same settings and another for another business or other settings", () => {
    const graph = automaticGraph(automaticReadiness(facts))!;
    const id = automaticVersionId(business, graph);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(automaticVersionId(business, structuredClone(graph))).toBe(id);
    expect(automaticVersionId("00000000-0000-4000-8000-000000000002", graph)).not.toBe(id);
    expect(automaticVersionId(business, automaticGraph(automaticReadiness({ ...facts, bookingCalendar: false }))!)).not.toBe(id);
  });
});

describe("loading the automatic version", () => {
  it("stores the version under its id and returns it for a business without its own workflow", async () => {
    const version = await loadAutomaticVersion(business);
    expect(version?.graph.name).toBe("Agjenti automatik");
    expect(m.rpc).toHaveBeenCalledWith("ensure_automatic_process_version", { p_business: business, p_id: version!.id, p_graph: version!.graph });
  });
  it("never replaces a workflow the owner published, even one switched off", async () => {
    m.own = { published_version_id: "00000000-0000-4000-8000-0000000000aa" };
    expect(await loadAutomaticVersion(business)).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("does not write in a test conversation, and stays off when the version cannot be stored", async () => {
    m.isolated = true;
    expect(await loadAutomaticVersion(business)).not.toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
    m.isolated = false;
    m.rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    expect(await loadAutomaticVersion(business)).toBeNull();
  });
});
