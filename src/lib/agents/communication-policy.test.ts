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
