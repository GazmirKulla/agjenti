import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ stored: [] as unknown[], written: null as unknown }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: async () => ({ id: "user" }), isPlatformAdmin: async () => false,
  requireBusinessAccess: async () => ({ business: { id: "business", slug: "shop" } }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => {
  const q: Record<string, unknown> = {}; Object.assign(q, { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { product_fields: m.stored }, error: null }) }); return q;
} }) }));
vi.mock("./fields-store", async () => { const { parseBusinessFields } = await import("./fields");
  return { storeProductFields: async (_b: string, _u: string, raw: unknown) => { m.written = raw; return parseBusinessFields(raw); } }; });
import { saveCustomerQuestions, saveProductFields } from "./actions";

const color = { key: "ngjyra", label: "Ngjyra", type: "text" }, size = { key: "masa", label: "Masa", type: "select", variant: true, options: ["S", "M"] };
const text = { key: "teksti", label: "Teksti në bluzë", type: "text", ask: true };
beforeEach(() => { m.stored = [color, size, text]; m.written = null; });

describe("Struktura and the agent's questions are saved from two pages without losing each other", () => {
  it("keeps the stored questions when Struktura saves its fields, even if it sends a question", async () => {
    await saveProductFields("shop", JSON.stringify([{ ...color, label: "Ngjyra e drurit" }, size, { label: "E shtuar", type: "text", ask: true }]));
    expect((m.written as { label: string }[]).map(f => f.label)).toEqual(["Ngjyra e drurit", "Masa", "Teksti në bluzë"]);
  });
  it("keeps the stored product fields when the questions are saved, and makes every row a question", async () => {
    const result = await saveCustomerQuestions("shop", JSON.stringify([{ key: "teksti", label: "Teksti", type: "text" }, { label: "Dizajni", type: "photo", variant: true }]));
    expect((m.written as { key?: string }[]).slice(0, 2)).toEqual([expect.objectContaining({ key: "ngjyra" }), expect.objectContaining({ key: "masa", variant: true })]);
    expect("questions" in result ? result.questions?.map(q => [q.label, q.type, q.ask, q.variant ?? false]) : null).toEqual([["Teksti", "text", true, false], ["Dizajni", "photo", true, false]]);
  });
});
