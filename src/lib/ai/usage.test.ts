import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("next/server", () => ({ after: () => { throw new Error("outside request"); } }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: mocks.rpc }) }));
import { attributeAiUsage, meteredFetch, meteredRoute, usageFrom, withAiUsage } from "./usage";
import { aiUsageSummary } from "./usage-report";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ error: null });
});

it("summarises billed tokens as prompt plus completion", () => {
  expect(aiUsageSummary({ calls: 7, inputTokens: 100, outputTokens: 20 })).toEqual({
    calls: 7,
    tokens: 120,
  });
});

it("reads usage from Responses, Chat Completions and Embeddings bodies", () => {
  expect(usageFrom({ model: "gpt-5", usage: { input_tokens: 12, output_tokens: 4 } })).toEqual({ model: "gpt-5", input: 12, output: 4 });
  expect(usageFrom({ model: "gpt-4o", usage: { prompt_tokens: 9, completion_tokens: 3 } })).toEqual({ model: "gpt-4o", input: 9, output: 3 });
  expect(usageFrom({ model: "text-embedding-3-small", usage: { prompt_tokens: 5, total_tokens: 5 } })).toEqual({ model: "text-embedding-3-small", input: 5, output: 0 });
  expect(usageFrom(null)).toEqual({ model: "unknown", input: 0, output: 0 });
});

it("records one call for the business of the enclosing scope and returns the body intact", async () => {
  const body = { model: "gpt-5", usage: { input_tokens: 10, output_tokens: 2 } };
  const fetch = meteredFetch(async () => json(body));
  const response = await withAiUsage("b1", () => fetch("https://api.openai.com/v1/responses"));
  expect(await response.json()).toEqual(body);
  await settle();
  expect(mocks.rpc).toHaveBeenCalledWith("record_ai_usage", { p_business: "b1", p_model: "gpt-5", p_input: 10, p_output: 2 });
});

it("attributes a route scope to the business named after authorization, across awaits", async () => {
  const fetch = meteredFetch(async () => json({ model: "gpt-5" }));
  const handler = meteredRoute(async () => {
    await settle();
    attributeAiUsage("b2");
    await settle();
    return fetch("https://api.openai.com/v1/responses");
  });
  await handler();
  await settle();
  expect(mocks.rpc).toHaveBeenCalledWith("record_ai_usage", expect.objectContaining({ p_business: "b2" }));
});

it("keeps concurrent businesses apart", async () => {
  const fetch = meteredFetch(async () => json({ model: "gpt-5" }));
  await Promise.all([
    withAiUsage("a", async () => { await settle(); return fetch("https://api.openai.com/v1/responses"); }),
    withAiUsage("b", () => fetch("https://api.openai.com/v1/responses")),
  ]);
  await settle();
  expect(mocks.rpc.mock.calls.map(([, args]) => args.p_business).sort()).toEqual(["a", "b"]);
});

it("does not record failed or unattributed requests", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await withAiUsage("b1", () => meteredFetch(async () => json({ error: "x" }, 429))("https://api.openai.com/v1/responses"));
  await meteredFetch(async () => json({ model: "gpt-5" }))("https://api.openai.com/v1/responses");
  await settle();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith("[ai.usage] request without business", "/v1/responses");
  warn.mockRestore();
});

it("never fails the caller when recording fails", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.rpc.mockRejectedValue(new Error("db down"));
  const response = await withAiUsage("b1", () => meteredFetch(async () => json({ model: "gpt-5" }))("https://api.openai.com/v1/responses"));
  expect(response.ok).toBe(true);
  await settle();
  expect(error).toHaveBeenCalled();
  error.mockRestore();
});
