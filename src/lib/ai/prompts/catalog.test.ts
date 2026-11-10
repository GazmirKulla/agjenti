import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
import { promptCatalog, PROMPT_AREAS } from "./catalog";
import { CUSTOMER_REPLY_PROMPT } from "@/lib/orchestration/respond";

it("lists every prompt once, in a known area, with its real text", () => {
  const prompts = promptCatalog();
  expect(prompts.length).toBeGreaterThanOrEqual(25);
  expect(new Set(prompts.map((p) => p.id)).size).toBe(prompts.length);
  for (const prompt of prompts) {
    expect(PROMPT_AREAS[prompt.area]).toBeDefined();
    expect(prompt.text.length).toBeGreaterThan(100);
    expect(prompt.use.length).toBeGreaterThan(10);
  }
  // The catalog shows the very constant the reply uses.
  expect(prompts.find((p) => p.id === "customer.reply")!.text).toContain(CUSTOMER_REPLY_PROMPT);
  expect(prompts.find((p) => p.id === "assistant.main")!.text).toContain("‹modulet aktive›");
});
