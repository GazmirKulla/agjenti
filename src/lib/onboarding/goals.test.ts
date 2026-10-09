import { describe, expect, it } from "vitest";
import { activeQuestions, allQuestionKeys, emptyAnswers, parseAnswers } from "./model";
import { allowedCapabilities, canonicalUseCases, visibleUseCases } from "./rules";
import { extractionSchema } from "./audio-model";

describe("simplified onboarding goals", () => {
  it("derives order capabilities from the single visible goal selection without hidden confirmations", () => {
    const answers = parseAnswers({ ...emptyAnswers, name: "Dyqan", businessType: "retail", offeringTypes: ["standard"], useCases: ["orders"],
      audioReview: { analysisIds: ["11111111-1111-4111-8111-111111111111"], reviewed: true, confidence: { agentCapabilities: 0.2 } },
    }, true);
    expect(answers.agentCapabilities).toEqual(["ask_missing", "handoff", "collect_order_details", "follow_workflow", "create_order"]);
    expect(answers.audioReview?.confidence).not.toHaveProperty("agentCapabilities");
    const active = activeQuestions(allQuestionKeys, answers);
    expect(active.some(q => q.key === "useCases")).toBe(true);
    expect(active.some(q => q.key === "aiMode")).toBe(false);
  });
  it("shows five goals for mixed offers and omits reservations for product-only sellers", () => {
    expect(visibleUseCases("beauty", ["mixed"], []).map(([id]) => id))
      .toEqual(["support", "sales", "orders", "booking", "leads"]);
    expect(visibleUseCases("retail", ["standard"], []).map(([id]) => id))
      .toEqual(["support", "sales", "orders", "leads"]);
    expect(visibleUseCases("technical", ["standard"], ["booking"]).map(([id]) => id)).toContain("booking");
    expect(visibleUseCases("professional", ["services"], []).map(([id]) => id))
      .toEqual(["support", "sales", "booking", "leads"]);
  });
  it("groups old choices and preserves editing capabilities for saved profiles", () => {
    expect(canonicalUseCases(["messages", "support", "sales", "recommendations", "products", "collection", "orders", "customers"]))
      .toEqual(["support", "sales", "orders", "leads"]);
    const saved = { ...emptyAnswers, name: "Dyqan", businessType: "retail", offeringTypes: ["standard"], useCases: ["messages"] };
    const questions = activeQuestions(allQuestionKeys, saved);
    expect(questions.find(q => q.key === "useCases")?.options.some(([id]) => id === "messages")).toBe(false);
    expect(questions.find(q => q.key === "aiMode")).toBeUndefined();
    expect(parseAnswers({ ...saved, agentCapabilities: ["answer_questions"] }).agentCapabilities).toContain("answer_questions");
  });
  it("keeps the extraction schema and goal capabilities aligned with the five choices", () => {
    expect(extractionSchema.properties.useCases.properties.value.items?.enum)
      .toEqual(["support", "sales", "orders", "booking", "leads"]);
    expect(allowedCapabilities("retail", ["standard"], ["orders"]).map(([id]) => id))
      .toEqual(expect.arrayContaining(["ask_missing", "collect_order_details", "create_order"]));
    const serviceSales = allowedCapabilities("professional", ["services"], ["sales"]).map(([id]) => id);
    expect(serviceSales).toContain("understand_needs");
    expect(serviceSales).not.toContain("recommend_products");
  });
});
