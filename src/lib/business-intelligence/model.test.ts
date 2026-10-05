import { describe, it, expect } from "vitest";
import {
  emptyDraft,
  parseEntities,
  mergeDraft,
  validateForApply,
  value,
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
    ).toThrow();
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
