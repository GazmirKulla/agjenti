import { describe, expect, it } from "vitest";
import { initialSnapshot, type Instance, type ProcessDefinition, type Snapshot } from "@/lib/orchestration/contracts";
import { processCapabilityEvents, processCapability } from "./process-events";
import { capabilityRows } from "./events";
import { summarizeHealth } from "./health";

const definition = (tool?: string): ProcessDefinition => ({ id: "d", versionId: "v", businessId: "b", name: "n", purpose: "p", offerPolicy: "when_relevant", entry: "s", fields: [],
  steps: tool ? [{ id: "s", kind: "effect", tool, toolVersion: 1, inputs: {}, next: "e", failed: "e" }, { id: "e", kind: "end", label: "x" }] : [{ id: "h", kind: "handoff", label: "x" }] } as unknown as ProcessDefinition);
const instance = (patch: Partial<Instance>): Instance => ({ id: "i1", definitionId: "d", versionId: "v", stepId: "s", status: "waiting_input", facts: {}, ...patch } as Instance);
const snapshot = (instances: Instance[]): Snapshot => ({ ...initialSnapshot("b", "c", "live"), instances: Object.fromEntries(instances.map(i => [i.id, i])) });
const action = (status: string, output: Record<string, unknown> = {}) => ({ id: "a1", instanceId: "i1", stepId: "s", tool: "order.create", toolVersion: 1, input: {}, inputDigest: "x", status, output }) as Instance["action"];
const events = (before: Instance[] | undefined, after: Instance[], tool = "order.create", notices = []) =>
  processCapabilityEvents(before ? snapshot(before) : undefined, snapshot(after), notices, () => definition(tool)).map(e => [e.capability, e.point, e.reason]);

describe("what one customer turn starts and ends", () => {
  it("knows each process by what it does", () => {
    expect(processCapability(definition("order.create"))).toBe("customer.order");
    expect(processCapability(definition("booking.create"))).toBe("customer.booking");
    expect(processCapability(definition("orders.status"))).toBe("customer.order_status");
    expect(processCapability(definition())).toBe("customer.handoff");
    expect(processCapability(definition("something.else"))).toBe("customer.business_action");
  });
  it("records a new process as its entry", () => {
    expect(events([], [instance({})])).toEqual([["customer.order", "started", undefined]]);
  });
  it("ends an order as registered, collected for staff, or failed with the server's reason", () => {
    expect(events([instance({})], [instance({ action: action("succeeded", { submissionStatus: "local_only" }) })])).toEqual([["customer.order", "registered", undefined]]);
    expect(events([instance({})], [instance({ action: action("succeeded", { submissionStatus: "awaiting_staff" }) })])).toEqual([["customer.order", "collected", undefined]]);
    expect(events([instance({})], [instance({ action: action("failed", { code: "out_of_stock" }) })])).toEqual([["customer.order", "failed", "out_of_stock"]]);
  });
  it("counts a finished effect once, not again when the process then completes", () => {
    const done = action("succeeded", { submissionStatus: "local_only" });
    expect(events([instance({ action: done })], [instance({ action: done, status: "completed" })])).toEqual([]);
  });
  it("records a stop by the server, a handoff and a request the customer closed", () => {
    expect(processCapabilityEvents(snapshot([instance({})]), snapshot([instance({ status: "failed", lastError: "product_information_only" })]),
      [{ kind: "blocked", instanceId: "i1", reason: "product_information_only" }], () => definition("order.create")).map(e => [e.point, e.reason])).toEqual([["blocked", "product_information_only"]]);
    expect(events([instance({})], [instance({ status: "handoff" })])).toEqual([["customer.order", "handed_off", undefined]]);
    expect(events([instance({})], [instance({ status: "completed" })])).toEqual([["customer.order", "closed", undefined]]);
  });
  it("records nothing more for a process that had already ended", () => {
    expect(events([instance({ status: "completed" })], [instance({ status: "completed" })])).toEqual([]);
  });
});

describe("what is stored and how it is summed up", () => {
  it("stores only declared points, and only code-shaped reasons", () => {
    expect(() => capabilityRows([{ businessId: "b", capability: "customer.order", point: "invented", mode: "live" }])).toThrow("undeclared_capability_point");
    const [row] = capabilityRows([{ businessId: "b", capability: "customer.order", point: "failed", reason: "a message with spaces", mode: "live" }]);
    expect(row).toMatchObject({ agent: "customer", outcome: "failure", reason: "other" });
  });
  it("sums a capability's outcomes, its success rate against the previous period, and its reasons", () => {
    const row = (point: string, outcome: "entry" | "success" | "failure", events: number, reason: string | null = null) =>
      ({ capability: "customer.order", point, outcome, reason, events, businesses: 1, examples: ["b1:c1"] });
    const [order] = summarizeHealth([row("started", "entry", 10), row("registered", "success", 6), row("failed", "failure", 2, "out_of_stock"), row("abandoned", "failure", 2)],
      [row("registered", "success", 1), row("failed", "failure", 1)], { "customer.order": "2026-11-19T00:00:00Z" });
    expect(order).toMatchObject({ entries: 10, success: 6, failure: 4, abandoned: 2, rate: 0.6, previousRate: 0.5 });
    expect(order.reasons[0]).toMatchObject({ point: "failed", reason: "out_of_stock", examples: [{ businessId: "b1", conversationId: "c1" }] });
  });
});
