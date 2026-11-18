import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/capabilities/enforcement", () => ({ requireRuntimeModules: async () => undefined }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
import { compileVisualProcesses } from "./visual-definition";
import { orderFields } from "./order-definition";
import { composeCustomerQuestions } from "./order-context";
import { parseBusinessFields, productAskFields, attributeFields, type BusinessField } from "@/lib/items/fields";
import type { VisualVersion } from "@/lib/workflows/visual/types";

const version: VisualVersion = { id: "visual", businessId: "business", createdAt: "today", graph: { version: 2, name: "Shop", flows: [
  { id: "order", label: "Order", kind: "order", entryNodeId: "product", nodeIds: ["product", "review", "done"] }], nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "product", kind: "product", label: "Product", position: { x: 0, y: 0 }, config: {} },
    { id: "review", kind: "confirm", label: "Review", position: { x: 0, y: 0 }, config: { prompt: "Confirm?" } },
    { id: "done", kind: "end", label: "Done", position: { x: 0, y: 0 }, config: {} }], edges: [
      { id: "start-done", source: "start", target: "done", port: "next" }, { id: "product-review", source: "product", target: "review", port: "next" },
      { id: "review-yes", source: "review", target: "done", port: "yes" }, { id: "review-no", source: "review", target: "done", port: "no" }] } };
const shirtText: BusinessField = { key: "teksti", label: "Teksti në bluzë", type: "text", ask: true };
const wrap: BusinessField = { key: "paketimi", label: "Paketimi", type: "select", options: ["Dhuratë", "I thjeshtë"], ask: true };

describe("questions the agent asks a customer who orders a product", () => {
  const definition = () => compileVisualProcesses(version).find(d => d.id === "order")!;
  it("asks each question the product uses right after the product, and puts the answer in the review", () => {
    const composed = composeCustomerQuestions(definition(), [shirtText, wrap]);
    expect(composed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ask_teksti", type: "text", required: true, label: "Teksti në bluzë" }),
      expect.objectContaining({ id: "ask_paketimi", type: "choice", options: ["Dhuratë", "I thjeshtë"] })]));
    const product = composed.steps.find(s => s.kind === "collect" && s.fieldId === orderFields("order").key("productId"))!;
    const resolve = composed.steps.find(s => s.id === (product as { next: string }).next)!;
    const first = composed.steps.find(s => s.id === (resolve as { next: string }).next);
    expect(first).toMatchObject({ kind: "collect", fieldId: "ask_teksti" });
    const review = composed.steps.find(s => s.kind === "confirm" && s.fieldIds.includes(orderFields("order").key("productId")))!;
    expect(review).toMatchObject({ fieldIds: expect.arrayContaining(["ask_teksti", "ask_paketimi"]) });
  });
  it("asks nothing for a product that uses no question", () => {
    expect(composeCustomerQuestions(definition(), [])).toEqual(definition());
  });
  it("uses only the questions the owner turned on for the product, and never shows them as product data", () => {
    expect(productAskFields([shirtText, wrap], { teksti: true, paketimi: false }).map(f => f.key)).toEqual(["teksti"]);
    expect(productAskFields([shirtText, wrap], { teksti: "po" })).toEqual([]);
    expect(attributeFields([shirtText, { key: "ngjyra", label: "Ngjyra", type: "text" }]).map(f => f.key)).toEqual(["ngjyra"]);
  });
  it("keeps a field either a customer choice or a customer question, not both", () => {
    expect(parseBusinessFields([{ label: "Teksti në bluzë", type: "text", ask: true }])).toEqual({ fields: [expect.objectContaining({ key: "teksti_ne_bluze", ask: true })] });
    expect(parseBusinessFields([{ label: "Masa", type: "select", variant: true, ask: true }])).toHaveProperty("error");
  });
});
