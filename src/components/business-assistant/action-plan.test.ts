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
  ["READY", "Propozuar"], ["NEEDS_CONFIGURATION", "Kërkon konfigurim"], ["DISABLED", "Kërkon konfigurim"],
  ["UNSUPPORTED", "Nuk mbështetet"], ["BLOCKED", "Nuk u verifikua"],
] as const)("shows %s and gates approval without hiding the explanation", (readiness, label) => {
  const onDecision = vi.fn();
  const html = renderToStaticMarkup(h(ApprovalCard, { step: { ...step, readiness }, onDecision, onRequest: vi.fn() }));
  expect(html).toContain(label); expect(html).toContain(step.description);
  expect(html.includes(">Përfshi në plan</button>")).toBe(readiness === "READY");
  expect(html).toContain('<details><summary>Detaje teknike</summary>');
  expect(html.split("<details>")[0]).not.toContain("knowledge.answer");
  expect(onDecision).not.toHaveBeenCalled();
});
it("separates local approval and rejection from server readiness", () => {
  const render = (readiness: ActionPlanStep["readiness"], decision: "approved" | "rejected") => renderToStaticMarkup(h(ApprovalCard, {
    step: { ...step, readiness }, decision, onDecision: vi.fn(), onRequest: vi.fn(),
  }));
  expect(render("READY", "approved")).toContain("Përfshirë vetëm në plan");
  expect(render("DISABLED", "approved")).not.toContain("Përfshirë vetëm në plan");
  expect(render("READY", "rejected")).toContain("Lënë jashtë planit");
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
  expect(render("product.search", true)).toContain(">Konfiguro</button>");
  expect(render("knowledge.answer", true)).toContain(">Konfiguro</button>");
  expect(render("booking.create", true)).not.toContain(">Konfiguro</button>");
  expect(render("inventory.check", false)).not.toContain(">Konfiguro</button>");
});
it("focuses one card while keeping unsupported steps visible in the summary", () => {
  const html = renderToStaticMarkup(h(ActionPlanReview, { plan: {
    id: "plan", request: "Test", assessedAt: "2026-01-01", steps: [step, { ...step, id: "unsupported", title: "Regjistrimi i klientit", supported: false, readiness: "UNSUPPORTED", requiredCapability: "customer.create" }], questions: [], assumptions: [],
  }, businessName: "Dyqani A", slug: "shop-a", busy: false, onRequest: vi.fn() }));
  expect(html.match(/<article /g)).toHaveLength(1);
  expect(html).toContain("Regjistrimi i klientit");
  expect(html).toContain("Nuk mbështetet");
  expect(html).toContain("Dyqani A");
  expect(html).not.toContain("customer.create");
  expect(html).not.toContain(">Publiko");
});
it("does not equate conversational customer facts with CRM registration", () => {
  const html = renderToStaticMarkup(h(ApprovalCard, {
    step: { ...step, supported: false, requiredCapability: "customer.create", readiness: "UNSUPPORTED" }, onDecision: vi.fn(), onRequest: vi.fn(),
  }));
  expect(html).toContain("Mbledhja e të dhënave në bisedë nuk krijon një klient në CRM.");
  expect(html).not.toContain(">Përfshi në plan</button>");
  expect(html).not.toContain(">Konfiguro</button>");
});
it("does not present a previously selected but now unverified step as included or completed", () => {
  const html = renderToStaticMarkup(h(ApprovalCard, {
    step, decision: "approved", feedback: { label: "Nuk u verifikua", message: "Kontrollo gjendjen.", unverified: true }, onDecision: vi.fn(), onRequest: vi.fn(),
  }));
  expect(html).toContain("Nuk u verifikua");
  expect(html).not.toContain("Përfshirë vetëm në plan");
  expect(html).not.toContain(">Përfshi në plan</button>");
});
it("distinguishes an unresolved request from a confirmed unsupported action", () => {
  const html = renderToStaticMarkup(h(ApprovalCard, {
    step: { ...step, supported: false, requiredCapability: null, readiness: "BLOCKED", requiredDecision: "Çfarë rezultati pret?" },
    onDecision: vi.fn(), onRequest: vi.fn(),
  }));
  expect(html).toContain("Kërkon sqarim");
  expect(html).not.toContain("Nuk mbështetet");
  expect(html).not.toContain(">Përfshi në plan</button>");
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
