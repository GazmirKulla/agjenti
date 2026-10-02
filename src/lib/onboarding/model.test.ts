import { describe, expect, it } from "vitest";
import {
  emptyAnswers,
  initialInstructions,
  parseAnswers,
  recommendations,
  type Answers,
} from "./model";
export const completeAnswers: Answers = {
  name: "Zana",
  businessType: "personalized",
  useCases: ["sales", "collection"],
  productCount: "11-50",
  productType: "personalized",
  aiMode: "workflow",
  messageVolume: "2000+",
  teamSize: "2-5",
};
describe("onboarding answers", () => {
  it("allows incomplete drafts but rejects incomplete completion", () => {
    expect(parseAnswers(emptyAnswers)).toEqual(emptyAnswers);
    expect(() => parseAnswers(emptyAnswers, true)).toThrow();
  });
  it("validates every categorical answer", () => {
    for (const key of [
      "businessType",
      "productCount",
      "productType",
      "aiMode",
      "messageVolume",
      "teamSize",
    ]) {
      expect(() =>
        parseAnswers({ ...completeAnswers, [key]: "forged" }, true),
      ).toThrow();
    }
  });
  it("rejects invalid use cases and oversized business names", () => {
    expect(() =>
      parseAnswers({ ...completeAnswers, useCases: ["admin"] }, true),
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
    ).toEqual(completeAnswers);
  });
  it("normalizes whitespace and duplicate choices", () => {
    expect(
      parseAnswers(
        { ...completeAnswers, name: " Zana ", useCases: ["sales", "sales"] },
        true,
      ),
    ).toEqual({ ...completeAnswers, useCases: ["sales"] });
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
      aiMode: "review",
      messageVolume: "under100",
      teamSize: "solo",
    });
    const large = recommendations({ ...completeAnswers, productCount: "200+" });
    for (let i = 0; i < 5; i++) expect(small[i]).not.toEqual(large[i]);
    expect(small[2]).toContain("manualisht");
  });
});
