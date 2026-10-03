import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create: mocks.create };
  },
}));
vi.mock("@/lib/agents/generate", () => ({
  agentModel: () => "test-model",
}));
import { completeText } from "./complete";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("completeText", () => {
  it("returns trimmed text and strips wrapping quotes", async () => {
    mocks.create.mockResolvedValue({ output_text: "«Përshkrim i shkurtër»" });
    await expect(
      completeText({ instructions: "x", input: "y", maxChars: 80 }),
    ).resolves.toEqual({ ok: true, text: "Përshkrim i shkurtër" });
  });

  it("fails closed without an API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(
      completeText({ instructions: "x", input: "y" }),
    ).resolves.toMatchObject({ ok: false, reason: "missing_api_key" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
