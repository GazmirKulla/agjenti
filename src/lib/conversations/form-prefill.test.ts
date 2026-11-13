import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/openai", () => ({ default: class {} }));
vi.mock("@/lib/agents/generate", () => ({ modelFor: () => "test" }));
vi.mock("@/lib/orchestration/version-store", () => ({ compileProcessVersion: () => [], loadCurrentLinearVersions: async () => [] }));
vi.mock("./context", () => ({ fieldPresentation: () => ({ label: null, missing: null }), loadConversationContext: async () => null }));

const { checkValue, collectedValues, mergePrefill } = await import("./form-prefill");

const product = "11111111-1111-4111-8111-111111111111";
const service = "22222222-2222-4222-8222-222222222222";
const input = { products: [{ id: product, name: "Fustan" }], services: [{ id: service, name: "Prerje" }], today: "2026-11-13" };

describe("checkValue", () => {
  it("keeps only catalog products and services", () => {
    expect(checkValue("product_id", product, input)).toBe(product);
    expect(checkValue("product_id", "33333333-3333-4333-8333-333333333333", input)).toBe("");
    expect(checkValue("product_id", "Fustan", input)).toBe("");
    expect(checkValue("service_id", service, input)).toBe(service);
  });
  it("rejects past dates, bad times and bad quantities", () => {
    expect(checkValue("date", "2026-11-14", input)).toBe("2026-11-14");
    expect(checkValue("date", "2026-11-12", input)).toBe("");
    expect(checkValue("time", "17:30", input)).toBe("17:30");
    expect(checkValue("time", "5pm", input)).toBe("");
    expect(checkValue("quantity", "02", input)).toBe("2");
    expect(checkValue("quantity", "0", input)).toBe("");
    expect(checkValue("quantity", "dy", input)).toBe("");
    expect(checkValue("quantity", "0.5", input)).toBe("0.5");
    expect(checkValue("quantity", "12.250", input)).toBe("12.25");
    expect(checkValue("quantity", "0,5", input)).toBe("");
    expect(checkValue("quantity", "0.0001", input)).toBe("");
  });
  it("checks phones and emails and drops empty values", () => {
    expect(checkValue("phone", "+355 69 123 4567", input)).toBe("+355 69 123 4567");
    expect(checkValue("phone", "nuk e di", input)).toBe("");
    expect(checkValue("email", "ana@example.com", input)).toBe("ana@example.com");
    expect(checkValue("email", "ana@", input)).toBe("");
    expect(checkValue("name", "   ", input)).toBe("");
    expect(checkValue("name", 42, input)).toBe("");
  });
});

describe("mergePrefill", () => {
  it("prefers what the customer wrote and keeps what is known for the rest", () => {
    const result = mergePrefill({
      kind: "order",
      collected: { name: "ana.shop", phone: "", city: "Tiranë" },
      model: { name: { value: "Anila Hoxha", evidence: "jam Anila Hoxha" }, phone: { value: "0691234567", evidence: "0691234567" }, product_id: { value: product, evidence: "fustanin e zi" } },
    });
    expect(result.fields.name).toEqual({ value: "Anila Hoxha", source: "biseda", evidence: "jam Anila Hoxha" });
    expect(result.fields.city).toEqual({ value: "Tiranë", source: "agjenti", evidence: "" });
    expect(result.fields.phone?.source).toBe("biseda");
    expect(result.fields.product_id?.value).toBe(product);
    expect(result.missing).toEqual([]);
  });
  it("lists the required fields still missing and ignores fields of other forms", () => {
    const result = mergePrefill({ kind: "booking", collected: {}, model: { product_id: { value: product, evidence: "" }, date: { value: "2026-11-14", evidence: "nesër" } } });
    expect(result.fields.product_id).toBeUndefined();
    expect(result.fields.date?.value).toBe("2026-11-14");
    expect(result.missing).toEqual(["Shërbimi", "Ora", "Emri"]);
  });
});

describe("collectedValues", () => {
  it("reads the agent's profile and the form starting values", () => {
    const context = {
      profile: { name: "Ana", phone: null, email: null, city: "Tiranë", address: null },
      customer: { linked: true, name: "Ana K.", phone: "0691234567", since: null },
      forms: {
        order: { enabled: true, productId: product, productName: "Fustan", quantity: 2 },
        booking: { enabled: true, services: [], serviceId: null, date: "2026-11-20", time: null },
      },
    } as unknown as Parameters<typeof collectedValues>[0];
    expect(collectedValues(context, "order")).toMatchObject({ name: "Ana", phone: "0691234567", city: "Tiranë", product_id: product, quantity: "2" });
    expect(collectedValues(context, "booking")).toMatchObject({ date: "2026-11-20", service_id: "", time: "" });
  });
});
