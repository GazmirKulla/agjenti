import { describe, it, expect } from "vitest";
import { emptyAnswers, allQuestionKeys, parseAnswers } from "./model";
import {
  conversationQuestions,
  nextConversationQuestion,
} from "./conversation";
import { mergeExtraction } from "./audio-model";

describe("conversational onboarding", () => {
  it("starts with the name and respects disabled questions", () => {
    expect(nextConversationQuestion(emptyAnswers, allQuestionKeys)?.field).toBe(
      "name",
    );
    expect(
      nextConversationQuestion({ ...emptyAnswers, name: "Barriera" }, [])
        ?.field,
    ).toBe("offeringsSummary");
  });
  it("does not repeat established business facts", () => {
    const a = parseAnswers({
      ...emptyAnswers,
      name: "Barriera",
      businessType: "retail",
      offeringTypes: ["standard"],
      useCases: ["orders"],
    });
    expect(nextConversationQuestion(a, allQuestionKeys)?.field).toBe(
      "offeringsSummary",
    );
  });
  it("offers yes/no for product features but hides these for services", () => {
    const a = parseAnswers({
      ...emptyAnswers,
      name: "Salon",
      businessType: "beauty",
      offeringTypes: ["services"],
      useCases: ["booking"],
    });
    expect(
      conversationQuestions(a, allQuestionKeys).some(
        (q) => q.field === "hasVariants",
      ),
    ).toBe(false);
    const b = parseAnswers({
      ...a,
      offeringTypes: ["standard"],
      useCases: ["orders"],
    });
    expect(
      conversationQuestions(b, allQuestionKeys)
        .find((q) => q.field === "hasVariants")
        ?.options.map((o) => o.label),
    ).toEqual(["Po", "Jo"]);
  });
  it("asks to confirm uncertainty before moving on", () => {
    const a = parseAnswers({
      ...emptyAnswers,
      name: "Barriera",
      businessType: "retail",
      offeringTypes: ["standard"],
      useCases: ["orders"],
      audioReview: {
        analysisIds: ["11111111-1111-4111-8111-111111111111"],
        confidence: { offeringTypes: 0.4 },
        confirmedFields: [],
        corrections: {},
        reviewed: false,
      },
    });
    expect(nextConversationQuestion(a, allQuestionKeys)).toMatchObject({
      field: "offeringTypes",
      confirm: true,
    });
  });
  it("replaces a targeted answer while retaining other facts", () => {
    const a = parseAnswers({
      ...emptyAnswers,
      name: "Old",
      businessType: "retail",
      offeringTypes: ["standard"],
      useCases: ["orders"],
    });
    const b = mergeExtraction(
      a,
      { name: { value: "New", confidence: 0.95, evidence: "New" } },
      "11111111-1111-4111-8111-111111111111",
      { replaceFields: ["name"] },
    );
    expect(b.name).toBe("New");
    expect(b.businessType).toBe("retail");
  });
  it("can finish once required information is supplied and optional fields skipped", () => {
    const a = parseAnswers({
      ...emptyAnswers,
      name: "Barriera",
      businessType: "retail",
      offeringTypes: ["standard"],
      useCases: ["orders"],
    });
    const skip = conversationQuestions(a, allQuestionKeys)
      .filter((q) => q.optional)
      .map((q) => q.field);
    expect(nextConversationQuestion(a, allQuestionKeys, skip)).toBeNull();
    expect(() => parseAnswers(a, true)).not.toThrow();
  });
});
