import { describe, expect, it } from "vitest";
import { modelFor, roleOf } from "@/lib/agents/model";
import { MODEL_PATTERN, requestModel, rewriteRequestModel, tierModel, type ModelTier } from "./model-choice";

const group: ModelTier = { id: "high", label: "High", position: 2, customer_model: "gpt-5-mini", assistant_model: "gpt-5", utility_model: null };

describe("model groups", () => {
  const body = (model: string) => ({ method: "POST", body: JSON.stringify({ model, input: "hi" }) });
  it("names the kind of work with a placeholder the client replaces", () => {
    expect(roleOf(modelFor("assistant"))).toBe("assistant");
    expect(roleOf("gpt-5")).toBeNull();
    expect(roleOf("agjenti:other")).toBeNull();
    const next = rewriteRequestModel(body(modelFor("customer")), "gpt-5-mini");
    expect(JSON.parse(String(next?.body))).toEqual({ model: "gpt-5-mini", input: "hi" });
  });
  it("leaves explicit models and non-JSON bodies untouched", () => {
    const embedding = body("text-embedding-3-small");
    expect(rewriteRequestModel(embedding, "gpt-5")).toBe(embedding);
    const form = { method: "POST", body: new FormData() };
    expect(rewriteRequestModel(form, "gpt-5")).toBe(form);
    expect(requestModel(form)).toBeNull();
  });
  it("uses the group's model per kind of work, and the server default for an empty slot", () => {
    expect(tierModel(group, "customer")).toBe("gpt-5-mini");
    expect(tierModel(group, "assistant")).toBe("gpt-5");
    expect(tierModel(group, "utility")).toBe(process.env.AGENT_MODEL?.trim() || "gpt-5.6-luna");
  });
  it("accepts model ids and rejects anything else", () => {
    for (const ok of ["gpt-5", "gpt-4.1-mini", "ft:gpt-4o:org:custom:abc"]) expect(MODEL_PATTERN.test(ok)).toBe(true);
    for (const bad of ["", "x", "gpt 5", "gpt-5/../../", "<script>"]) expect(MODEL_PATTERN.test(bad)).toBe(false);
  });
});
