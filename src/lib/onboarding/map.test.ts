import { expect, it } from "vitest";
import {
  onboardingLinks,
  profileLinkRows,
  questionLabel,
  wizardSteps,
} from "./map";

it("lists wizard steps in dependency order", () => {
  const steps = wizardSteps();
  expect(steps.map((step) => step.key)).toEqual([
    "businessType",
    "productType",
    "useCases",
    "aiMode",
    "productCount",
    "messageVolume",
  ]);
  expect(steps.find((step) => step.key === "aiMode")?.influencedBy).toEqual([
    "productType",
    "useCases",
  ]);
});

it("describes conditional links between questions", () => {
  const edges = onboardingLinks().map((link) => `${link.from}->${link.to}`);
  expect(edges).not.toContain("businessType->productType");
  expect(edges).toContain("useCases->aiMode");
  expect(edges).toContain("productType->useCases");
});

it("maps use-case capabilities per business profile", () => {
  const ecommerce = profileLinkRows().find(
    (row) => row.businessType === "ecommerce",
  );
  expect(ecommerce).toBeTruthy();
  expect(ecommerce!.offerings.some(([value]) => value === "standard")).toBe(
    true,
  );
  const sales = ecommerce!.useCaseCapabilityLinks.find(
    (row) => row.useCase[0] === "sales",
  );
  expect(sales?.capabilities.map(([value]) => value)).toContain(
    "recommend_products",
  );
  expect(questionLabel("useCases")).toBe("Çfarë do të bëjë agjenti për biznesin tënd");
});
