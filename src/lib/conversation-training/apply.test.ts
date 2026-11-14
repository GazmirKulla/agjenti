import { beforeEach, describe, expect, it, vi } from "vitest";

const ops: { key: string; input: Record<string, unknown>; requestId: string }[] = [];
const tables: Record<string, Record<string, unknown> | null> = {};
const updates: { table: string; patch: Record<string, unknown> }[] = [];

vi.mock("@/lib/actions/operations/service", () => ({
  prepareOperation: vi.fn(async (_b: string, _u: string, key: string, input: Record<string, unknown>) => ({ version: 1, key, input, snapshot: {}, requestId: "random", preview: {} })),
  executeOperation: vi.fn(async (_b: string, _u: string, prepared: { key: string; input: Record<string, unknown>; requestId: string }) => {
    ops.push({ key: prepared.key, input: prepared.input, requestId: prepared.requestId });
    return { message: prepared.key === "agent.communication" && prepared.input.mode === "publish" ? "Versioni 3 u publikua." : "ok", path: "x", id: prepared.key === "knowledge.save" && !prepared.input.id ? prepared.requestId : undefined };
  }),
}));
vi.mock("@/lib/actions/operations/access", () => ({ operationActor: vi.fn(async () => ({ business: { catalog_source: "internal" } })) }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      for (const name of ["select", "eq", "order", "limit", "is", "in"]) chain[name] = () => chain;
      chain.update = (value: Record<string, unknown>) => { patch = value; return chain; };
      chain.maybeSingle = async () => {
        if (patch) { updates.push({ table, patch }); return { data: { id: "p1" }, error: null }; }
        return { data: tables[table] ?? null, error: null };
      };
      return chain;
    },
  }),
}));

import { applySuggestion, operationId, withStyleBlock, STYLE_START, STYLE_END, type ApplyRow } from "./apply";
import { approvable, bulkSafe, parseEdit, type ReviewRow } from "./review";

const B = "2af8cfe5-5f63-47a1-baf3-959cfea49b79", U = "b8ddd7db-e48c-4db8-820e-3c9f704070e8";
const row = (over: Partial<ApplyRow>): ApplyRow => ({ id: "11111111-1111-4111-8111-111111111111", destination: "knowledge", operation: "create", target_table: null, target_id: null, title: "T", proposed: {}, edited: null, ...over });

beforeEach(() => { ops.length = 0; updates.length = 0; for (const key of Object.keys(tables)) delete tables[key]; });

