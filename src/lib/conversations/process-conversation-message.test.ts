import { beforeEach, expect, it, vi } from "vitest";
import { processConversationMessage } from "./process-conversation-message";
import { isIsolatedExecution } from "@/lib/runtime/execution-context";
const { coordinate } = vi.hoisted(() => ({ coordinate: vi.fn() }));
vi.mock("@/lib/orchestration/conversation", () => ({ processConversation: coordinate }));
beforeEach(() => { coordinate.mockReset(); coordinate.mockImplementation(async params => ({ params, isolated: isIsolatedExecution() })); });
const base = { businessId: "business", message: "A customer request", hasPhoto: false };
it.each(["instagram", "whatsapp", "panel"] as const)("keeps %s on the same live coordinator with the server transport identity", async source => {
  const processTransport = { jobId: 1, leaseToken: "lease", conversationId: "conversation", revision: 3 };
  await processConversationMessage({ ...base, source, mode: "production", processTransport });
  expect(coordinate).toHaveBeenCalledExactlyOnceWith({ ...base, source, mode: "production", processTransport });
  await expect(coordinate.mock.results[0].value).resolves.toMatchObject({ isolated: false });
});
it.each([
  { mode: "test" as const }, { source: "admin_chat_lab" as const, mode: "production" as const },
])("forces isolated execution for test entry %j", async entry => {
  await processConversationMessage({ ...base, ...entry });
  expect(coordinate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: "test" }));
  await expect(coordinate.mock.results[0].value).resolves.toMatchObject({ isolated: true });
  expect(isIsolatedExecution()).toBe(false);
});
it("rejects configuration from another business before interpreting or dispatching", async () => {
  await expect(processConversationMessage({ ...base, mode: "test", configurationPreview: { businessId: "foreign" } as never })).rejects.toThrow("invalid_configuration_preview");
  expect(coordinate).not.toHaveBeenCalled();
});
it("rejects configuration previews on live channels", async () => {
  await expect(processConversationMessage({ ...base, mode: "production", configurationPreview: { businessId: "business" } as never })).rejects.toThrow("invalid_configuration_preview");
  expect(coordinate).not.toHaveBeenCalled();
});
it("propagates coordinator failure instead of falling through to another engine", async () => {
  coordinate.mockRejectedValue(new Error("interpretation unavailable"));
  await expect(processConversationMessage({ ...base, mode: "test" })).rejects.toThrow("interpretation unavailable");
  expect(coordinate).toHaveBeenCalledOnce();
});
