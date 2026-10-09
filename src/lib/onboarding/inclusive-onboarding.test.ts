import { describe, expect, it } from "vitest";
import { businessCategories, legacyBusinessCategories } from "./categories";
import { activeQuestions, allQuestionKeys, emptyAnswers, normalizeOnboardingSteps, parseAnswers } from "./model";
import { audioGuide, needsCatalogContext } from "./audio-guide";
import { audioFields, emptyDetails } from "./audio-fields";
import { extractionSchema, mergeExtraction, validateExtraction } from "./audio-model";
import { generateDashboardProfile } from "@/lib/dashboard/profile/generate";
import { signalsFromOnboardingAnswers } from "@/lib/dashboard/profile/service";

describe("inclusive onboarding", () => {
  it("guides an online platform through plans, activation and customer support", () => {
    const answers = parseAnswers({ ...emptyAnswers, name: "Agjenti.app", businessType: "digital",
      offeringTypes: ["services"], useCases: ["support"] }, true);
    const questions = audioGuide(answers);
    expect(questions[0].hint).toContain("abonimesh");
    expect(questions.find(q => q.id === "customerProcess")?.hint).toContain("regjistrohet klienti");
    expect(questions.find(q => q.id === "customerQuestions")?.hint).toContain("probleme teknike");
    expect(answers.businessProfile?.businessType).toBe("digital");
  });

  it("accepts products, services and mixed offers in every public sector", () => {
    for (const [businessType] of businessCategories) {
      for (const offering of ["standard", "services", "mixed"]) {
        const answers = parseAnswers({ ...emptyAnswers, name: "Biznes", businessType,
          offeringTypes: [offering], useCases: ["support"],
          details: { ...emptyDetails, categoryDescription: "Studio fotografike" },
        }, true);
        expect(answers.offeringTypes).toEqual([offering]);
        expect(answers.businessProfile?.businessType).toBe(businessType);
      }
    }
  });

  it("preserves old sector IDs and lets the user review their existing choice", () => {
    for (const [businessType] of legacyBusinessCategories) {
      const saved = parseAnswers({ ...emptyAnswers, name: "Biznes", businessType,
        offeringTypes: ["standard"], useCases: ["support"], teamSize: "20+" }, true);
      expect(saved.businessType).toBe(businessType);
      expect(saved.teamSize).toBe("20+");
      const choices = activeQuestions(allQuestionKeys, saved).find(q => q.key === "businessType")!.options;
      expect(choices.some(([id]) => id === businessType)).toBe(true);
    }
  });

  it("uses the custom activity for other-sector guidance and protects it from audio replacement", () => {
    const base = parseAnswers({ ...emptyAnswers, name: "Foto", businessType: "other",
      details: { ...emptyDetails, categoryDescription: "Studio fotografike" } });
    expect(audioGuide(base)[0].hint).toContain("Studio fotografike");
    const extracted = validateExtraction(Object.fromEntries(audioFields.map(key => [key, {
      value: key === "categoryDescription" ? "Aktivitet tjetër" : null,
      confidence: 0.9, evidence: "aktivitet tjetër",
    }])), "aktivitet tjetër");
    expect(mergeExtraction(base, extracted, "11111111-1111-4111-8111-111111111111").details?.categoryDescription).toBe("Studio fotografike");
  });

  it("asks about multiple catalogs only when described, and never requires an upload", () => {
    const base = parseAnswers({ ...emptyAnswers, name: "Distribucion", businessType: "manufacturing",
      offeringTypes: ["standard"], useCases: ["orders"],
      audioReview: { analysisIds: ["11111111-1111-4111-8111-111111111111"] },
      details: { ...emptyDetails, businessDescription: "Kemi disa katalogë për marka të ndryshme." },
    });
    expect(needsCatalogContext(base)).toBe(true);
    expect(audioGuide(base).some(q => q.id === "catalogContext")).toBe(true);
    expect(needsCatalogContext({ ...base, details: emptyDetails })).toBe(false);
    expect(() => parseAnswers({ ...base, audioReview: { ...base.audioReview, reviewed: true } }, true)).not.toThrow();
    const completed = parseAnswers({ ...base, details: { ...base.details, catalogContext: "Disa katalogë sipas markës." } });
    const signals = signalsFromOnboardingAnswers(completed as unknown as Record<string, unknown>)!;
    expect(generateDashboardProfile(signals).enabledModules).toContain("catalogs");
  });

  it("uses offers and goals, independently of sector and employee count, to configure modules", () => {
    const examples = [
      { businessType: "technical", offeringTypes: ["services"], useCases: ["leads"], expected: ["services", "leads"] },
      { businessType: "beauty", offeringTypes: ["mixed"], useCases: ["booking", "orders"], expected: ["services", "products", "bookings", "orders"] },
      { businessType: "electronics", offeringTypes: ["mixed"], useCases: ["booking", "orders"], expected: ["services", "products", "bookings", "orders"] },
      { businessType: "education", offeringTypes: ["mixed"], useCases: ["booking", "orders"], expected: ["services", "products", "bookings", "orders"] },
      { businessType: "other", offeringTypes: ["services"], useCases: ["support"], expected: ["services", "inbox"] },
    ];
    for (const example of examples) {
      const answers = parseAnswers({ ...emptyAnswers, name: "Biznes", ...example });
      const signals = signalsFromOnboardingAnswers(answers as unknown as Record<string, unknown>)!;
      const solo = generateDashboardProfile({ ...signals, teamSize: "solo" });
      const large = generateDashboardProfile({ ...signals, teamSize: "20+" });
      expect(solo.enabledModules).toEqual(large.enabledModules);
      expect(solo.enabledModules).toEqual(expect.arrayContaining(example.expected));
      expect(solo.enabledModules).not.toContain("staff");
    }
    expect(allQuestionKeys).not.toContain("teamSize");
    expect(normalizeOnboardingSteps(["businessType", "teamSize"])).toEqual(["businessType"]);
    expect(extractionSchema.properties).not.toHaveProperty("teamSize");
  });
});
