import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("./action-plan.css", () => ({}));
import { ApprovalCard, ActionPlanReview } from "./action-plan";
import { refreshPlanCapability, type ActionPlanStep } from "@/lib/business-assistant/action-plan";

const step: ActionPlanStep = {
  id: "one", title: "Përgjigje për klientët", description: "Përgjigjet nga njohuritë aktive të biznesit.",
  requestedBehavior: "Dua përgjigje për klientët", requiredCapability: "knowledge.answer", capabilityReadiness: "ready", readiness: "READY",
  missingConfiguration: [], requiredDecision: null, proposedAction: "Përfshije në plan.", approvalRequired: true, supported: true, reasonCode: "verified_handler_and_configuration",
};
it.each([
  ["READY", "Gati për shqyrtim"], ["NEEDS_CONFIGURATION", "Kërkon konfigurim"], ["DISABLED", "I çaktivizuar"],
  ["UNSUPPORTED", "Nuk mbështetet"], ["BLOCKED", "Kërkon verifikim / sqarim"],
] as const)("shows %s and gates approval without hiding the explanation", (readiness, label) => {
  const onDecision = vi.fn();
  const html = renderToStaticMarkup(h(ApprovalCard, { step: { ...step, readiness }, onDecision, onRequest: vi.fn() }));
  expect(html).toContain(label); expect(html).toContain(step.description);
  expect(html).toMatch(readiness === "READY" ? /<button type="button">Mirato hapin/ : /<button type="button" disabled="">Mirato hapin/);
  expect(html).toContain('<details><summary>Hollësi teknike</summary>');
  expect(html.split("<details>")[0]).not.toContain("knowledge.answer");
  expect(onDecision).not.toHaveBeenCalled();
});
it("separates local approval and rejection from server readiness", () => {
  const render = (readiness: ActionPlanStep["readiness"], decision: "approved" | "rejected") => renderToStaticMarkup(h(ApprovalCard, {
    step: { ...step, readiness }, decision, onDecision: vi.fn(), onRequest: vi.fn(),
  }));
  expect(render("READY", "approved")).toContain("Miratuar vetëm në plan");
  expect(render("DISABLED", "approved")).not.toContain("Miratuar vetëm në plan");
  expect(render("READY", "rejected")).toContain("Refuzuar në këtë shqyrtim");
});
it("states the non-publishing and transient contract and escapes model prose", () => {
  const html = renderToStaticMarkup(h(ActionPlanReview, { plan: {
    id: "plan", request: "Test", assessedAt: "2026-01-01", steps: [{ ...step, requestedBehavior: '<script>alert("bad")</script>' }], questions: [], assumptions: [],
  }, busy: false, onRequest: vi.fn() }));
  expect(html).toContain("nuk ruan, aktivizon apo publikon"); expect(html).toContain("Zgjedhjet nuk ruhen");
  expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
});
it("offers a configuration check only for the selected supported slice, never an unsupported capability", () => {
  const render = (requiredCapability: string, supported: boolean) => renderToStaticMarkup(h(ActionPlanReview, { plan: {
    id: "plan", request: "Test", assessedAt: "2026-01-01", steps: [{ ...step, requiredCapability, supported, readiness: "NEEDS_CONFIGURATION" }], questions: [], assumptions: [],
  }, slug: "synthetic", busy: false, onRequest: vi.fn(), onAssessment: vi.fn() }));
  expect(render("product.search", true)).toContain("Kontrollo konfigurimin e katalogut");
  expect(render("knowledge.answer", true)).toContain("Kontrollo konfigurimin e njohurive");
  expect(render("booking.create", true)).not.toContain("Kontrollo konfigurimin e katalogut");
  expect(render("inventory.check", false)).not.toContain("Kontrollo konfigurimin e katalogut");
});
it("reassessment uses capability-neutral copy for Knowledge without changing a Product step", () => {
  const plan = { id: "plan", request: "Test", assessedAt: "2026-01-01", steps: [{ ...step, readiness: "NEEDS_CONFIGURATION" as const }, { ...step, id: "catalog", requiredCapability: "product.search" }], questions: [], assumptions: [] };
  const updated = refreshPlanCapability(plan, { capabilityKey: "knowledge.answer", status: "ready", reasonCode: "verified_handler_and_configuration", missingRequirements: [] });
  expect(updated.steps[0].readiness).toBe("READY"); expect(updated.steps[0].proposedAction).not.toContain("Kërkimi");
  expect(updated.steps[1]).toBe(plan.steps[1]);
});
it("updates only the reassessed capability and preserves unrelated steps and unresolved business decisions", () => {
  const plan = { id: "plan", request: "Test", assessedAt: "2026-01-01", steps: [step, { ...step, id: "catalog", requiredCapability: "product.search", readiness: "NEEDS_CONFIGURATION" as const }], questions: ["Cila gjuhë?"], assumptions: [] };
  const updated = refreshPlanCapability(plan, { capabilityKey: "product.search", status: "ready", reasonCode: "verified_handler_and_configuration", missingRequirements: [] });
  expect(updated.id).toBe(plan.id); expect(updated.steps[0]).toBe(step);
  expect(updated.steps[1]).toMatchObject({ capabilityReadiness: "ready", readiness: "BLOCKED", missingConfiguration: [] });
  expect(updated.steps[1]).not.toHaveProperty("approved");
});
