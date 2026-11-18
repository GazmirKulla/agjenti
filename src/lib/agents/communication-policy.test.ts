import { expect, it } from "vitest";
import { communicationPolicyInstructions, defaultCommunicationPolicy, parseCommunicationPolicy } from "./communication-policy";
it("keeps presentation preferences distinct from execution authority", () => {
  expect(parseCommunicationPolicy({ ...defaultCommunicationPolicy, language: "en" }).language).toBe("en");
  for (const patch of [{ skipConfirmation: true }, { version: 2 }, { questions: "always" }, { language: "" }])
    expect(() => parseCommunicationPolicy({ ...defaultCommunicationPolicy, ...patch })).toThrow();
});
it("keeps product photos on for policies saved before the preference existed and accepts only its two values", () => {
  const { productPhotos: _omitted, ...legacy } = defaultCommunicationPolicy;
  expect(parseCommunicationPolicy(legacy).productPhotos).toBe("send");
  expect(parseCommunicationPolicy({ ...defaultCommunicationPolicy, productPhotos: "off" }).productPhotos).toBe("off");
  expect(() => parseCommunicationPolicy({ ...defaultCommunicationPolicy, productPhotos: "always" })).toThrow();
});
it("tells the agent how much to say about a presented product according to the business preference", () => {
  const { productDetails: _omitted, ...legacy } = defaultCommunicationPolicy;
  expect(parseCommunicationPolicy(legacy).productDetails).toBe("helpful");
  expect(() => parseCommunicationPolicy({ ...defaultCommunicationPolicy, productDetails: "everything" })).toThrow();
  expect(communicationPolicyInstructions(defaultCommunicationPolicy)).toContain("details that help this customer decide");
  expect(communicationPolicyInstructions({ ...defaultCommunicationPolicy, productDetails: "essentials" })).toContain("say only what the customer asked");
});
it("keeps the owner's handoff wording as text, the default when it is empty, and never as an authority", () => {
  expect(parseCommunicationPolicy({ ...defaultCommunicationPolicy, handoffMessage: "  Ju shkruan Ana brenda 30 minutave.  " }).handoffMessage).toBe("Ju shkruan Ana brenda 30 minutave.");
  expect(parseCommunicationPolicy({ ...defaultCommunicationPolicy, handoffMessage: "   " })).not.toHaveProperty("handoffMessage");
  expect(parseCommunicationPolicy(defaultCommunicationPolicy)).not.toHaveProperty("handoffMessage");
  expect(() => parseCommunicationPolicy({ ...defaultCommunicationPolicy, handoffMessage: "x".repeat(301) })).toThrow();
  expect(() => parseCommunicationPolicy({ ...defaultCommunicationPolicy, handoffMessage: 5 })).toThrow();
  const instructions = communicationPolicyInstructions({ ...defaultCommunicationPolicy, handoffMessage: "Ju shkruan Ana." });
  expect(instructions).toContain('"Ju shkruan Ana."');
  expect(instructions).toContain("never say it before the server reports a handoff");
  expect(communicationPolicyInstructions(defaultCommunicationPolicy)).not.toContain("handed to the business's staff");
});
