import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: vi.fn() }));
vi.mock("@/lib/ai/openai", () => ({ default: vi.fn() }));
vi.mock("@/lib/ai/prompts/files", () => ({ prompt: () => "" }));
import { value } from "@/lib/business-intelligence/model";
import { itemsToEntities, oneEntryPerTitle, parseItems } from "./reorganize";

it("reads the model's list, keeping at most 12 well-formed entries", () => {
  const entries = Array.from({ length: 15 }, (_, i) => ({ title: `T${i}`, body: "b", source: i ? "website" : "tjetër" }));
  const items = parseItems({ entries: [{ title: 1 }, ...entries] });
  expect(items).toHaveLength(12);
  expect(items[0].source).toBe("both");
  expect(parseItems(null)).toEqual([]);
});

it("turns the list into knowledge the scan routing accepts", () => {
  const [entity, ...rest] = itemsToEntities([
    { title: " Dërgesa ", body: " 1-4 ditë pune ", source: "instagram" },
    { title: "x", body: "shumë i shkurtër titulli", source: "website" },
  ]);
  expect(rest).toEqual([]);
  expect(entity.target).toBe("knowledge");
  expect(value(entity, "title")).toBe("Dërgesa");
  expect(value(entity, "body")).toBe("1-4 ditë pune");
  for (const fact of entity.facts) expect(fact).toMatchObject({ source: "instagram", evidence: "1-4 ditë pune", evidenceKind: "text", confirmedByUser: false });
  expect(itemsToEntities([{ title: "Pagesa", body: "Kartë", source: "both" }])[0].facts[0].source).toBe("website");
});

it("merges entries with the same title so none is left outside the proposal", () => {
  const entities = itemsToEntities([
    { title: "Bluza", body: "Pambuk 100%.", source: "instagram" },
    { title: "bluza ", body: "Printim që i reziston larjes.", source: "instagram" },
    { title: "Bluza", body: "Pambuk 100%.", source: "instagram" },
    { title: "Pagesa", body: "Kartë ose PayPal.", source: "website" },
  ]);
  const merged = oneEntryPerTitle(entities);
  expect(merged.map((entity) => value(entity, "title"))).toEqual(["Bluza", "Pagesa"]);
  expect(value(merged[0], "body")).toBe("Pambuk 100%.\n\nPrintim që i reziston larjes.");
  expect(value(entities[0], "body")).toBe("Pambuk 100%.");
});
