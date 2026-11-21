import { describe, expect, it } from "vitest";
import { type CapabilityModule, averagePercent, businessCapabilities, customerCapabilities, modulePercent, securityOnlyModules, statusCounts } from "./capabilities";

describe("capability report", () => {
  it("scores Po as 1, Pjesërisht as 0.5 and Jo as 0", () => {
    const sample: CapabilityModule = { name: "x", items: [["po", "a"], ["pjes", "b"], ["jo", "c"], ["po", "d"]] };
    expect(modulePercent(sample)).toBe(63);
    expect(statusCounts(sample)).toEqual({ po: 2, pjes: 1, jo: 1 });
    expect(averagePercent([{ name: "a", items: [["po", "a"]] }, { name: "b", items: [["jo", "b"]] }])).toBe(50);
  });

  it("has no empty or duplicate modules, and the security-only modules exist", () => {
    for (const modules of [customerCapabilities, businessCapabilities]) {
      expect(modules.every(m => m.items.length > 0)).toBe(true);
      expect(new Set(modules.map(m => m.name)).size).toBe(modules.length);
    }
    const names = businessCapabilities.map(m => m.name);
    expect(securityOnlyModules.every(name => names.includes(name))).toBe(true);
  });
});
