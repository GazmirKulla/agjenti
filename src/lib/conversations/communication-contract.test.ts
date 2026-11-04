import { describe, expect, it } from "vitest";
import { parseCommunicationDraft } from "./communication-contract";

describe("model communication authority", () => {
  it("accepts language and one relevant question without granting effects", () => {
    expect(parseCommunicationDraft({ answer: "I can explain how it works.", question: { field: "business_type", text: "What kind of business do you run?", purpose: "understand_need" } }))
      .toEqual({ answer: "I can explain how it works.", question: { field: "business_type", text: "What kind of business do you run?", purpose: "understand_need" } });
  });
  it.each([
    { answer: "Done", question: null, action: "business.provision" },
    { answer: "[[ask_customer:name]]", question: null },
    { answer: "Hello", question: { field: "password", text: "Password?", purpose: "current_request" } },
    { answer: "Hello", question: { field: "name", text: "Name? Email?", purpose: "current_request" } },
    { answer: "Hello", question: { field: "name", text: "https://untrusted.test?", purpose: "current_request" } },
    { answer: "Hello", question: { field: "name", text: "Name?", purpose: "current_request", confirmed: true } },
    { answer: "Hello" },
  ])("rejects malformed output and attempts to extend the contract: %j", value => {
    expect(parseCommunicationDraft(value)).toBeNull();
  });
});
