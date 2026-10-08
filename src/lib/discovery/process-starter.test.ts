import { describe, it, expect } from "vitest";
import { onboardingProcess } from "./process-starter";
import { signalsFor } from "./proposal";
import { processSources, parseBusinessProcess, businessProcessContext } from "./business-process";
import { emptyDraft } from "@/lib/business-intelligence/model";
describe("onboarding customer journey starter", () => {
  it("follows the same service and product rules as the onboarding choices", () => {
    const service = onboardingProcess(signalsFor("services", ["services"]), null);
    expect(service.steps.map(step => step.title)).toContain("Përgatit kërkesën për stafin");
    expect(service.steps.map(step => step.title)).not.toContain("Vazhdo me workflow-n e ofertës");
    const fashion = onboardingProcess(signalsFor("fashion", ["variants"]), null);
    expect(fashion.steps.map(step => step.title)).toContain("Ndihmo me zgjedhjen");
    expect(fashion.steps.map(step => step.title)).toContain("Vazhdo me workflow-n e ofertës");
    expect(parseBusinessProcess(service)).toEqual(service);
    expect(businessProcessContext(service)).toContain("not verified business policy");
  });
  it("enriches a starter with actual source steps without laundering platform suggestions into business evidence", () => {
    const sourced = { version: 1 as const, source: "generated" as const, enabled: true, name: "PDF", summary: "Shkarko PDF", steps: [{ key: "one", title: "Shkarko PDF", description: "Merr materialet në website", evidence: "Shkarko PDF", sourceRef: "instagram:studio" }], unknowns: ["Pagesa nuk është publikuar"] };
    const result = onboardingProcess(signalsFor("ecommerce", ["standard"]), sourced);
    expect(result.publishedSteps).toContainEqual(expect.objectContaining({ sourceRef: "instagram:studio", evidence: "Shkarko PDF" }));
    expect(result.steps.length).toBeLessThanOrEqual(8);
    expect(result.unknowns).toEqual(sourced.unknowns);
    expect(parseBusinessProcess(result)).toEqual(result);
    expect(processSources(emptyDraft(), "", "ig:1", result)).toEqual([{ reference: "instagram:studio", text: "Shkarko PDF" }]);
    expect(businessProcessContext(result)).toContain("publishedSteps");
    expect(parseBusinessProcess({ ...result, publishedSteps: [{}] })).toBeNull();
    expect(parseBusinessProcess(result, true)?.publishedSteps?.[0]).toMatchObject({ evidence: "", sourceRef: "manual" });
  });
});
