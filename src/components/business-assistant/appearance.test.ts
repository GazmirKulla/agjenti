import { afterEach, expect, it, vi } from "vitest";
import { clearLegacyAssistantAppearance } from "./appearance";

afterEach(() => vi.unstubAllGlobals());

it("removes retired customization for every user/business and preserves unrelated storage", () => {
  const values = new Map([
    ["agjenti:personal-assistant:v1:u1:shop", "Luna"],
    ["agjenti:personal-assistant:v1:u2:shop", "Migo"],
    ["agjenti-theme", "dark"],
    ["assistant-history", "conversation"],
  ]);
  vi.stubGlobal("localStorage", {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
  });
  clearLegacyAssistantAppearance();
  expect([...values.keys()]).toEqual(["agjenti-theme", "assistant-history"]);
  clearLegacyAssistantAppearance();
  expect(values.size).toBe(2);
});

it("does not prevent the assistant from loading when browser storage is disabled", () => {
  vi.stubGlobal("localStorage", { get length() { throw new Error("Storage denied"); } });
  expect(() => clearLegacyAssistantAppearance()).not.toThrow();
});
