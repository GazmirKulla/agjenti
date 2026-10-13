import { beforeEach, expect, it, vi } from "vitest";
const assess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/capabilities/assessment", () => ({ assessBusinessCapabilities: assess }));
import { buildAutomationProposal, recheckAutomation, automationMessage } from "./automation-proposal";
import { readAutomationIntent, type AutomationIntent } from "./automation-intent";
import { starterVisualGraph } from "@/lib/workflows/visual/model";
import { applyWorkflowOperations, type Operation } from "./workflow";
import { getCapability } from "@/lib/capabilities/registry";
const ready = ["knowledge.answer", "product.search", "product.recommend", "booking.create", "order.status.read", "staff.handoff"].map(capabilityKey => ({ capabilityKey, status: "ready", reasonCode: "configured", missingRequirements: [] }));
const operations: Operation[] = [{ op: "rename", name: "Shitjet" }];
function input(keys = ["product.search"]) {
  const before = starterVisualGraph();
  return { businessId: "a", userId: "owner", revision: 3, publishedVersionId: "v1", request: "Ndrysho rrjedhën e katalogut",
    intent: { requestedBehaviors: [{ description: "Kërko produktin", capabilityKeys: keys }], assumptions: [], clarificationQuestions: [] } as AutomationIntent,
    before, after: applyWorkflowOperations(before, JSON.stringify(operations)), operations };
}
beforeEach(() => { assess.mockReset(); assess.mockResolvedValue(ready); });
it("creates a supported proposal with server-owned revision/readiness without changing the base", async () => {
  const data = input(); const old = structuredClone(data.before);
  const result = await buildAutomationProposal(data);
  expect(result).toMatchObject({ version: 1, status: "proposed", readiness: "ready", baseRevision: 3, workflowVersionId: "v1", canSaveDraft: true, operations });
  expect(result.requestedBehaviors[0].readiness).toBe("ready");
  expect(data.before).toEqual(old);
  expect(assess).toHaveBeenCalledWith("a", { userId: "owner" });
});
it("reports a mixed stock request even when the model omits its unsupported behaviors", async () => {
  const result = await buildAutomationProposal({ ...input(["product.search", "product.recommend"]), request: "Check inventory. If unavailable recommend an alternative and notify when back in stock." });
  expect(result.unsupportedActions).toEqual(expect.arrayContaining(["inventory.check", "back_in_stock.notify"]));
  expect(result.requiredCapabilities.filter(c => c.status === "ready")).toHaveLength(2);
  expect(result.canSaveDraft).toBe(false); expect(result.operations).toEqual([]);
  expect(result.readiness).toBe("unsupported");
  expect(automationMessage(result)).toContain("automatizimi i plotë nuk mund të aktivizohet");
  expect(result.clarificationQuestions[0]).toContain("vetëm për pjesën");
});
it("does not confuse scheduling a booking with scheduling a background automation", async () => {
  const result = await buildAutomationProposal({ ...input(["booking.create"]), request: "Schedule a booking" });
  expect(result).toMatchObject({ readiness: "ready", canSaveDraft: true, unsupportedActions: [] });
});
it("blocks scheduled jobs even when the model omits that capability", async () => {
  const result = await buildAutomationProposal({ ...input(), request: "Schedule a notification every day" });
  expect(result.unsupportedActions).toContain("schedule.trigger"); expect(result.operations).toEqual([]);
});
it.each(["external.crm.write", "inventory.check", "back_in_stock.notify", "constructor", "__proto__"])("treats %s as unsupported, even with a forged ready assessment", async key => {
  assess.mockResolvedValue([{ capabilityKey: key, status: "ready", missingRequirements: [] }]);
  const result = await buildAutomationProposal(input([key]));
  expect(result.requiredCapabilities[0].status).toBe("unsupported"); expect(result.canSaveDraft).toBe(false);
  expect(getCapability(key)).toBeUndefined();
});
it("allows a setup-required draft while recording its missing requirements", async () => {
  assess.mockResolvedValue([{ ...ready[0], capabilityKey: "booking.create", status: "needs_setup", missingRequirements: ["agent_booking_enabled"] }]);
  const result = await buildAutomationProposal(input(["booking.create"]));
  expect(result).toMatchObject({ canSaveDraft: true, readiness: "needs_setup", missingRequirements: ["agent_booking_enabled"] });
  expect(result.requestedBehaviors[0].readiness).toBe("needs_setup");
  expect(automationMessage(result)).toContain("Kërkon konfigurim");
});
it("does not issue executable changes for an ambiguous instruction", async () => {
  const data = input(); data.intent.clarificationQuestions = ["Cilën degë dëshiron?"];
  const result = await buildAutomationProposal(data);
  expect(result.canSaveDraft).toBe(false); expect(result.operations).toEqual([]);
  expect(result.readiness).toBe("needs_clarification");
});
it("fails closed on assessment errors without leaking private diagnostics", async () => {
  assess.mockRejectedValue(new Error("secret=private-database-error"));
  const result = await buildAutomationProposal(input());
  expect(result.canSaveDraft).toBe(false);
  expect(result.requiredCapabilities[0].status).toBe("needs_clarification");
  expect(JSON.stringify(result)).not.toContain("private-database-error");
  await expect(recheckAutomation("a", "owner", result)).rejects.toThrow("Nuk u verifikuan");
});
it("rechecks readiness before save and rejects changed or unknown results", async () => {
  const proposal = await buildAutomationProposal(input());
  await recheckAutomation("a", "owner", proposal);
  assess.mockResolvedValue([{ ...ready[1], status: "needs_setup", missingRequirements: ["active_products"] }]);
  await expect(recheckAutomation("a", "owner", proposal)).rejects.toThrow("ndryshuan");
});
it("infers required booking capability from a changed node even if the model omitted it", async () => {
  const data = input([]); const after = structuredClone(data.after); after.version = 1;
  // An invalid graph is reported separately; capability discovery does not trust model annotations.
  after.nodes.push({ id: "b", kind: "booking", label: "Rezervim", position: { x: 0, y: 0 }, config: {} });
  const result = await buildAutomationProposal({ ...data, after });
  expect(result.requiredCapabilities.some(c => c.capabilityKey === "booking.create")).toBe(true);
  expect(result.validationFindings.some(f => f.code === "invalid_graph")).toBe(true);
});
it("blocks inventory claims disguised as a knowledge prompt", async () => {
  const data = input(); const after = structuredClone(data.after);
  after.nodes.find(n => n.kind === "knowledge")!.config.prompt = "Check inventory and notify when back in stock";
  const result = await buildAutomationProposal({ ...data, after });
  expect(result.canSaveDraft).toBe(false); expect(result.unsupportedActions).toContain("back_in_stock.notify");
});
it("assesses existing nodes when a changed edge starts using them", async () => {
  const data = input([]);
  data.after.edges[0].target = "product";
  const result = await buildAutomationProposal(data);
  expect(result.requiredCapabilities.map(c => c.capabilityKey)).toContain("product.search");
});
it("withholds operations when a known capability is missing from the assessment", async () => {
  assess.mockResolvedValue([]);
  const result = await buildAutomationProposal(input());
  expect(result).toMatchObject({ readiness: "needs_clarification", canSaveDraft: false, operations: [] });
});
it.each([
  [{ op: "execute_tool", name: "inventory.check" }],
  [{ op: "put_node", node: { id: "x", kind: "inventory", label: "Stock", position: { x: 0, y: 0 }, config: {} } }],
  [{ op: "put_node", node: { ...starterVisualGraph().nodes[0], config: { tool: "inventory.check" } } }],
])("rejects unsupported graph actions before normalization", operations => {
  expect(() => applyWorkflowOperations(starterVisualGraph(), JSON.stringify(operations))).toThrow();
});
it("accepts only bounded intent and ignores model-supplied approval/readiness", () => {
  const value = readAutomationIntent({ ...input().intent, canSaveDraft: true, requiredCapabilities: [{ status: "ready" }] });
  expect(value).not.toHaveProperty("canSaveDraft");
  expect(() => readAutomationIntent({ requestedBehaviors: "invalid" })).toThrow();
});
