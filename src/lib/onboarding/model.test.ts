import { describe, expect, it } from "vitest";
import {
  activeQuestions,
  emptyAnswers,
  initialInstructions,
  parseAnswers,
  recommendations,
  resumeWizardStep,
  wizardStepToStored,
  type Answers,
} from "./model";
export const completeAnswers: Answers = {
  name: "Zana",
  businessType: "personalized",
  useCases: ["sales", "collection"],
  selectedUseCases: ["sales", "collection"],
  productCount: "11-50",
  productType: "photo",
  offeringTypes: ["photo", "text"],
  aiMode: "recommend_products",
  agentCapabilities: [
    "recommend_products",
    "collect_order_details",
    "follow_workflow",
  ],
  messageVolume: "2000+",
  teamSize: "2-5",
  businessProfile: null,
};
describe("onboarding answers", () => {
  it("allows incomplete drafts but rejects incomplete completion", () => {
    expect(parseAnswers(emptyAnswers)).toMatchObject(emptyAnswers);
    expect(() => parseAnswers(emptyAnswers, true)).toThrow();
  });
  it("validates every categorical answer", () => {
    for (const key of [
      "businessType",
      "productCount",
      "messageVolume",
      "teamSize",
    ]) {
      expect(() =>
        parseAnswers({ ...completeAnswers, [key]: "forged" }, true),
      ).toThrow();
    }
    expect(() =>
      parseAnswers({ ...completeAnswers, offeringTypes: ["forged"] }, true),
    ).toThrow();
    expect(() =>
      parseAnswers({ ...completeAnswers, agentCapabilities: ["forged"] }, true),
    ).toThrow();
  });
  it("rejects invalid use cases and oversized business names", () => {
    expect(() =>
      parseAnswers(
        { ...completeAnswers, useCases: ["products-only-invalid"] },
        true,
      ),
    ).toThrow();
    expect(() =>
      parseAnswers({ ...completeAnswers, name: "x".repeat(101) }, true),
    ).toThrow();
  });
  it("drops injected identity, roles, automation and tenant fields", () => {
    expect(
      parseAnswers(
        {
          ...completeAnswers,
          user_id: "other",
          business_id: "other",
          role: "admin",
          auto_reply: true,
        },
        true,
      ),
    ).toMatchObject(completeAnswers);
  });
  it("normalizes whitespace and duplicate choices", () => {
    expect(
      parseAnswers(
        { ...completeAnswers, name: " Zana ", useCases: ["sales", "sales"] },
        true,
      ),
    ).toMatchObject({
      ...completeAnswers,
      useCases: ["sales"],
      selectedUseCases: ["sales"],
    });
  });
  it("skips disabled questionnaire steps on completion", () => {
    expect(
      parseAnswers(
        { ...emptyAnswers, name: "Zana", businessType: "fashion" },
        true,
        ["businessType"],
      ),
    ).toMatchObject({ name: "Zana", businessType: "fashion" });
    expect(() =>
      parseAnswers(
        { ...emptyAnswers, name: "Zana", businessType: "fashion" },
        true,
        ["businessType", "productType"],
      ),
    ).toThrow(/Produktet/);
  });
  it("maps resume progress across disabled steps", () => {
    const active = activeQuestions(["businessType", "aiMode", "teamSize"]);
    expect(resumeWizardStep(0, active)).toBe(0);
    expect(resumeWizardStep(1, active)).toBe(1);
    expect(resumeWizardStep(4, active)).toBe(2);
    expect(resumeWizardStep(5, active)).toBe(2);
    expect(wizardStepToStored(2, active)).toBe(5);
  });
  it("personalizes instructions without inventing business facts", () => {
    const result = initialInstructions(completeAnswers);
    expect(result).toContain("Zana");
    expect(result).toContain("workflow");
    expect(result).toContain("Mos shpik");
    expect(result).toContain("personalizime");
  });
  it("uses inventory size, offering, automation, volume and team for advice", () => {
    const small = recommendations({
      ...completeAnswers,
      productCount: "0",
      productType: "services",
      offeringTypes: ["services"],
      businessType: "services",
      useCases: ["support", "booking"],
      agentCapabilities: ["handoff"],
      messageVolume: "under100",
      teamSize: "solo",
    });
    const large = recommendations({ ...completeAnswers, productCount: "200+" });
    for (let i = 0; i < 5; i++) expect(small[i]).not.toEqual(large[i]);
    expect(small[2]).toContain("manualisht");
  });
});
