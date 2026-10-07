import { describe, it, expect } from "vitest";
import {
  emptyDraft,
  parseEntities,
  mergeDraft,
  validateForApply,
  value,
  entityValidationIssues,
  EntityValidationError,
} from "./model";
const entity = (source: "audio" | "website" | "manual", price: string) =>
  parseEntities(
    [
      {
        target: "product",
        facts: [
          {
            field: "name",
            value: "Puzzle",
            confidence: 0.9,
            evidence: "Puzzle",
          },
          { field: "price", value: price, confidence: 0.95, evidence: price },
          { field: "currency", value: "EUR", confidence: 0.9, evidence: "EUR" },
        ],
      },
    ],
    source,
    "test",
    `Puzzle ${price} EUR`,
  )[0];
describe("shared business intelligence", () => {
  it("reports the exact invalid fields of an existing draft, including Lek currency", () => {
    const e = entity("manual", "-5");
    e.facts.find((f) => f.field === "currency")!.value = "Lek";
    expect(entityValidationIssues([e])).toEqual([
      { entityId: e.id, field: "price", message: expect.any(String) },
      { entityId: e.id, field: "currency", message: expect.stringContaining("ALL për Lek") },
    ]);
    expect(() => validateForApply([e])).toThrow(EntityValidationError);
    e.facts.find((f) => f.field === "price")!.value = "790";
    e.facts.find((f) => f.field === "currency")!.value = "ALL";
    expect(entityValidationIssues([e])).toEqual([]);
  });
  it("normalizes explicit currency names from source evidence without inventing unknown currencies", () => {
    for (const [input, expected] of [["Lek", "ALL"], ["lekë", "ALL"], ["eur", "EUR"], ["Euro", "EUR"], ["usd", "USD"], ["$", "$"]]) {
      const e = parseEntities([{ target: "product", facts: [{ field: "currency", value: input, evidence: input }] }], "instagram", "test", input)[0];
      expect(value(e, "currency")).toBe(expected);
      expect(e.facts[0].evidence).toBe(input);
    }
    const unsupported = parseEntities([{ target: "product", facts: [{ field: "currency", value: "Lek", evidence: "missing" }] }], "instagram", "test", "790")[0];
    expect(value(unsupported, "currency")).toBe("");
  });
  it("returns all missing fields and rejects numeric syntax PostgreSQL cannot store", () => {
    const e = entity("manual", "5");
    e.facts = e.facts.filter((f) => !["price", "currency"].includes(f.field));
    expect(entityValidationIssues([e]).map((issue) => issue.field)).toEqual(["price", "currency"]);
    expect(entityValidationIssues([entity("manual", "0x10")])[0].field).toBe("price");
    expect(entityValidationIssues([entity("manual", "0")])).toEqual([]);
  });
  it("preserves existing and user-confirmed facts, creates conflicts without source priority", () => {
    const a = entity("website", "5");
    a.facts.forEach((f) => (f.confirmedByUser = true));
    const merged = mergeDraft(mergeDraft(emptyDraft(), [a]), [
      entity("audio", "7"),
    ]);
    expect(value(merged.entities[0], "price")).toBe("5");
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0].incoming.source).toBe("audio");
    expect(
      mergeDraft(mergeDraft(emptyDraft(), [entity("audio", "7")]), [
        entity("manual", "5"),
      ]).conflicts,
    ).toHaveLength(1);
  });
  it("supplemental data fills missing fields without erasing or duplicating", () => {
    const first = entity("audio", "7");
    first.facts = first.facts.filter((f) => f.field !== "currency");
    const merged = mergeDraft(mergeDraft(emptyDraft(), [first]), [
      entity("website", "7"),
    ]);
    expect(merged.entities).toHaveLength(1);
    expect(merged.conflicts).toHaveLength(0);
    expect(value(merged.entities[0], "currency")).toBe("EUR");
  });
  it("unknown facts require source evidence and supported mappings", () => {
    const e = parseEntities(
      [
        {
          target: "profile",
          facts: [
            {
              field: "businessType",
              value: "arbitrary",
              confidence: 1,
              evidence: "arbitrary",
            },
            {
              field: "shipping",
              value: "Free",
              confidence: 1,
              evidence: "not present",
            },
          ],
        },
      ],
      "audio",
      "audio:1",
      "arbitrary",
    );
    expect(e[0].facts.every((f) => f.value === null)).toBe(true);
    expect(() =>
      parseEntities(
        [{ target: "product", facts: [{ field: "secret", value: "x" }] }],
        "manual",
        "",
        "",
      ),
    ).toThrow(/nuk u gjetën të dhëna/i);
    const mixed = parseEntities(
      [
        {
          target: "service",
          facts: [
            {
              field: "category",
              value: "SaaS",
              confidence: 1,
              evidence: "SaaS",
            },
            {
              field: "name",
              value: "Agjenti",
              confidence: 0.9,
              evidence: "Agjenti",
            },
            {
              field: "description",
              value: "Asistent",
              confidence: 0.8,
              evidence: "Asistent",
            },
          ],
        },
      ],
      "website",
      "https://www.agjenti.app",
      "Agjenti Asistent SaaS",
    );
    expect(mixed).toHaveLength(1);
    expect(mixed[0].facts.map((f) => f.field).sort()).toEqual([
      "description",
      "name",
    ]);
  });
  it("detects missing prices and rejects invalid workflow / monetary fields", () => {
    const e = entity("manual", "-5");
    expect(() => validateForApply([e])).toThrow();
    const w = parseEntities(
      [
        {
          target: "workflow",
          facts: [
            { field: "name", value: "New" },
            { field: "steps", value: "execute|Delete all" },
          ],
        },
      ],
      "manual",
      "",
      "",
    );
    expect(() => validateForApply(w)).toThrow();
    const missing = entity("manual", "5");
    missing.facts = missing.facts.filter((f) => f.field !== "price");
    expect(mergeDraft(emptyDraft(), [missing]).missingInformation[0]).toContain(
      "price",
    );
  });
  it("validates ordered photo/address workflows and same-value idempotent merges", () => {
    const w = parseEntities(
      [
        {
          target: "workflow",
          facts: [
            { field: "name", value: "Photo" },
            { field: "steps", value: "photo|Foto\ncustomer|Adresa" },
          ],
        },
      ],
      "manual",
      "",
      "",
    );
    expect(() => validateForApply(w)).not.toThrow();
    const e = entity("audio", "7");
    expect(mergeDraft(mergeDraft(emptyDraft(), [e]), [e]).conflicts).toEqual(
      [],
    );
  });
});
