import { describe, expect, it } from "vitest";
import { capabilities } from "./capabilities";
import { capabilityName, exitLabel, groupOf, moduleLabels } from "./labels";

describe("Platform Admin names every capability in Albanian and in a known group", () => {
  it("puts each capability in a group that has a name", () => {
    const unnamed = Object.entries(capabilities).filter(([id, spec]) => !moduleLabels[groupOf(id, spec.module)]).map(([id]) => id);
    expect(unnamed).toEqual([]);
  });
  it("gives each Assistant action a readable name instead of its key", () => {
    const technical = Object.entries(capabilities).filter(([id, spec]) => capabilityName(id, spec.label) === id.replace(/^assistant\./, "")).map(([id]) => id);
    expect(technical).toEqual([]);
  });
  it("explains a known reason and keeps an unknown one visible", () => {
    expect(exitLabel("failed", "out_of_stock")).toBe("Dështoi: produkti ka mbaruar");
    expect(exitLabel("blocked", "a_new_code")).toBe("U ndal nga serveri: a_new_code");
  });
});
