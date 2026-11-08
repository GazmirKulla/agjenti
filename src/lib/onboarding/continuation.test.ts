import { describe, expect, it } from "vitest";
import { allQuestionKeys, emptyAnswers, parseAnswers } from "./model";
import {
  applyContinuationAnswer,
  changesDashboardSignals,
  continuationQuestions,
  continuationState,
  ContinuationError,
} from "./continuation";

const nameOnly = parseAnswers({ ...emptyAnswers, name: "Barriera" });

describe("onboarding continuation in the dashboard", () => {
  it("starts an agent-mode workspace from the business type, never the name", () => {
    const { question, progress } = continuationState(nameOnly, allQuestionKeys);
    expect(question?.field).toBe("businessType");
    expect(question?.kind).toBe("single");
    expect(continuationQuestions(nameOnly, allQuestionKeys).some((q) => q.field === "name")).toBe(false);
    expect(progress.answered).toBe(0);
  });

  it("asks only what the manual flow left empty", () => {
    const manual = parseAnswers({ ...emptyAnswers, name: "Barriera", businessType: "retail", offeringTypes: ["standard"], useCases: ["orders"] });
    const fields = continuationQuestions(manual, allQuestionKeys).map((q) => q.field);
    const { question, progress } = continuationState(manual, allQuestionKeys);
    expect(fields).toEqual(expect.arrayContaining(["productCount", "messageVolume", "offeringsSummary"]));
    expect(["businessType", "offeringTypes", "useCases"]).not.toContain(question?.field);
    expect(progress.answered).toBeGreaterThanOrEqual(3);
  });

  it("stores a choice and moves to the next open question", () => {
    const next = applyContinuationAnswer(nameOnly, allQuestionKeys, "businessType", { values: ["retail"] });
    expect(next.businessType).toBe("retail");
    expect(continuationState(next, allQuestionKeys).question?.field).not.toBe("businessType");
    expect(changesDashboardSignals(nameOnly, next)).toBe(true);
  });

  it("remembers skipped questions and asks them again only when answered later", () => {
    const skipped = applyContinuationAnswer(nameOnly, allQuestionKeys, "businessType", { skip: true });
    expect(skipped.conversationSkipped).toContain("businessType");
    expect(continuationState(skipped, allQuestionKeys).question?.field).not.toBe("businessType");
    const offering = continuationState(skipped, allQuestionKeys).question!;
    const skippedTwice = applyContinuationAnswer(skipped, allQuestionKeys, offering.field, { skip: true });
    expect(skippedTwice.conversationSkipped).toEqual(expect.arrayContaining(["businessType", offering.field]));
    const answered = applyContinuationAnswer(skippedTwice, allQuestionKeys, "businessType", { values: ["retail"] });
    expect(answered.conversationSkipped).not.toContain("businessType");
  });

  it("keeps a skipped offering type across saves", () => {
    const retail = parseAnswers({ ...emptyAnswers, name: "Barriera", businessType: "retail" });
    const skipped = applyContinuationAnswer(retail, allQuestionKeys, "offeringTypes", { skip: true });
    expect(parseAnswers(JSON.parse(JSON.stringify(skipped))).conversationSkipped).toContain("offeringTypes");
  });

  it("accepts free text for detail questions and a list for offerings", () => {
    const retail = parseAnswers({ ...emptyAnswers, name: "Barriera", businessType: "retail", offeringTypes: ["standard"], useCases: ["orders"] });
    const listed = applyContinuationAnswer(retail, allQuestionKeys, "offeringsSummary", { text: "Këpucë\nÇanta\n\nÇanta" });
    expect(listed.details?.offeringsSummary).toEqual(["Këpucë", "Çanta"]);
    const text = applyContinuationAnswer(retail, allQuestionKeys, "customerQuestions", { text: "  Sa kushton dërgesa? 200 lekë.  " });
    expect(text.details?.customerQuestions).toBe("Sa kushton dërgesa? 200 lekë.");
  });

  it("rejects options that do not belong to the question", () => {
    expect(() => applyContinuationAnswer(nameOnly, allQuestionKeys, "businessType", { values: ["nope"] })).toThrow(ContinuationError);
    expect(() => applyContinuationAnswer(nameOnly, allQuestionKeys, "businessType", { values: ["retail", "food"] })).toThrow(ContinuationError);
    expect(() => applyContinuationAnswer(nameOnly, allQuestionKeys, "name", { text: "Tjetër" })).toThrow(ContinuationError);
    expect(() => applyContinuationAnswer(nameOnly, allQuestionKeys, "businessType", {})).toThrow(ContinuationError);
  });

  it("respects questions disabled by the platform", () => {
    expect(continuationQuestions(nameOnly, []).some((q) => q.field === "businessType")).toBe(false);
  });
});
