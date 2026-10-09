import { describe, expect, it, vi } from "vitest";
import { allocateUniqueBusinessSlug, slugifyBusinessName } from "./slug";

describe("slugifyBusinessName", () => {
  it("ekstrakton slug nga emri", () => {
    expect(slugifyBusinessName("Dyqani Im")).toBe("dyqani-im");
  });

  it("heq diakritikët shqip", () => {
    expect(slugifyBusinessName("Lulëzimi i Çuditshëm")).toBe(
      "lulezimi-i-cuditshem",
    );
  });

  it("kthen null për emër pa shkronja/numra", () => {
    expect(slugifyBusinessName("!!!")).toBeNull();
  });
});

describe("allocateUniqueBusinessSlug", () => {
  it("kthen bazën kur është e lirë", async () => {
    const or = vi.fn(async () => ({ data: [] }));
    const db = {
      from: () => ({ select: () => ({ or }) }),
    };
    await expect(allocateUniqueBusinessSlug(db, "dyqani")).resolves.toBe(
      "dyqani",
    );
  });

  it("shton numër kur slug ekziston", async () => {
    const or = vi.fn(async () => ({
      data: [{ slug: "dyqani" }, { slug: "dyqani-1" }, { slug: "dyqani-2" }],
    }));
    const db = {
      from: () => ({ select: () => ({ or }) }),
    };
    await expect(allocateUniqueBusinessSlug(db, "dyqani")).resolves.toBe(
      "dyqani-3",
    );
  });

  it("starts at -1 and uses the first available number", async () => {
    const db = { from: () => ({ select: () => ({ or: async () => ({ data: [{ slug: "dyqani" }, { slug: "dyqani-2" }] }) }) }) };
    await expect(allocateUniqueBusinessSlug(db, "dyqani")).resolves.toBe("dyqani-1");
  });
});
