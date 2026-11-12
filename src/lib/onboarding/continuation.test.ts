import { describe, expect, it } from "vitest";
import { allQuestionKeys, emptyAnswers, parseAnswers } from "./model";
import {
  applyContinuationAnswer,
  changesDashboardSignals,
  continuationQuestions,
  continuationOverview,
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
    expect(fields).toEqual(expect.arrayContaining(["productCount", "messageVolume", "customerProcess"]));
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

  it("accepts free text for detail questions", () => {
    const retail = parseAnswers({ ...emptyAnswers, name: "Barriera", businessType: "retail", offeringTypes: ["standard"], useCases: ["orders"] });
    const text = applyContinuationAnswer(retail, allQuestionKeys, "customerProcess", { text: "  Porosia bëhet në DM, dërgesa 200 lekë.  " });
    expect(text.details?.customerProcess).toBe("Porosia bëhet në DM, dërgesa 200 lekë.");
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

  it("lists every question with its state and answer for the setup card", () => {
    const answered = applyContinuationAnswer(nameOnly, allQuestionKeys, "businessType", { values: ["retail"] });
    const skipped = applyContinuationAnswer(answered, allQuestionKeys, continuationState(answered, allQuestionKeys).question!.field, { skip: true });
    const { question, items } = continuationOverview(skipped, allQuestionKeys);
    const type = items.find((item) => item.field === "businessType")!;
    expect(type).toMatchObject({ status: "answered", value: ["retail"] });
    expect(type.answer).toBe(type.options.find((o) => o.value === "retail")!.label);
    expect(items.filter((item) => item.status === "skipped")).toHaveLength(1);
    expect(items.find((item) => item.field === question?.field)?.status).toBe("open");
  });

  it("no longer asks the retired detail questions, and keeps earlier answers", () => {
    const products = parseAnswers({ ...emptyAnswers, name: "Zana", businessType: "retail", offeringTypes: ["personalized"], useCases: ["orders"],
      details: { ...emptyAnswers.details, customerQuestions: "Sa kushton dërgesa? 3 euro.", hasVariants: true } });
    const fields = continuationOverview(products, allQuestionKeys).items.map((item) => item.field);
    for (const retired of ["offeringsSummary", "customerQuestions", "hasVariants", "isPersonalized", "sellsProducts", "catalogContext", "businessDescription"])
      expect(fields).not.toContain(retired);
    expect(fields).toEqual(expect.arrayContaining(["customerProcess", "handoffRules"]));
    expect(products.details?.customerQuestions).toBe("Sa kushton dërgesa? 3 euro.");
  });


  it("asks what the agent does and when it hands over with its instructions, never the abilities", () => {
    const retail = parseAnswers({ ...emptyAnswers, name: "Zana", businessType: "retail", offeringTypes: ["standard"] });
    const items = continuationOverview(retail, allQuestionKeys).items;
    expect(items.filter((item) => item.step === "agent").map((item) => item.field).sort()).toEqual(["handoffRules", "useCases"]);
    expect(items.find((item) => item.field === "handoffRules")?.title).toBe("Kur duhet Agjenti të ta kalojë bisedën ty?");
    expect(items.some((item) => item.field === "aiMode")).toBe(false);
    expect(items.filter((item) => item.step === "profile").every((item) => !["useCases", "handoffRules"].includes(item.field))).toBe(true);
  });
});
