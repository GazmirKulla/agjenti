import { describe, expect, it } from "vitest";
import { emptyAnswers, initialInstructions, parseAnswers } from "./model";
import {
  audioFields,
  emptyDetails,
  pendingConfirmations,
} from "./audio-fields";
import {
  validateExtraction,
  mergeExtraction,
  correctField,
  clarifications,
  type Extraction,
} from "./audio-model";
const id = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const patch = (
  fields: Record<string, unknown>,
  confidence = 0.95,
): Extraction =>
  Object.fromEntries(
    audioFields.map((key) => [
      key,
      {
        value: fields[key] ?? null,
        confidence: fields[key] == null ? 0 : confidence,
        evidence: fields[key] == null ? null : "sallon bukurie",
      },
    ]),
  ) as Extraction;
const base = () =>
  mergeExtraction(
    emptyAnswers,
    patch({
      name: "Lule",
      businessType: "services",
      businessCategory: "beauty",
      offeringTypes: ["services"],
      useCases: ["support", "booking"],
      agentCapabilities: ["answer_questions", "handle_bookings"],
      sellsProducts: false,
      businessDescription: "Sallon bukurie.",
    }),
    id,
  );
describe("audio onboarding evidence and merge", () => {
  it("replaces written offering prose with individually extracted products and services", () => {
    const current = correctField(base(), "offeringsSummary", ["Shes shampo dhe ofroj prerje flokësh."]);
    const next = mergeExtraction(current, patch({ offeringsSummary: ["Shampo", "Prerje flokësh"] }), secondId, { replaceWrittenOfferings: true });
    expect(next.details?.offeringsSummary).toEqual(["Shampo", "Prerje flokësh"]);
    expect(next.audioReview?.corrections).not.toHaveProperty("offeringsSummary");
    expect(next.audioReview?.confidence.offeringsSummary).toBe(0.95);
    expect(parseAnswers(next).audioReview?.inputMode).toBe("written");
    expect(mergeExtraction(current, patch({}), secondId, { replaceWrittenOfferings: true }).details?.offeringsSummary)
      .toEqual(["Shes shampo dhe ofroj prerje flokësh."]);
  });
  it("lists one or multiple offerings from audio and deduplicates supplemental mentions", () => {
    const first = mergeExtraction(base(), patch({ offeringsSummary: ["Prerje flokësh"] }), id);
    expect(first.details?.offeringsSummary).toEqual(["Prerje flokësh"]);
    expect(parseAnswers(first).audioReview?.inputMode).toBe("audio");
    const next = mergeExtraction(first, patch({ offeringsSummary: ["Prerje flokësh", "Shampo"] }), secondId);
    expect(next.details?.offeringsSummary).toEqual(["Prerje flokësh", "Shampo"]);
    const corrected = correctField(next, "offeringsSummary", ["Vetëm shampo"]);
    expect(mergeExtraction(corrected, patch({ offeringsSummary: ["Prerje"] }), id).details?.offeringsSummary).toEqual(["Vetëm shampo"]);
  });
  it("preserves guided answers through extraction, supplemental audio, manual correction and completion", () => {
    const process = "Klienti zgjedh një orar. " + "Konfirmimin e bën stafi. ".repeat(5);
    const extraction = validateExtraction(patch({
      customerProcess: process,
      customerQuestions: "Kur jeni hapur? Nga e hëna në të premte.",
      handoffRules: "Ankesat i kalohen stafit.",
    }), "sallon bukurie");
    const first = mergeExtraction(base(), extraction, secondId);
    expect(first.details?.customerProcess).toBe(process.trim());
    const next = mergeExtraction(first, patch({ customerProcess: "Klienti mund ta ndryshojë orarin." }, 0.4), id);
    expect(next.details?.customerProcess).toContain(process.trim());
    expect(next.details?.customerProcess).toContain("ndryshojë");
    expect(pendingConfirmations(next.audioReview!)).toContain("customerProcess");
    const corrected = correctField(next, "customerProcess", "Stafi konfirmon çdo takim. ");
    expect(corrected.details?.customerProcess).toBe("Stafi konfirmon çdo takim. ");
    const merged = mergeExtraction(corrected, patch({ customerProcess: "Konfirmim automatik." }), secondId);
    expect(merged.details?.customerProcess).toBe("Stafi konfirmon çdo takim.");
    const completed = parseAnswers({ ...merged, audioReview: { ...merged.audioReview, reviewed: true } }, true);
    expect(completed.confirmedProfile?.details?.customerQuestions).toContain("Nga e hëna");
    expect(initialInstructions(completed)).toContain("Ankesat i kalohen stafit.");
    expect(validateExtraction(patch({ handoffRules: "E shpikur" }), "tekst tjetër").handoffRules.value).toBeNull();
  });
  it("accepts only supported enum values and evidenced fields", () => {
    const validated = validateExtraction(
      patch({ businessType: "services", hasVariants: false }),
      "Kam një sallon bukurie.",
    );
    expect(validated.businessType.value).toBe("services");
    expect(validated.hasVariants.value).toBe(false);
    expect(
      validateExtraction(patch({ name: "Invented" }), "Tjetër tekst").name
        .value,
    ).toBeNull();
    expect(() =>
      validateExtraction(patch({ businessType: "made-up" }), "sallon bukurie"),
    ).toThrow();
  });
  it("leaves unmentioned facts unknown, including booleans", () => {
    const next = mergeExtraction(
      emptyAnswers,
      patch({ businessType: "services" }),
      id,
    );
    expect(next.details?.hasVariants).toBeNull();
    expect(next.details?.sellsProducts).toBeNull();
    expect(next.offeringTypes).toEqual([]);
    expect(clarifications(next).map((v) => v.field)).toContain("offeringTypes");
  });
  it("keeps details in the unified profile and filters product capabilities for service-only offers", () => {
    const next = base();
    expect(next.businessProfile).toMatchObject({
      businessCategory: "beauty",
      sellsProducts: false,
      offeringTypes: ["services"],
    });
    const invalid = mergeExtraction(
      next,
      patch({
        useCases: ["orders"],
        agentCapabilities: ["recommend_products"],
      }),
      secondId,
    );
    expect(invalid.useCases).toEqual(["support", "booking"]);
    expect(invalid.agentCapabilities).not.toContain("recommend_products");
  });
  it("merges supplemental audio without erasing earlier values or description", () => {
    const initial = base();
    const next = mergeExtraction(
      initial,
      patch({
        useCases: ["customers"],
        offeringsSummary: ["Prerje flokësh"],
        businessDescription: "Punojmë me rezervime.",
      }),
      secondId,
    );
    expect(next.name).toBe("Lule");
    expect(next.useCases).toEqual(["support", "booking", "customers"]);
    expect(next.details?.businessDescription).toContain("Sallon bukurie.");
    expect(next.details?.businessDescription).toContain(
      "Punojmë me rezervime.",
    );
    expect(next.audioReview?.analysisIds).toEqual([id, secondId]);
  });
  it("protects manual corrections and pre-existing manual drafts", () => {
    const corrected = correctField(base(), "name", "Emri im");
    expect(
      mergeExtraction(corrected, patch({ name: "Emër tjetër" }), secondId).name,
    ).toBe("Emri im");
    expect(
      mergeExtraction(
        { ...emptyAnswers, name: "Manual" },
        patch({ name: "AI" }),
        id,
      ).name,
    ).toBe("Manual");
  });
  it("requires confirmation of low confidence and a final review", () => {
    const next = mergeExtraction(
      base(),
      patch({ customerQuestions: "Hapur çdo ditë." }, 0.5),
      secondId,
    );
    expect(pendingConfirmations(next.audioReview!)).toContain(
      "customerQuestions",
    );
    expect(() =>
      parseAnswers(
        { ...next, audioReview: { ...next.audioReview, reviewed: true } },
        true,
      ),
    ).toThrow(/Rishiko/);
    const corrected = correctField(next, "customerQuestions", "Hapur çdo ditë.");
    const final = parseAnswers(
      {
        ...corrected,
        audioReview: { ...corrected.audioReview, reviewed: true },
        confirmedProfile: { forged: true },
      },
      true,
    );
    expect(final.confirmedProfile?.customerQuestions).toBe("Hapur çdo ditë.");
    expect(final.confirmedProfile).not.toHaveProperty("forged");
  });
  it("invalidates review after editing and keeps explicit unknown corrections", () => {
    const initial = base();
    initial.audioReview!.reviewed = true;
    const edited = correctField(initial, "hasVariants", null);
    expect(edited.audioReview?.reviewed).toBe(false);
    expect(
      mergeExtraction(edited, patch({ hasVariants: true }), secondId).details
        ?.hasVariants,
    ).toBeNull();
  });
  it("does not inject product recommendations into service-only beauty defaults", () => {
    const next = parseAnswers({
      ...emptyAnswers,
      name: "Salon",
      businessType: "beauty",
      offeringTypes: ["services"],
      useCases: ["support"],
      details: emptyDetails,
    });
    expect(
      next.businessProfile?.recommendedConfiguration.capabilities,
    ).not.toContain("recommend_products");
    expect(
      next.businessProfile?.recommendedConfiguration.useCases,
    ).not.toContain("recommendations");
  });
  it("preserves spaces and newlines while editing and normalizes them on save", () => {
    let edited = correctField(base(), "name", "Lule ");
    expect(edited.name).toBe("Lule ");
    edited = correctField(edited, "businessDescription", "Një sallon ");
    expect(edited.details?.businessDescription).toBe("Një sallon ");
    edited = correctField(edited, "offeringsSummary", ["Prerje", ""]);
    expect(edited.details?.offeringsSummary).toEqual(["Prerje", ""]);
    expect(parseAnswers(edited).details?.offeringsSummary).toEqual(["Prerje"]);
  });
  it("requires clarification of conflicting facts and offerings before completion", () => {
    const next = correctField(base(), "sellsProducts", true);
    expect(
      clarifications(next).some((v) => v.message.includes("nuk përputhen")),
    ).toBe(true);
    expect(() =>
      parseAnswers(
        { ...next, audioReview: { ...next.audioReview, reviewed: true } },
        true,
      ),
    ).toThrow(/nuk përputhen/);
  });
});
