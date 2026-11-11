import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
import { promptCatalog, PROMPT_AREAS } from "./catalog";
import { CUSTOMER_REPLY_PROMPT } from "@/lib/orchestration/respond";
import { OWNER_ASSISTANT_PROMPT } from "@/lib/business-assistant/service";
import { SOURCE_EXTRACTION_PROMPT, ONBOARDING_EXTRACTION_PROMPT } from "@/lib/business-intelligence/normalization";
import { SEMANTIC_SELECTION_PROMPT } from "@/lib/conversations/understanding/selection";
import { CATALOG_REQUIREMENTS_PROMPT } from "@/lib/catalogs/retrieval";

it("lists every prompt once, in a known area, with the text the code sends", () => {
  const prompts = promptCatalog();
  expect(new Set(prompts.map((p) => p.id)).size).toBe(prompts.length);
  for (const prompt of prompts) expect(PROMPT_AREAS[prompt.area], prompt.id).toBeDefined();
  expect(prompts.find((p) => p.id === "agjenti-i-klienteve/pergjigja-ndaj-klientit")!.text).toBe(CUSTOMER_REPLY_PROMPT());
  expect(prompts.find((p) => p.id === "asistenti/prompti-kryesor")!.dynamic).toEqual(expect.arrayContaining(["modulet", "workflow"]));
});

it("fills every part of the prompts built per request", () => {
  for (const text of [
    OWNER_ASSISTANT_PROMPT(["products"], true), SOURCE_EXTRACTION_PROMPT("product"), ONBOARDING_EXTRACTION_PROMPT({}),
    SEMANTIC_SELECTION_PROMPT("identity"), SEMANTIC_SELECTION_PROMPT("relevance"), CATALOG_REQUIREMENTS_PROMPT(["sq"]),
  ]) expect(text).not.toMatch(/\{\{[a-z_]+\}\}/);
  expect(OWNER_ASSISTANT_PROMPT(["products"], true)).toContain("Enabled modules: products. External catalog: true.");
});
