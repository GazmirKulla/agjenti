import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialSnapshot } from "./contracts";
import { interpretCustomer } from "./interpret";
import { type Environment } from "./transition";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create }; } }));
beforeEach(() => { create.mockReset(); vi.stubEnv("OPENAI_API_KEY", "synthetic-key"); });
afterEach(() => { vi.unstubAllEnvs(); });
const env: Environment = { mode: "test", now: 1000, definitions: [], startableVersionIds: new Set(), tools: [], promptTtlMs: 60000 };
function input() { return { state: initialSnapshot("business", "conversation", "test"), message: "Please continue", env, history: [], deadline: Date.now() + 5000 }; }
describe("model failure boundary", () => {
  it("returns a controlled provider error without a phrase-based approval fallback", async () => {
    create.mockRejectedValue(new Error("provider unavailable"));
    const request = input();
    const before = structuredClone(request.state);
    await expect(interpretCustomer(request)).rejects.toMatchObject({ reason: "provider" });
    expect(request.state).toEqual(before);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: "incomplete", output_text: '{"revision":0,"commands":[],"needsClarification":false}' },
    { status: "completed", output_text: "" },
  ])("does not accept incomplete/refused output %#", async response => {
    create.mockResolvedValue(response);
    await expect(interpretCustomer(input())).rejects.toMatchObject({ reason: "incomplete" });
  });
  it("rejects authority-bearing JSON even if the provider reports completion", async () => {
    create.mockResolvedValue({ status: "completed", output_text: '{"revision":0,"commands":[],"needsClarification":false,"authorized":true}' });
    await expect(interpretCustomer(input())).rejects.toMatchObject({ reason: "invalid_output" });
  });
  it("does not call a model after the turn budget is exhausted", async () => {
    await expect(interpretCustomer({ ...input(), deadline: Date.now() })).rejects.toMatchObject({ reason: "budget" });
    expect(create).not.toHaveBeenCalled();
  });
});
