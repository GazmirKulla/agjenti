import { describe, expect, it } from "vitest";
import { filledFields, missingReadiness, productReadiness, type ReadinessInput } from "./readiness";

const ready: ReadinessInput = { name: "Libri", description: "Për fëmijë 5 vjeç", image: "https://cdn.test/a.jpg", price_amount: 790, currency: "ALL",
  details: { filled: 2, total: 3 }, workflow: true, active: true };

describe("one readiness rule for the product page, the form and the list", () => {
  it("is complete when the agent can find, present and order the product", () => {
    expect(missingReadiness(productReadiness(ready))).toEqual([]);
  });
  it("names what is missing and where it is filled", () => {
    const missing = missingReadiness(productReadiness({ ...ready, description: " ", details: { filled: 0, total: 3 }, workflow: false }));
    expect(missing.map(m => [m.key, m.anchor])).toEqual([["description", "product-identity"], ["details", "product-details"], ["workflow", "product-process"]]);
  });
  it("never counts an optional photo as missing, and has no fields item when the business has no fields", () => {
    const items = productReadiness({ ...ready, image: null, details: { filled: 0, total: 0 } });
    expect(missingReadiness(items)).toEqual([]);
    expect(items.map(i => i.key)).not.toContain("details");
  });
  it("treats a price on request as a price, and an archived or sold product as not offered", () => {
    expect(missingReadiness(productReadiness({ ...ready, price_amount: null, price_mode: "request" }))).toEqual([]);
    expect(missingReadiness(productReadiness({ ...ready, archived: true })).map(m => m.key)).toEqual(["active"]);
    expect(missingReadiness(productReadiness({ ...ready, availability: "sold" })).map(m => m.key)).toEqual(["active"]);
  });
  it("counts only fields with a real value", () => {
    expect(filledFields(["mosha", "faqe", "gjuha", "ngjyra"], { mosha: "3-6", faqe: "", gjuha: [], ngjyra: ["e kuqe"] })).toEqual({ filled: 2, total: 4 });
  });
});
describe("a product kept for information only", () => {
  it("needs no order process and says so", () => {
    const items = productReadiness({ ...ready, workflow: false, informationOnly: true });
    expect(missingReadiness(items)).toEqual([]);
    expect(items.find(i => i.key === "workflow")?.label).toBe("Vetëm për informim");
  });
});
