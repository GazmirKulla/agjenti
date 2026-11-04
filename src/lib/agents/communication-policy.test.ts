import { expect, it } from "vitest";
import { defaultCommunicationPolicy, parseCommunicationPolicy } from "./communication-policy";
it("keeps presentation preferences distinct from execution authority", () => {
  expect(parseCommunicationPolicy({ ...defaultCommunicationPolicy, language: "en" }).language).toBe("en");
  for (const patch of [{ skipConfirmation: true }, { version: 2 }, { questions: "always" }, { language: "" }])
    expect(() => parseCommunicationPolicy({ ...defaultCommunicationPolicy, ...patch })).toThrow();
});
