import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/ai/openai", () => ({ default: class { responses = { create: m.create }; } }));
vi.mock("@/lib/tracking/system-events", () => ({ recordSystem: m.record }));
import { semanticConversationTitle } from "./semantic-title";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("OPENAI_API_KEY", "synthetic"); });
it.each([
  ["Mos e bëj falas; transporti është 300 lekë", "Transporti me pagesë"],
  ["Don't cancel it; change the delivery date", "Changing the delivery date"],
  ["¿Y si lo recogemos nosotros?", "Recogida del pedido"],
])("uses structured contextual titles, not the first message: %s", async (content, title) => {
  const messages = [{ role: "user", content: "Përshëndetje" }, { role: "assistant", content: "Si mund të ndihmoj?" }, { role: "user", content }];
  m.create.mockResolvedValue({ output_text: JSON.stringify({ title, message: 2, quote: content }) });
  expect(await semanticConversationTitle("business", messages)).toBe(title);
  expect(JSON.parse(m.create.mock.calls[0][0].input)).toEqual(messages);
  expect(m.record).not.toHaveBeenCalled(); // success is recorded by the writer only after storage
});
it.each([
  { title: "Invented topic", message: 0, quote: "not in conversation" },
  { title: "x".repeat(81), message: 0, quote: "Delivery" },
  { title: "Topic", message: 1, quote: "Suggestion" },
])("rejects invalid or assistant-only evidence", async value => {
  m.create.mockResolvedValue({ output_text: JSON.stringify(value) });
  expect(await semanticConversationTitle("business", [{ role: "user", content: "Delivery" }, { role: "assistant", content: "Suggestion" }])).toBeNull();
  expect(m.record).toHaveBeenCalledWith("assistant.conversation_title", "failed", expect.anything());
});
it("preserves the conversation when the model fails or no topic exists", async () => {
  m.create.mockRejectedValueOnce(Error("timeout"));
  expect(await semanticConversationTitle("business", [{ role: "user", content: "raw text" }])).toBeNull();
  m.create.mockResolvedValueOnce({ output_text: JSON.stringify({ title: null, message: 0, quote: "" }) });
  expect(await semanticConversationTitle("business", [{ role: "user", content: "hello" }])).toBeNull();
  expect(m.record).toHaveBeenLastCalledWith("assistant.conversation_title", "deferred", expect.anything());
});
