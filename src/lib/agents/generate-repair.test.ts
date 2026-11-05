vi.unmock("@/lib/conversations/understanding/context");
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), review: vi.fn(), repair: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: mocks.create }; } }));
vi.mock("./response-review", async original => ({ ...await original<typeof import("./response-review")>(),
  reviewInformationalResponse: mocks.review, repairInformationalResponse: mocks.repair,
}));
import { generateAgentReply } from "./generate";
import { emptyState } from "@/lib/workflows/state";
const params = { instructions: "Be helpful", state: emptyState(), knowledge: "", catalogSummary: "", customerMessage: "Explain both the service and its price", previousResponseId: null };
const bad = "It costs 100. It is free. Your business was created.";
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key"); vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "rejected-provider-history", output_text: JSON.stringify({ answer: bad, question: null }) });
  mocks.review.mockResolvedValueOnce({ findings: [
    { status: "unverifiable", code: "policy_evidence_absent", quote: "It costs 100.", subject: null },
    { status: "unverifiable", code: "policy_evidence_absent", quote: "It is free.", subject: null },
    { status: "unsupported_critical_claim", code: "execution_receipt_absent", quote: "Your business was created.", subject: null },
  ] });
});
it("recomposes the whole answer and releases it only after an independent successful review", async () => {
  const repaired = "The service answers customer questions using your configured information. The team must confirm pricing.";
  mocks.repair.mockResolvedValue(repaired); mocks.review.mockResolvedValueOnce({ findings: [] });
  const result = await generateAgentReply(params);
  expect(result.reply).toBe(repaired); expect(result.source).toBe("ai");
  expect(result.responseId).toBeNull();
  expect(mocks.review).toHaveBeenCalledTimes(2); expect(mocks.review.mock.calls[1][0]).toBe(repaired);
  expect(mocks.repair).toHaveBeenCalledTimes(1);
  expect(mocks.repair.mock.calls[0][2].match(/Nuk kam të dhëna/g)).toHaveLength(1);
});
it("never exposes a second unsupported draft, even if the rewrite claims success", async () => {
  mocks.repair.mockResolvedValue("Payment received.");
  mocks.review.mockResolvedValueOnce({ findings: [{ status: "unsupported_critical_claim", code: "execution_receipt_absent", quote: "Payment received.", subject: null }] });
  const result = await generateAgentReply(params);
  expect(result.reply).not.toContain("Payment received"); expect(result.reply).not.toContain("It costs");
  expect(result.source).toBe("fallback"); expect(mocks.repair).toHaveBeenCalledTimes(1);
});
it("retains a coherent safe message when the rewriter fails, without repeating sentence fragments", async () => {
  mocks.repair.mockRejectedValue(new Error("offline"));
  const before = structuredClone(params.state), result = await generateAgentReply(params);
  expect(result.reply).not.toContain("It is free"); expect(result.reply).not.toContain("Your business was created");
  expect(result.reply.match(/Nuk kam të dhëna/g)).toHaveLength(1); expect(params.state).toEqual(before);
});
