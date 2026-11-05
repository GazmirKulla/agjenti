import { afterEach, expect, it, vi } from "vitest";
vi.unmock("./response-review");
const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = provider; } }));
import { reviewInformationalResponse, repairInformationalResponse } from "./response-review";
import { emptyState } from "@/lib/workflows/state";
afterEach(() => { vi.unstubAllEnvs(); provider.create.mockReset(); });
it("gives generation, review and repair the same corrected needs without exposing contact fields", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  const state = emptyState();
  state.customerDeclaredFacts = {
    business_type: { value: "dental clinic", type: "text", source: "customer_declaration", validated: true },
    stated_needs: { value: "hours and services", type: "text", source: "customer_declaration", validated: true },
    instagram_handle: { value: "private_contact", type: "text", source: "customer_declaration", validated: true },
  };
  const evidence = { state, message: "Remind me what I told you", customer: { profile: {}, declared: {} }, products: [], services: [], informational: true };
  provider.create.mockResolvedValueOnce({ status: "completed", output_text: '{"findings":[]}' })
    .mockResolvedValueOnce({ status: "completed", output_text: "You told me you run a dental clinic." });
  await reviewInformationalResponse("You run a dental clinic.", evidence);
  await repairInformationalResponse("rejected", evidence, "Use declared facts", "Be clear");
  for (const [request] of provider.create.mock.calls) {
    const input = JSON.parse(request.input);
    expect(input.customerNeeds.business_type.value).toBe("dental clinic");
    expect(input.customerNeeds.stated_needs.value).toBe("hours and services");
    expect(request.input).not.toContain("private_contact");
    expect(request.previous_response_id).toBeUndefined();
  }
});
