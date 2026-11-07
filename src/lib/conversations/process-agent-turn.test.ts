import { beforeEach, expect, it, vi } from "vitest";
import { processAgentTurn } from "./process-agent-turn";
const { process } = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("./process-conversation-message", () => ({ processConversationMessage: process }));
beforeEach(() => { process.mockReset(); });
it("uses the shared coordinator for the public agent entry without changing its state or transport", async () => {
  const input = { businessId: "business", message: "Continue", hasPhoto: false, mode: "production" as const,
    processTransport: { conversationId: "conversation", jobId: 1, leaseToken: "lease", revision: 2 } };
  const result = { reply: "Reply", processCheckpoint: { expectedRevision: 2 } };
  process.mockResolvedValue(result);
  expect(await processAgentTurn(input)).toBe(result);
  expect(process).toHaveBeenCalledExactlyOnceWith(input);
});
it("cannot mask a failed shared turn with a legacy response", async () => {
  process.mockRejectedValue(new Error("scope mismatch"));
  await expect(processAgentTurn({ businessId: "business", message: "Continue", hasPhoto: false })).rejects.toThrow("scope mismatch");
  expect(process).toHaveBeenCalledOnce();
});
