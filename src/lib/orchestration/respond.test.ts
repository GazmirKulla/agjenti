import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialSnapshot } from "./contracts";
import { composeProcessReply } from "./respond";
import type { Environment } from "./transition";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/ai/openai", () => ({ default: class { responses = { create }; } }));
beforeEach(() => { create.mockReset(); vi.stubEnv("OPENAI_API_KEY", "synthetic-test"); });
afterEach(() => vi.unstubAllEnvs());
const env: Environment = { mode: "test", now: 1, definitions: [], startableVersionIds: new Set(), tools: [], promptTtlMs: 1000 };
const input = () => ({ message: "How does it work?", history: [], state: initialSnapshot("business", "conversation", "test"), env,
  notices: [], context: { instructions: "", knowledge: [] }, deadline: Date.now() + 10000 });
function respond(prompts: unknown) { create.mockResolvedValue({ status: "completed", id: "response", output_text: JSON.stringify({ answer: "Verified information", prompts }) }); }
it("constrains an informational response to zero process targets in the model schema", async () => {
 respond({});
 expect(await composeProcessReply(input())).toMatchObject({ reply: "Verified information", targetIds: [] });
 const schema = create.mock.calls[0][0].text.format.schema.properties.prompts;
 expect(schema).toEqual({ type: "object", additionalProperties: false, required: [], properties: {} });
});
it.each([{ invented: "Confirm?" }, [], null])("rejects unauthorized target output %j even if a provider ignores the schema", async prompts => {
 respond(prompts);
 await expect(composeProcessReply(input())).rejects.toThrow("invalid_reply_targets");
});
it("binds prompt text to the exact server key and emits each target once", async () => {
 respond({ "offer-id": "Would you like to start?" });
 const state = input();
 const result = await composeProcessReply({ ...state, notices: [{ kind: "offer", targetId: "offer-id" }, { kind: "offer", targetId: "offer-id" }] });
 expect(result.targetIds).toEqual(["offer-id"]);
 expect(result.reply).toBe("Verified information\n\nWould you like to start?");
 expect(create.mock.calls[0][0].text.format.schema.properties.prompts).toMatchObject({ required: ["offer-id"], properties: { "offer-id": { type: "string" } } });
});
it("renders catalog slots from supplied ids and does not invent presentation from names", async () => {
  create.mockResolvedValue({ status: "completed", id: "response", output_text: JSON.stringify({ answer: "See [[product:p2]]", prompts: {} }) });
  const result = await composeProcessReply({ ...input(), context: { instructions: "", knowledge: [], products: { records: [{ id: "p2", name: "Second" }, { id: "p1", name: "First" }] } } });
  expect(result.reply).toContain("Second");
  expect(result.presented).toEqual({ kind: "product", items: [{ id: "p2", name: "Second" }] });
});
it.each([{}, { wrong: "Confirm?" }, { "offer-id": "" }, { "offer-id": 42 }])("rejects missing, replaced, blank or malformed target text %j", async prompts => {
 respond(prompts);
 await expect(composeProcessReply({ ...input(), notices: [{ kind: "offer", targetId: "offer-id" }] })).rejects.toThrow("invalid_reply_targets");
});
