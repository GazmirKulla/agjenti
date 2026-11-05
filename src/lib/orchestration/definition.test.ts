import { describe, expect, it } from "vitest";
import { validateDefinition, validFieldValue } from "./definition";
import { type ProcessDefinition } from "./contracts";

const valid: ProcessDefinition = { id: "intake", versionId: "v1", businessId: "business", name: "Intake", purpose: "Collect inquiry", offerPolicy: "on_request", entry: "email",
  fields: [{ id: "email", subject: "request", type: "email", required: true, label: "Email" }],
  steps: [{ id: "email", kind: "collect", fieldId: "email", next: "done" }, { id: "done", kind: "end", label: "Collected" }],
};
describe("immutable definition boundary", () => {
  it.each([null, [], {}, { ...valid, fields: [null] }, { ...valid, fields: [{ ...valid.fields[0], id: "constructor" }] },
    { ...valid, steps: [{ id: "email", kind: "eval", script: "return true" }] }, { ...valid, steps: [{ ...valid.steps[0], next: "absent" }] },
    { ...valid, steps: [...valid.steps, { id: "unreachable", kind: "end", label: "Unused" }] }, { ...valid, overrideAuthorization: true },
  ])("rejects malformed, unsafe or unconnected definitions %#", value => {
    expect(() => validateDefinition(value)).toThrow();
  });
  it("returns a copy so later draft changes do not mutate the validated version", () => {
    const draft = structuredClone(valid);
    const published = validateDefinition(draft);
    draft.fields[0].subject = "other";
    expect(published.fields[0].subject).toBe("request");
  });
  it("validates typed values without interpreting conversational language", () => {
    const base = valid.fields[0];
    expect(validFieldValue(base, "not-an-email")).toBe(false);
    expect(validFieldValue({ ...base, type: "date" }, "2026-02-30")).toBe(false);
    expect(validFieldValue({ ...base, type: "boolean" }, "yes")).toBe(false);
    expect(validFieldValue({ ...base, type: "boolean" }, true)).toBe(true);
    expect(validFieldValue({ ...base, type: "number", min: 0 }, -1)).toBe(false);
  });
});
