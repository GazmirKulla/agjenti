import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
vi.mock("./communication-configuration", () => ({ prepareCommunicationConfiguration: vi.fn(), saveCommunicationConfiguration: vi.fn() }));
import { cleanSplit } from "./instruction-facts";

const original = "Përgjigju shkurt. Çmimi i puzzle 32×22 është 1.800 Lek.";

it("keeps only usable facts and the instructions without them", () => {
  expect(cleanSplit({ instructions: "Përgjigju shkurt. Për çmimet përdor Njohuritë.", facts: [
    { title: "Çmimet", body: "Puzzle 32×22: 1.800 Lek" }, { title: "x", body: "" }, "bad",
  ], notes: ["Mesazhi i parë përmban çmimet.", 3] }, original)).toEqual({ instructions: "Përgjigju shkurt. Për çmimet përdor Njohuritë.", facts: [{ title: "Çmimet", body: "Puzzle 32×22: 1.800 Lek" }], notes: ["Mesazhi i parë përmban çmimet."] });
});

it("proposes nothing without facts or without remaining instructions", () => {
  expect(cleanSplit({ instructions: "Përgjigju shkurt dhe me mirësjellje.", facts: [] }, original)).toEqual({ instructions: original, facts: [], notes: [] });
  expect(cleanSplit({ instructions: "", facts: [{ title: "Çmimet", body: "1.800 Lek" }] }, original)).toEqual({ instructions: original, facts: [], notes: [] });
  expect(cleanSplit(null, original).facts).toEqual([]);
});
