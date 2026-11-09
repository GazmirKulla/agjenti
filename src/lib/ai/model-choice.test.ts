import { describe, expect, it } from "vitest";
import { MODEL_PATTERN, requestModel, rewriteRequestModel } from "./model-choice";

describe("administrator model choice", () => {
  const body = (model: string) => ({ method: "POST", body: JSON.stringify({ model, input: "hi" }) });
  it("swaps only requests that use the standard model", () => {
    const next = rewriteRequestModel(body("gpt-5.6-luna"), "gpt-5.6-luna", "gpt-5");
    expect(JSON.parse(String(next?.body))).toEqual({ model: "gpt-5", input: "hi" });
    const embedding = body("text-embedding-3-small");
    expect(rewriteRequestModel(embedding, "gpt-5.6-luna", "gpt-5")).toBe(embedding);
  });
  it("leaves non-JSON bodies such as audio uploads untouched", () => {
    const form = { method: "POST", body: new FormData() };
    expect(rewriteRequestModel(form, "gpt-5.6-luna", "gpt-5")).toBe(form);
    expect(requestModel(form)).toBeNull();
    expect(requestModel(body("gpt-5.6-luna"))).toBe("gpt-5.6-luna");
  });
  it("accepts model ids and rejects anything else", () => {
    for (const ok of ["gpt-5", "gpt-4.1-mini", "ft:gpt-4o:org:custom:abc"]) expect(MODEL_PATTERN.test(ok)).toBe(true);
    for (const bad of ["", "x", "gpt 5", "gpt-5/../../", "<script>"]) expect(MODEL_PATTERN.test(bad)).toBe(false);
  });
});
