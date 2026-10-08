import { describe, expect, it } from "vitest";
import { selectTrainingContext, trainingPrompt, validateTrainingInput, type TrainingMemory } from "./model";
const workflow = "11111111-1111-4111-8111-111111111111";
const memory = (id: string, values: Partial<TrainingMemory> = {}): TrainingMemory => ({ id, business_id: "business-a", kind: "style", instruction: "Përgjigju shkurt", customer_message: "", desired_response: "", workflow_id: null, step_key: null, is_active: true, revision: 1, updated_at: "2026-10-08T10:00:00Z", ...values });
describe("business training context", () => {
  it("keeps style across new sessions while isolating workflow and step rules", () => {
    const memories = [memory("style"), memory("size", { kind: "workflow", workflow_id: workflow, step_key: "collect_size" }), memory("photo", { kind: "workflow", workflow_id: workflow, step_key: "awaiting_photo" }), memory("other", { kind: "workflow", workflow_id: "other-workflow" }), memory("off", { is_active: false })];
    expect(selectTrainingContext(memories, workflow, "collect_size", "M").rules.map(r => r.id)).toEqual(["size", "style"]);
    expect(selectTrainingContext(memories, workflow, "awaiting_photo", "Foto").rules.map(r => r.id)).toEqual(["photo", "style"]);
    expect(selectTrainingContext(memories, null, null, "Hi").rules.map(r => r.id)).toEqual(["style"]);
  });
  it("retrieves relevant approved examples and excludes unrelated or disabled ones", () => {
    const memories = [memory("shipping", { kind: "example", customer_message: "Sa kushton transporti?", desired_response: "Kushton 100 lekë" }), memory("size", { kind: "example", customer_message: "Çfarë madhësie është kjo bluzë?", desired_response: "M" }), memory("off", { kind: "example", is_active: false, customer_message: "Sa kushton transporti?" })];
    const context = selectTrainingContext(memories, null, null, "Sa kushton transporti?");
    expect(context.rules.map(r => r.id)).toEqual(["shipping"]);
    expect(trainingPrompt(context)).toContain("Never copy example prices");
    expect(trainingPrompt(context)).toContain("Never skip required steps");
    expect(selectTrainingContext(memories, null, null, "").rules).toEqual([]);
  });
  it("prioritizes scoped rules and newer corrections with bounded context", () => {
    const memories = Array.from({ length: 200 }, (_, i) => memory(String(i), { updated_at: `2026-10-08T10:${String(i % 60).padStart(2, "0")}:00Z` }));
    memories.push(memory("scope", { kind: "workflow", workflow_id: workflow, step_key: "collect_size", updated_at: "2025-01-01" }));
    const result = selectTrainingContext(memories, workflow, "collect_size", "M");
    expect(result.rules).toHaveLength(16);
    expect(result.rules[0].id).toBe("scope");
    expect(result.rules[1].id).toBe("119");
    expect(trainingPrompt({ rules: [] })).toBe("");
  });
  it("requires explicit complete examples and valid scope and revisions", () => {
    expect(() => validateTrainingInput({ kind: "style", instruction: "Pa emoji" })).not.toThrow();
    expect(() => validateTrainingInput({ kind: "example", instruction: "Shkurt" })).toThrow();
    expect(() => validateTrainingInput({ kind: "workflow", instruction: "Shpjego hapin" })).toThrow();
    expect(() => validateTrainingInput({ kind: "style", instruction: "Pa emoji", workflowId: workflow })).toThrow();
    expect(() => validateTrainingInput({ kind: "example", instruction: "Shkurt", customerMessage: "Hi", desiredResponse: "Hi", stepKey: "step" })).toThrow();
    expect(() => validateTrainingInput({ kind: "style", instruction: "x".repeat(1501) })).toThrow();
    expect(() => validateTrainingInput({ kind: "style", instruction: "Hi", id: workflow, revision: 0 })).toThrow();
  });
});