describe("the learned style", () => {
  it("lives in its own block: the owner's text stays, a new analysis replaces only the block", () => {
    const first = withStyleBlock("Je asistenti i Watchmaster.\nMos premto zbritje.", "- Përgjigju shkurt.");
    expect(first).toBe(`Je asistenti i Watchmaster.\nMos premto zbritje.\n\n${STYLE_START}\n- Përgjigju shkurt.\n${STYLE_END}`);
    const second = withStyleBlock(`${first}\nRregull i shtuar më vonë.`, "- Mos përdor emoji.");
    expect(second).toContain("Mos premto zbritje.");
    expect(second).toContain("Rregull i shtuar më vonë.");
    expect(second).toContain("- Mos përdor emoji.");
    expect(second).not.toContain("Përgjigju shkurt");
  });

  it("is saved as a draft and published through agent.communication, keeping the language setting", async () => {
    tables.ai_agents = { id: "a1", instructions: "Je asistenti i Watchmaster.", communication: { version: 1, language: "sq", tone: "warm", length: "balanced", questions: "when_needed", emoji: "light" }, configuration_draft: null };
    const result = await applySuggestion(B, U, row({ destination: "style", proposed: { instructions: "- Përgjigju shkurt.", policy: { tone: "neutral", length: "concise", emoji: "none", questions: "when_needed" } } }));
    expect(ops.map((o) => [o.key, o.input.mode])).toEqual([["agent.communication", "draft"], ["agent.communication", "publish"]]);
    expect(ops[0].input.communication).toEqual({ version: 1, language: "sq", tone: "neutral", length: "concise", questions: "when_needed", emoji: "none" });
    expect(String(ops[0].input.instructions)).toMatch(/^Je asistenti i Watchmaster\.\n\n## Stili/);
    expect(result.message).toContain("Versioni 3 u publikua.");
  });

  it("is refused while the owner has an unpublished draft", async () => {
    tables.ai_agents = { id: "a1", instructions: "x", communication: null, configuration_draft: { instructions: "y" } };
    await expect(applySuggestion(B, U, row({ destination: "style", proposed: { instructions: "- a" } }))).rejects.toThrow(/draft/);
    expect(ops).toHaveLength(0);
  });
});

describe("destinations", () => {
  it("knowledge, an answered gap and a profile fact become knowledge entries", async () => {
    await applySuggestion(B, U, row({ proposed: { title: "Pse ndalon ora automatike?", body: "Ngarkohet kur mbahet në dorë." } }));
    await applySuggestion(B, U, row({ destination: "gap", proposed: { question: "A dërgoni në Durrës?" }, edited: { body: "Po, me korrier, 300 lekë." } }));
    const hours = await applySuggestion(B, U, row({ destination: "profile", operation: "conflict", target_table: "business_calendar_settings", proposed: { title: "Orari", body: "E shtunë 9–14." } }));
    expect(ops.map((o) => [o.key, o.input.title, o.input.body])).toEqual([
      ["knowledge.save", "Pse ndalon ora automatike?", "Ngarkohet kur mbahet në dorë."],
      ["knowledge.save", "A dërgoni në Durrës?", "Po, me korrier, 300 lekë."],
      ["knowledge.save", "Orari", "E shtunë 9–14."],
    ]);
    expect(hours.message).toMatch(/kalendarit nuk u ndryshua/);
  });

  it("updates an existing knowledge entry by its id", async () => {
    await applySuggestion(B, U, row({ operation: "update", target_table: "knowledge_entries", target_id: "k1", proposed: { title: "Garancia", body: "6 muaj" } }));
    expect(ops[0].input).toEqual({ id: "k1", title: "Garancia", body: "6 muaj" });
  });

  it("a new product is a draft through product.create, with its range written after", async () => {
    tables.products = { id: "p1", description: "", updated_at: "2025-01-01T00:00:00Z", archived_at: null };
    const result = await applySuggestion(B, U, row({ destination: "product", proposed: { name: "Rripa lëkure", description: "20 mm", price: { min: 1000, max: 2500, currency: "ALL", approximate: true } } }));
    expect(ops[0]).toMatchObject({ key: "product.create", input: { name: "Rripa lëkure", price_amount: 1000, currency: "ALL", is_active: false } });
    expect(updates.find((u) => u.table === "products")?.patch).toMatchObject({ price_amount: 1000, price_max: 2500, price_mode: "range" });
    expect(result.message).toMatch(/draft/);
  });

  it("an existing product gets only its price and an empty description, never other fields", async () => {
    tables.products = { id: "p1", description: "Lëkurë", updated_at: "2025-01-01T00:00:00Z", archived_at: null };
    await applySuggestion(B, U, row({ destination: "product", operation: "conflict", target_table: "products", target_id: "p1", proposed: { name: "Rrip", description: "tjetër", price: { min: 1200, max: null, currency: "ALL" } } }));
    expect(ops).toHaveLength(0);
    const patch = updates[0].patch;
    expect(Object.keys(patch).sort()).toEqual(["currency", "price_amount", "price_max", "price_mode", "updated_at"]);
    expect(patch).toMatchObject({ price_amount: 1200, price_mode: "fixed" });
  });

  it("the owner's corrected price wins over the one from conversations", async () => {
    tables.products = { id: "p1", description: "", updated_at: "2025-01-01T00:00:00Z", archived_at: null };
    await applySuggestion(B, U, row({ destination: "product", operation: "update", target_table: "products", target_id: "p1", proposed: { name: "Bateri", price: { min: 200, max: 500, currency: "ALL" } }, edited: { price: { min: 400, max: null, currency: "ALL" } } }));
    expect(updates[0].patch).toMatchObject({ price_amount: 400, price_max: null, price_mode: "fixed" });
  });

  it("a service range is saved as a starting price with the range in its description", async () => {
    await applySuggestion(B, U, row({ destination: "service", proposed: { name: "Servis Seiko", description: "Duhet parë ora.", price: { min: 3000, max: 6000, currency: "ALL", condition: "varet nga ora" } } }));
    expect(ops[0]).toMatchObject({ key: "service.save", input: { name: "Servis Seiko", price_amount: 3000, price_mode: "from", is_active: true } });
    expect(ops[0].input.description).toBe("Duhet parë ora.\nÇmimi: 3000–6000 lekë (varet nga ora).");
  });

  it("an example becomes a training example with the real messages", async () => {
    await applySuggestion(B, U, row({ destination: "example", proposed: { customer_message: "Faleminderit.", desired_response: "Faleminderit ju.", situation: "Falënderim" } }));
    expect(ops[0]).toMatchObject({ key: "training.save", input: { kind: "example", customerMessage: "Faleminderit.", desiredResponse: "Faleminderit ju." } });
  });

  it("uses an operation id derived from the suggestion, so a retry is the same operation", async () => {
    await applySuggestion(B, U, row({ proposed: { title: "A", body: "B" } }));
    await applySuggestion(B, U, row({ proposed: { title: "A", body: "B" } }));
    expect(ops[0].requestId).toBe(ops[1].requestId);
    expect(ops[0].requestId).toBe(operationId(row({}).id, "knowledge"));
    expect(ops[0].requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(operationId("other", "knowledge")).not.toBe(ops[0].requestId);
  });
});

describe("review rules", () => {
  const review = (over: Partial<ReviewRow>): ReviewRow => ({ id: "x", destination: "knowledge", operation: "create", status: "pending", risk: "safe", requires_confirmation: false, proposed: {}, ...over });

  it("accepts only the fields of each destination", () => {
    expect(parseEdit("product", { name: "Rrip", price: { min: 10, max: 20, currency: "ALL" } })).toEqual({ name: "Rrip", price: { min: 10, max: 20, currency: "ALL" } });
    expect(() => parseEdit("product", { instructions: "x" })).toThrow();
    expect(() => parseEdit("style", { price: { min: 1 } })).toThrow();
    expect(() => parseEdit("product", { price: { min: 20, max: 10 } })).toThrow();
    expect(parseEdit("knowledge", {})).toBeNull();
  });

  it("does not approve duplicates or an unanswered question", () => {
    expect(approvable(review({ operation: "duplicate" }), null)).toMatch(/ekziston/);
    expect(approvable(review({ destination: "gap" }), null)).toMatch(/përgjigjen/);
    expect(approvable(review({ destination: "gap" }), { body: "Po" })).toBeNull();
    expect(approvable(review({ status: "applied" }), null)).toMatch(/nuk mund/);
  });

  it("approves together only new, safe suggestions with nothing to confirm", () => {
    expect(bulkSafe(review({}))).toBe(true);
    expect(bulkSafe(review({ risk: "important" }))).toBe(false);
    expect(bulkSafe(review({ requires_confirmation: true }))).toBe(false);
    expect(bulkSafe(review({ operation: "update" }))).toBe(false);
    expect(bulkSafe(review({ destination: "gap" }))).toBe(false);
    expect(bulkSafe(review({ destination: "style", operation: "update" }))).toBe(true);
  });
});
