import { expect, it } from "vitest";
import { emptyState } from "../engine";
import { migrateContext, setFact } from "../context";
import { advanceVisualOrderReview, missingVisualOrderNode } from "./product-order";
import type { VisualGraph, VisualNode } from "./types";

const productId = "aaaaaaaa-0000-4000-8000-000000000001";
const node = (id: string, kind: VisualNode["kind"], config: VisualNode["config"] = {}): VisualNode => ({ id, kind, label: id, position: { x: 0, y: 0 }, config });
const graph: VisualGraph = {
  version: 2, name: "Product branches",
  nodes: [node("start", "start"), node("choice", "condition", { condition: "field_equals", fieldKey: "personalized", value: "yes" }),
    node("engraving", "collect", { fieldKey: "engraving", fieldType: "text", prompt: "Teksti?" }),
    node("quantity", "collect", { fieldKey: "quantity", fieldType: "number", prompt: "Sasia?" }),
    node("confirm", "confirm", { prompt: "Vazhdojmë?" }), node("end", "end"),
    node("other", "collect", { fieldKey: "other_details", prompt: "Kërkesa tjetër?" })],
  edges: [
    { id: "start-end", source: "start", target: "end", port: "next" },
    { id: "choice-yes", source: "choice", target: "engraving", port: "yes" },
    { id: "choice-no", source: "choice", target: "quantity", port: "no" },
    { id: "engraving-confirm", source: "engraving", target: "confirm", port: "next" },
    { id: "quantity-confirm", source: "quantity", target: "confirm", port: "next" },
    { id: "confirm-yes", source: "confirm", target: "end", port: "yes" },
    { id: "confirm-no", source: "confirm", target: "engraving", port: "no" },
    { id: "other-end", source: "other", target: "end", port: "next" },
  ],
  flows: [
    { id: "product", label: "Personalizimi", kind: "order", entryNodeId: "choice", nodeIds: ["choice", "engraving", "quantity", "confirm"], productIds: [productId] },
    { id: "other", label: "Tjetër", kind: "custom", entryNodeId: "other", nodeIds: ["other"] },
  ],
};
function stateFor(branch: "yes" | "no" = "yes", profile = true) {
  const state = migrateContext(emptyState());
  state.product_id = productId;
  state.visual = { versionId: "pinned-v1", nodeId: "end", status: "waiting", awaiting: true, visited: [], values: { confirm: "po" }, branchPorts: { choice: branch, confirm: "yes" }, binding: { flowId: "product", entity: { kind: "product", id: productId } } };
  if (profile) for (const [key, value] of Object.entries({ name: "Ana", phone: "0691234567", city: "Tiranë", address: "Rruga 1" })) setFact(state, `customer_${key}`, value, key === "phone" ? "phone" : "text", "message");
  return state;
}

