import { expect, it } from "vitest";
import { containsAuthoredContent } from "./context-content";
it("requires review for narrative writes, including nested agent configuration", () => {
  for (const step of [
    { key: "knowledge.save", input: { body: "Hours with holiday exceptions" } },
    { key: "training.save", input: { instruction: "Explain why" } },
    { key: "agent.communication", input: { instructions: "Keep the exceptions" } },
    { key: "agent.manage", input: { instructions: "New instructions" } },
    { key: "agent.configure", input: { changes: [{ type: "training.save", instruction: "Context" }] } },
    { key: "agent.configure", input: { changes: [{ type: "agent.update", instructions: "" }] } },
  ]) expect(containsAuthoredContent(step)).toBe(true);
});
it("does not add content approval to unrelated settings or activation", () => {
  expect(containsAuthoredContent({ key: "business.autoreply", input: { enabled: true } })).toBe(false);
  expect(containsAuthoredContent({ key: "agent.configure", input: { changes: [{ type: "knowledge.active", id: "k", is_active: true }] } })).toBe(false);
});
