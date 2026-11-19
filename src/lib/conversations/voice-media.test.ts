import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
vi.mock("@/lib/ai/usage", () => ({ withAiUsage: (_b: string, work: () => unknown) => work() }));
import { messageWithVoice } from "./voice-media";
import { parseObservation } from "@/lib/orchestration/observation";
import { readAgentBehavior } from "@/lib/agents/behavior";

describe("voice messages and videos the customer sends", () => {
  it("gives the agent what was said, and says plainly when it could not be heard", () => {
    expect(messageWithVoice("", [{ kind: "audio", transcript: "A e keni në të kuqe?" }])).toBe("[Mesazh zanor i klientit, i transkriptuar] A e keni në të kuqe?");
    expect(messageWithVoice("Përshëndetje", [{ kind: "video", failure: "too_large" }]))
      .toBe("Përshëndetje\n[Video i klientit që nuk u dëgjua (too_large); kërkoji klientit ta shkruajë.]");
  });
});

describe("a customer who needs a person", () => {
  const base = { revision: 1, commands: [], needsClarification: false };
  it("counts only a reading with a reason and a quote", () => {
    expect(parseObservation({ ...base, escalation: { needed: true, reason: "complaint", evidence: "Më erdhi i thyer" } }).escalation)
      .toEqual({ reason: "complaint", evidence: "Më erdhi i thyer" });
    expect(parseObservation({ ...base, escalation: { needed: false, reason: "none", evidence: "" } }).escalation).toBeUndefined();
    expect(parseObservation({ ...base, escalation: { needed: true, reason: "dissatisfied", evidence: "" } }).escalation).toBeUndefined();
    expect(parseObservation(base).escalation).toBeUndefined();
    expect(() => parseObservation({ ...base, escalation: { needed: true, reason: "approve_order", evidence: "x" } })).toThrow();
  });
  it("hands off by default, reads voice by default, and keeps only allowed values", () => {
    expect(readAgentBehavior({})).toEqual({ voice: true, escalation: "handoff" });
    expect(readAgentBehavior({ voice: false, escalation: "notify" })).toEqual({ voice: false, escalation: "notify" });
    expect(readAgentBehavior({ voice: "yes", escalation: "shout" })).toEqual({ voice: true, escalation: "handoff" });
  });
});
