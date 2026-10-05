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
import {
  allowedCapabilities,
  allowedOfferings,
  allowedUseCases,
  normalizeConditionalAnswers,
} from "./rules";
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
    expect(parseAnswers(emptyAnswers)).toMatchObject({
      ...emptyAnswers,
      businessProfile: expect.objectContaining({
        businessType: "other",
        offeringTypes: [],
      }),
    });
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
    ).toMatchObject({
      ...completeAnswers,
      agentCapabilities: [
        "recommend_products",
        "collect_order_details",
        "follow_workflow",
      ],
      businessProfile: expect.any(Object),
    });
  });
  it("normalizes whitespace and duplicate choices", () => {
    expect(
      parseAnswers(
        { ...completeAnswers, name: " Zana ", useCases: ["sales", "sales"] },
        true,
      ),
    ).toMatchObject({
      name: "Zana",
      businessType: "personalized",
      offeringTypes: ["photo", "text"],
      productType: "photo",
      useCases: ["sales"],
      selectedUseCases: ["sales"],
      agentCapabilities: ["recommend_products"],
      businessProfile: expect.any(Object),
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
    ).toThrow(/ofert/);
  });
  it("maps resume progress across disabled steps", () => {
    const active = activeQuestions(["businessType", "aiMode", "teamSize"], {
      ...emptyAnswers,
      businessType: "ecommerce",
      offeringTypes: ["variants"],
      useCases: ["sales"],
    });
    expect(resumeWizardStep(0, active)).toBe(0);
    expect(resumeWizardStep(1, active)).toBe(1);
    expect(resumeWizardStep(4, active)).toBe(2);
    expect(resumeWizardStep(5, active)).toBe(2);
    expect(wizardStepToStored(2, active)).toBe(5);
  });
  it("offers service-only choices and removes product actions", () => {
    expect(allowedOfferings("services").map(([value]) => value)).toEqual([
      "services",
      "mixed",
    ]);
    const cases = allowedUseCases("services", ["services"]).map(
      ([value]) => value,
    );
    expect(cases).toContain("booking");
    expect(cases).toContain("customers");
    expect(cases).not.toContain("recommendations");
    expect(cases).not.toContain("orders");
    const capabilities = allowedCapabilities(
      "services",
      ["services"],
      ["support", "booking"],
    ).map(([value]) => value);
    expect(capabilities).toContain("answer_questions");
    expect(capabilities).toContain("handle_bookings");
    expect(capabilities).not.toContain("recommend_products");
  });
  it("clears downstream selections when the offering changes", () => {
    const changed = normalizeConditionalAnswers({
      ...emptyAnswers,
      businessType: "services",
      offeringTypes: ["services"],
      useCases: ["booking", "recommendations"],
      agentCapabilities: ["handle_bookings", "recommend_products"],
    });
    expect(changed.useCases).toEqual(["booking"]);
    expect(changed.agentCapabilities).toEqual(["handle_bookings"]);
  });
  it("keeps service-only and mixed offerings mutually exclusive", () => {
    const changed = normalizeConditionalAnswers({
      ...emptyAnswers,
      businessType: "services",
      offeringTypes: ["services", "mixed"],
      useCases: ["booking", "orders"],
      agentCapabilities: ["handle_bookings", "collect_order_details"],
    });
    expect(changed.offeringTypes).toEqual(["mixed"]);
    expect(changed.useCases).toEqual(["booking", "orders"]);
  });
  it("stores a unified business profile with recommendations", () => {
    const parsed = parseAnswers(completeAnswers, true);
    expect(parsed.businessProfile).toMatchObject({
      businessType: "personalized",
      offeringTypes: ["photo", "text"],
      selectedUseCases: ["sales", "collection"],
      agentCapabilities: parsed.agentCapabilities,
      recommendedConfiguration: {
        workflow: "personalized-order",
        checklist: expect.arrayContaining(["Lidh Instagram-in"]),
      },
    });
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
    expect(small[2]).toContain("stafit");
  });
});
