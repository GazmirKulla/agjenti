import { describe, expect, it } from "vitest";
import { normalizeExternalKey } from "./keys";

describe("normalizeExternalKey", () => {
  it("slugifies names for catalog mapping", () => {
    expect(normalizeExternalKey("Me personalizim")).toBe("me-personalizim");
    expect(normalizeExternalKey("  Puzzle  ")).toBe("puzzle");
    expect(normalizeExternalKey("T-Shirt!")).toBe("t-shirt");
  });

  it("returns null for empty values", () => {
    expect(normalizeExternalKey("")).toBeNull();
    expect(normalizeExternalKey("   ")).toBeNull();
    expect(normalizeExternalKey("---")).toBeNull();
  });
});
