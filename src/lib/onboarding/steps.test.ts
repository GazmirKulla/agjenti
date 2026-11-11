import { expect, it } from "vitest";
import { onboardingAfterCreate } from "./steps";

it("confirms the given sources first, else goes straight to the questions", () => {
  expect(onboardingAfterCreate("biznes-1", { instagramUsername: "zana.store", website: "https://zana.al/" }))
    .toBe("/onboarding/sources?slug=biznes-1&instagram=zana.store&website=https%3A%2F%2Fzana.al%2F");
  expect(onboardingAfterCreate("biznes-1", { instagramUsername: null, website: "https://zana.al/" }))
    .toBe("/onboarding/sources?slug=biznes-1&website=https%3A%2F%2Fzana.al%2F");
  expect(onboardingAfterCreate("biznes-1", { instagramUsername: null, website: null })).toBe("/onboarding/questions?slug=biznes-1");
});
