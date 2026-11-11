import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: vi.fn() }));
vi.mock("@/lib/ai/openai", () => ({ default: vi.fn() }));
vi.mock("@/lib/ai/prompts/files", () => ({ prompt: () => "" }));
vi.mock("./continuation-service", () => ({ loadContinuation: vi.fn() }));
import { validSuggestions } from "./suggest";
import type { ContinuationItem } from "./continuation";

const item = (field: string, kind: ContinuationItem["kind"], options: string[] = []): ContinuationItem => ({
  field, title: field, hint: "", kind, core: false, status: "open", value: null, answer: "",
  options: options.map((value) => ({ value, label: value })),
});
const items = [item("businessType", "single", ["retail", "food"]), item("useCases", "multiple", ["orders", "support"]),
  item("hasVariants", "boolean", ["true", "false"]), item("customerProcess", "text"), item("offeringsSummary", "list")];

it("keeps only answers that fit their question", () => {
  expect(validSuggestions(items, { answers: [
    { field: "businessType", values: ["retail", "food"], text: "" },
    { field: "useCases", values: ["orders", "orders", "support", "spam"], text: "" },
    { field: "hasVariants", values: ["maybe"], text: "" },
    { field: "customerProcess", values: [], text: "  Porosia bëhet në DM.  " },
    { field: "offeringsSummary", values: [], text: "Puzzle druri\nBluza" },
    { field: "unknown", values: ["x"], text: "y" },
    { field: "businessType", values: ["food"], text: "" },
  ] })).toEqual({
    businessType: { values: ["retail"] },
    useCases: { values: ["orders", "support"] },
    customerProcess: { text: "Porosia bëhet në DM." },
    offeringsSummary: { text: "Puzzle druri\nBluza" },
  });
  expect(validSuggestions(items, null)).toEqual({});
});
