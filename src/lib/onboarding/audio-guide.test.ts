import { describe, expect, it } from "vitest";
import { audioGuide, initialOnboardingMode, reviewDetailFields } from "./audio-guide";
import { activeQuestions, allQuestionKeys, emptyAnswers, initialInstructions, parseAnswers } from "./model";
import { businessProfiles } from "./rules";
import { clarifications, correctField, mergeExtraction } from "./audio-model";
import { audioFields, emptyDetails } from "./audio-fields";

const id = "11111111-1111-4111-8111-111111111111";
describe("guided onboarding", () => {
  it("uses the selected offer in every sector without repeating category or product-sales questions", () => {
    for (const businessType of Object.keys(businessProfiles)) {
      for (const offering of ["standard", "services", "mixed"]) {
        const answers = parseAnswers({ ...emptyAnswers, businessType, name: "Biznes", offeringTypes: [offering], useCases: ["support"], details: emptyDetails });
        const guide = audioGuide(answers);
        expect(guide[0].title).toBe(offering === "standard" ? "Cilat produkte shet?" : offering === "services" ? "Cilat shërbime ofron?" : "Cilat produkte dhe shërbime ofron?");
        const fields = reviewDetailFields(answers).map(([field]) => field);
        expect(fields).not.toContain("businessCategory");
        expect(fields).not.toContain("sellsProducts");
        expect(fields).not.toContain("catalogContext");
        if (businessType !== "other") expect(fields).not.toContain("categoryDescription");
        if (offering === "services") {
          expect(fields).not.toContain("hasVariants");
          expect(fields).not.toContain("isPersonalized");
        }
        expect(clarifications(answers)).toEqual([]);
        expect(activeQuestions(allQuestionKeys, answers).find(q => q.key === "productType")?.options.map(([id]) => id)).toEqual(["standard", "services", "mixed"]);
      }
    }
  });
  it("keeps relevant corrections reachable and clears product details when switching to services", () => {
    const product = parseAnswers({ ...emptyAnswers, businessType: "retail", offeringTypes: ["variants"], details: emptyDetails,
      audioReview: { analysisIds: [id], confidence: { catalogContext: 0.4 } } });
    expect(reviewDetailFields(product).map(([key]) => key)).toContain("catalogContext");
    expect(product.details?.hasVariants).toBe(true);
    const service = correctField(product, "offeringTypes", ["services"]);
    expect(service.details?.sellsProducts).toBe(false);
    expect(service.details?.hasVariants).toBeNull();
    expect(clarifications(service).some(q => q.message.includes("nuk përputhen"))).toBe(false);
  });
  it("asks for the missing goal instead of confirming capabilities that were filtered out", () => {
    const answers = parseAnswers({ ...emptyAnswers, name: "Dyqan", businessType: "retail", offeringTypes: ["standard"],
      audioReview: { analysisIds: [id], confidence: { agentCapabilities: 0 } } });
    expect(answers.audioReview?.confidence).not.toHaveProperty("agentCapabilities");
    expect(clarifications(answers).map(q => q.field)).toEqual(["useCases"]);
    expect(audioGuide(answers).some(q => q.id === "businessType" || q.id === "sellsProducts" || q.id === "offeringTypes")).toBe(false);
  });
  it("starts new users at basics and resumes old manual and audio drafts", () => {
    expect(initialOnboardingMode(emptyAnswers, 0)).toBe("basics");
    expect(initialOnboardingMode(emptyAnswers, 2)).toBe("manual");
    for (const mode of ["basics", "audio", "written", "manual", "review"] as const) {
      const saved = parseAnswers({ ...emptyAnswers, guidedOnboardingMode: mode });
      expect(initialOnboardingMode(saved, 0)).toBe(mode);
    }
    const reviewed = parseAnswers({ ...emptyAnswers, audioReview: { analysisIds: [id] } });
    expect(initialOnboardingMode(reviewed, 0)).toBe("review");
    expect(initialOnboardingMode(parseAnswers({ ...emptyAnswers, guidedOnboardingMode: "forged" }), 0)).toBe("basics");
  });

  it("accepts an orders goal before offerings are known, but removes it for explicit service-only offers", () => {
    const basics = parseAnswers({ ...emptyAnswers, name: "Studio", businessType: "beauty", useCases: ["orders", "booking"] });
    expect(basics.offeringTypes).toEqual([]);
    expect(basics.useCases).toEqual(["orders", "booking"]);
    expect(correctField(basics, "offeringTypes", ["services"]).useCases).toEqual(["booking"]);
    expect(correctField(basics, "useCases", []).useCases).toEqual([]);
  });

  it("keeps written context in the completed profile and initial agent instructions without requiring audio", () => {
    const completed = parseAnswers({
      ...emptyAnswers, name: "Studio", businessType: "services", offeringTypes: ["services"], useCases: ["booking"],
      guidedOnboardingMode: "review",
      details: { ...emptyDetails, offeringsSummary: ["Prerje flokësh"], customerQuestions: "Punojmë me takime.", customerProcess: "Stafi konfirmon orarin.", handoffRules: "Ankesat i merr stafi." },
    }, true);
    expect(completed.audioReview).toBeUndefined();
    expect(completed.businessProfile?.customerProcess).toBe("Stafi konfirmon orarin.");
    const instructions = initialInstructions(completed);
    expect(instructions).toContain("Prerje flokësh");
    expect(instructions).toContain("Stafi konfirmon orarin.");
    expect(instructions).toContain("Ankesat i merr stafi.");
  });

  it("gives each supported category four prompts with specific offering and process guidance", () => {
    const offeringHints = new Set<string>();
    const processHints = new Set<string>();
    for (const businessType of Object.keys(businessProfiles)) {
      const questions = audioGuide({ ...emptyAnswers, businessType });
      expect(questions).toHaveLength(4);
      offeringHints.add(questions[0].hint);
      processHints.add(questions[2].hint);
    }
    expect(offeringHints.size).toBe(Object.keys(businessProfiles).length);
    expect(processHints.size).toBe(Object.keys(businessProfiles).length);
    expect(audioGuide({ ...emptyAnswers, businessType: "unknown" })).toEqual(audioGuide(emptyAnswers));
    expect(audioGuide({ ...emptyAnswers, useCases: ["booking"] })[2].title).toContain("rezervim");
    expect(audioGuide({ ...emptyAnswers, useCases: ["orders"] })[2].title).toContain("porosi");
  });

  it("supplemental audio asks for missing answers without repeating completed narratives or disabled steps", () => {
    const answers = parseAnswers({
      ...emptyAnswers, name: "Studio", businessType: "services", offeringTypes: ["services"], useCases: ["booking"],
      details: { ...emptyDetails, offeringsSummary: ["Prerje"], customerQuestions: "Si caktohet takimi?", sellsProducts: false },
      audioReview: { analysisIds: [id] },
    });
    expect(audioGuide(answers).map(q => q.id)).toEqual(["customerProcess", "handoffRules"]);
    expect(audioGuide({ ...answers, useCases: [] }, []).map(q => q.id)).not.toContain("useCases");
  });

  it("preserves basics during extraction and resumes the resulting review", () => {
    const basics = parseAnswers({ ...emptyAnswers, name: "Emri manual", businessType: "fashion", useCases: ["orders"], guidedOnboardingMode: "audio" });
    const extraction = Object.fromEntries(audioFields.map(key => [key, {
      value: key === "name" ? "Emri i transkriptuar" : key === "offeringTypes" ? ["variants"] : null,
      confidence: 0.9, evidence: "ofrojmë variante",
    }]));
    const result = mergeExtraction(basics, extraction, id);
    expect(result.name).toBe("Emri manual");
    expect(result.businessType).toBe("fashion");
    expect(result.useCases).toEqual(["orders"]);
    expect(result.offeringTypes).toEqual(["variants"]);
    expect(initialOnboardingMode(result, 0)).toBe("review");
  });
});
