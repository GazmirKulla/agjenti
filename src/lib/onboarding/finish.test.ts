import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ agent: null as null | { id: string; instructions: string }, update: vi.fn() }));
vi.mock("@/lib/platform/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const name of ["select", "eq", "order", "limit"]) chain[name] = () => chain;
      chain.maybeSingle = async () => ({ data: table === "businesses" ? { name: "Zana" } : m.agent });
      chain.update = (row: unknown) => { m.update(row); const done = { eq: () => done, then: (ok: (v: unknown) => void) => ok({ error: null }) }; return done; };
      return chain;
    },
  }),
}));
import { refreshAgentInstructions } from "./finish";
import { basicInstructions, emptyAnswers, initialInstructions, parseAnswers } from "./model";

const before = parseAnswers({ ...emptyAnswers, name: "Zana", businessType: "retail", useCases: ["support"] });
const after = parseAnswers({ ...before, useCases: ["support", "orders"], details: { ...before.details!, handoffRules: "Ankesat m'i kalo mua." } });
beforeEach(() => { vi.clearAllMocks(); });

it("follows the answers while the instructions are the generated ones", async () => {
  m.agent = { id: "a1", instructions: basicInstructions("Zana") };
  expect(await refreshAgentInstructions("b1", before, after)).toBe("updated");
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ instructions: initialInstructions(after) }));
  expect(initialInstructions(after)).toContain("Ankesat m'i kalo mua.");
  m.agent = { id: "a1", instructions: initialInstructions(before) };
  expect(await refreshAgentInstructions("b1", before, after)).toBe("updated");
});

it("leaves instructions the owner wrote", async () => {
  m.agent = { id: "a1", instructions: "Udhëzimet e mia." };
  expect(await refreshAgentInstructions("b1", before, after)).toBe("kept");
  m.agent = null;
  expect(await refreshAgentInstructions("b1", before, after)).toBe("none");
  expect(m.update).not.toHaveBeenCalled();
});
