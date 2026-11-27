import { describe, expect, it } from "vitest";
import { type CapabilityModule, averagePercent, businessCapabilities, customerCapabilities, manualByDesign, modulePercent, statusCounts } from "./capabilities";

describe("capability report", () => {
  it("scores Po as 1, Pjesërisht as 0.5 and Jo as 0", () => {
    const sample: CapabilityModule = { name: "x", items: [["po", "a"], ["pjes", "b"], ["jo", "c"], ["po", "d"]] };
    expect(modulePercent(sample)).toBe(63);
    expect(statusCounts(sample)).toEqual({ po: 2, pjes: 1, jo: 1 });
    expect(averagePercent([{ name: "a", items: [["po", "a"]] }, { name: "b", items: [["jo", "b"]] }])).toBe(50);
  });

  it("has no empty or duplicate modules or capabilities", () => {
    for (const modules of [customerCapabilities, businessCapabilities]) {
      expect(modules.every(m => m.items.length > 0)).toBe(true);
      expect(new Set(modules.map(m => m.name)).size).toBe(modules.length);
      for (const m of modules) expect(new Set(m.items.map(([, text]) => text)).size).toBe(m.items.length);
    }
    expect(manualByDesign.length).toBeGreaterThan(0);
  });
});
