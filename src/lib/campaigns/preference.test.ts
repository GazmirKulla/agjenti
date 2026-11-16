import { describe, expect, it, vi } from "vitest";
vi.mock("./confirmation", () => ({ confirmMarketingWithdrawal: vi.fn() }));
import { validatePreference } from "./preference";
const message = (body: string) => ({ id: "current", body, source: "customer", direction: "inbound" });
const decision = (evidence: string, kind = "unsubscribe") => ({ messageId: "current", conversationId: "conversation", decision: kind, evidence, referenceMessageId: null, hasOtherRequest: false });
describe("validated semantic preference contract (model decisions are fixtures, not live semantic evaluations)", () => {
  it.each(["Mos më dërgoni më oferta", "Please stop the promotions", "No quiero recibir más promociones", "Je ne souhaite plus recevoir vos offres"])("accepts grounded withdrawal evidence in any language: %s", text => {
    expect(validatePreference(decision(text), message(text), "conversation", []).decision).toBe("unsubscribe");
  });
  it("does not interpret a quoted command as a withdrawal by matching words", () => {
    const text = "What does STOP mean?";
    expect(validatePreference({ ...decision(text), decision: "unchanged", evidence: null, hasOtherRequest: true }, message(text), "conversation", []).decision).toBe("unchanged");
  });
  it("retains ambiguity and mixed service questions", () => {
    expect(validatePreference({ ...decision(""), decision: "ambiguous", evidence: null }, message("Maybe not those"), "conversation", []).decision).toBe("ambiguous");
    expect(validatePreference({ ...decision("Stop offers"), hasOtherRequest: true }, message("Stop offers. Where is my order?"), "conversation", []).hasOtherRequest).toBe(true);
  });
  it("requires a matching message, conversation, evidence and reference", () => {
    expect(() => validatePreference({ ...decision("No"), messageId: "another" }, message("No"), "conversation", [])).toThrow();
    expect(() => validatePreference(decision("No"), message("No"), "other-tenant-thread", [])).toThrow();
    expect(() => validatePreference(decision("stop"), message("Where is my order?"), "conversation", [])).toThrow();
    expect(() => validatePreference({ ...decision("Yes", "subscribe"), referenceMessageId: "missing" }, message("Yes"), "conversation", [])).toThrow();
    expect(validatePreference({ ...decision("Yes", "subscribe"), referenceMessageId: "request" }, message("Yes"), "conversation", [{ id: "request", body: "May we send promotional offers?", source: "staff", direction: "outbound" }]).decision).toBe("subscribe");
  });
});
