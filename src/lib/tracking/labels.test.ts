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

describe("why the agent did not reply", () => {
  it("reads the no-reply codes", async () => {
    const { exitLabel } = await import("./labels");
    expect(exitLabel("ignored", "auto_reply_off")).toBe("Pa përgjigje: përgjigjet automatike janë të fikura");
    expect(exitLabel("ignored", "conversation_paused")).toBe("Pa përgjigje: biseda është te stafi");
  });
});

describe("neutral outcomes keep their reason", () => {
  it("lists why nothing happened after what went wrong", async () => {
    const { summarizeHealth } = await import("./health");
    const [item] = summarizeHealth([
      { capability: "customer.reply", point: "ignored", outcome: "neutral", reason: "auto_reply_off", events: 120, businesses: 1, examples: [] },
      { capability: "customer.reply", point: "ignored", outcome: "neutral", reason: null, events: 3, businesses: 1, examples: [] },
      { capability: "customer.reply", point: "failed", outcome: "failure", reason: "provider_error", events: 2, businesses: 1, examples: [] },
    ], [], {});
    expect(item.reasons.map(r => [r.outcome, r.reason])).toEqual([["failure", "provider_error"], ["neutral", "auto_reply_off"]]);
    expect(item.neutral).toBe(123);
  });
});