it.each(["yes", "no"] as const)("requires only the selected %s branch and ignores unfinished alternative flows", branch => {
  const state = stateFor(branch);
  setFact(state, branch === "yes" ? "engraving" : "quantity", branch === "yes" ? "Ana" : "2", branch === "yes" ? "text" : "number", "message");
  expect(missingVisualOrderNode(graph, state.visual!, state)).toBeNull();
  expect(state.context!.order.other_details).toBeUndefined();
  expect(state.context!.order[branch === "yes" ? "quantity" : "engraving"]).toBeUndefined();
});
it("returns the missing or invalid required field on the chosen path", () => {
  const state = stateFor("no");
  expect(missingVisualOrderNode(graph, state.visual!, state)).toBe("quantity");
  state.visual!.values.quantity = "many";
  expect(missingVisualOrderNode(graph, state.visual!, state)).toBe("quantity");
  state.visual!.values.quantity = "3";
  expect(missingVisualOrderNode(graph, state.visual!, state)).toBeNull();
});
it("does not bypass a missing condition decision or explicit step confirmation", () => {
  const state = stateFor(); setFact(state, "engraving", "Ana", "text", "message");
  delete state.visual!.branchPorts!.choice;
  expect(missingVisualOrderNode(graph, state.visual!, state)).toBe("choice");
  state.visual!.branchPorts!.choice = "yes"; delete state.visual!.values.confirm;
  expect(missingVisualOrderNode(graph, state.visual!, state)).toBe("confirm");
});
it("follows a negative confirmation back to its required correction step", () => {
  const state = stateFor("no"); setFact(state, "quantity", "3", "number", "message");
  state.visual!.values.confirm = "jo"; state.visual!.branchPorts!.confirm = "no";
  expect(missingVisualOrderNode(graph, state.visual!, state)).toBe("engraving");
});
it("summarizes only selected-path fields while preserving facts from other branches and processes", () => {
  const state = stateFor();
  setFact(state, "engraving", "ANA_SELECTED", "text", "message");
  setFact(state, "quantity", "999", "number", "message");
  setFact(state, "other_details", "OTHER_PROCESS", "text", "message");
  const result = advanceVisualOrderReview(state, "", false, true, graph, "Filxhan");
  expect(result.reply).toContain("ANA_SELECTED"); expect(result.reply).toContain("Filxhan");
  expect(result.reply).not.toContain("999"); expect(result.reply).not.toContain("OTHER_PROCESS");
  expect(result.nextState.context!.order.quantity.value).toBe("999");
  expect(result.nextState.context!.order.other_details.value).toBe("OTHER_PROCESS");
});
it("arrival never consumes an earlier yes as the final order confirmation", () => {
  const first = advanceVisualOrderReview(stateFor(), "Po", false, true, graph, "Filxhan");
  expect(first.complete).toBe(false); expect(first.nextState.step_key).toBe("order_confirm");
  expect(first.nextState.context!.execution.orderConfirmed).toBe(false);
  const confirmed = advanceVisualOrderReview(first.nextState, "Po", false, false, graph, "Filxhan");
  expect(confirmed.complete).toBe(true); expect(confirmed.nextState.context!.execution.orderConfirmed).toBe(true);
});
it("missing customer data blocks final readiness and known profile data is reused", () => {
  const state = stateFor("yes", false); setFact(state, "customer_name", "Ana", "text", "profile");
  const result = advanceVisualOrderReview(state, "Po", false, true, graph, "Filxhan");
  expect(result.complete).toBe(false); expect(result.nextState.step_key).toBe("collect_customer");
  expect(result.reply).toContain("telefonin"); expect(result.reply).toContain("adresën"); expect(result.reply).not.toContain("emrin");
  expect(result.nextState.customer.name).toBe("Ana");
});
it("returning customers confirm their profile separately from the final order", () => {
  const state = stateFor(); state.context!.execution.profileConfirmation = "pending";
  const first = advanceVisualOrderReview(state, "", false, true, graph, "Filxhan");
  expect(first.reply).toContain("A vlejnë për këtë porosi"); expect(first.complete).toBe(false);
  const profile = advanceVisualOrderReview(first.nextState, "Po", false, false, graph, "Filxhan");
  expect(profile.nextState.context!.execution.profileConfirmation).toBe("confirmed");
  expect(profile.nextState.step_key).toBe("order_confirm"); expect(profile.complete).toBe(false);
  expect(advanceVisualOrderReview(profile.nextState, "Po", false, false, graph, "Filxhan").complete).toBe(true);
});
it("a profile correction invalidates final confirmation and an informational question never confirms", () => {
  const first = advanceVisualOrderReview(stateFor(), "", false, true, graph, "Filxhan");
  const question = advanceVisualOrderReview(first.nextState, "Sa kushton?", false, false, graph, "Filxhan");
  expect(question.complete).toBe(false); expect(question.nextState.context!.execution.orderConfirmed).toBe(false);
  const ready = advanceVisualOrderReview(question.nextState, "Po", false, false, graph, "Filxhan");
  const correction = advanceVisualOrderReview(ready.nextState, "Adresa: Rruga 2", false, false, graph, "Filxhan");
  expect(correction.complete).toBe(false); expect(correction.nextState.customer.address).toBe("Rruga 2");
  expect(correction.nextState.context!.execution.orderConfirmed).toBe(false);
  expect(advanceVisualOrderReview(correction.nextState, "Po", false, false, graph, "Filxhan").complete).toBe(true);
});
it("an invalid profile correction blocks confirmation until valid replacement", () => {
  const first = advanceVisualOrderReview(stateFor(), "", false, true, graph, "Filxhan");
  const invalid = advanceVisualOrderReview(first.nextState, "Telefoni: abc", false, false, graph, "Filxhan");
  expect(invalid.reply).toContain("Kontrollo telefonin"); expect(invalid.complete).toBe(false);
  const accidentalYes = advanceVisualOrderReview(invalid.nextState, "Po", false, false, graph, "Filxhan");
  expect(accidentalYes.complete).toBe(false);
  const corrected = advanceVisualOrderReview(accidentalYes.nextState, "0697654321", false, false, graph, "Filxhan");
  expect(corrected.complete).toBe(false); expect(corrected.nextState.customer.phone).toBe("0697654321");
  expect(advanceVisualOrderReview(corrected.nextState, "Po", false, false, graph, "Filxhan").complete).toBe(true);
});
