import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ settings: null as unknown, stored: [] as unknown[] }));
vi.mock("./store", () => ({
  readBusinessSettings: async () => m.settings,
  storeOwnFields: async (_b: string, _u: string, raw: unknown) => { m.stored.push(["fields", raw]); return { fields: [] }; },
  storeQuestions: async (_b: string, _u: string, raw: unknown) => { m.stored.push(["questions", raw]); return { fields: [] }; },
  storeItemSetup: async () => ({ success: "U ruajt." }), storeModules: async (_b: string, _u: string, ids: unknown) => { m.stored.push(["modules", ids]); return { success: "ok" }; },
}));
vi.mock("@/lib/products/stock-store", () => ({ storeStockSettings: async (_b: string, _u: string, raw: unknown) => { m.stored.push(["stock", raw]); return { settings: raw }; } }));
vi.mock("@/lib/products/linked-sync", () => ({ syncLinkedProducts: async () => ({}), describeSync: () => ({ success: "ok" }) }));
vi.mock("@/lib/integrations/zana", () => ({ probeLinkedCatalog: async () => ({ ok: true }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => { const q: Record<string, unknown> = {}; Object.assign(q, { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }); return q; } }) }));
import { executeSettingsOperation, prepareSettingsOperation } from "./operations";

const base = () => ({ item: { kind: "product", plural: null, singular: null },
  fields: [{ key: "ngjyra", label: "Ngjyra", type: "text" }], questions: [{ key: "teksti", label: "Teksti", type: "text", ask: true }],
  stock: { deduct: "confirmed", display: "availability", defaultMode: "off", lowThreshold: 3 },
  modules: { shown: ["orders"], hidden: ["campaigns"], available: ["orders", "campaigns"] } });
beforeEach(() => { m.settings = base(); m.stored = []; });

describe("the Assistant changes the business settings through the same writers as Cilësimet", () => {
  it("shows only the stock rules that change, in the owner's words, and refuses a change that changes nothing", async () => {
    const prepared = await prepareSettingsOperation("b", "stock.settings", { display: "exact" });
    expect(prepared.lines).toEqual([{ label: "Çfarë i thotë Agjenti klientit", before: "vetëm “e kemi / ka mbaruar”", after: "numri i saktë" }]);
    await expect(prepareSettingsOperation("b", "stock.settings", { display: "availability" })).rejects.toThrow("tashmë");
    await expect(prepareSettingsOperation("b", "stock.settings", { display: "everything" })).rejects.toThrow();
  });
  it("changes the product fields and keeps the questions, and the other way round", async () => {
    const fields = await prepareSettingsOperation("b", "structure.fields", { fields: [{ key: "ngjyra", label: "Ngjyra", type: "text" }, { label: "Masa", type: "select", variant: true, options: ["S", "M"] }] });
    expect(fields.lines[0].after).toBe("Ngjyra (tekst); Masa (zgjedh klienti: S, M)");
    const questions = await prepareSettingsOperation("b", "structure.questions", { questions: [{ label: "Dizajni", type: "photo" }] });
    expect(questions.lines[0]).toMatchObject({ before: "Teksti (tekst)", after: "Dizajni (foto)" });
  });
  it("refuses an unknown kind and a section the package does not allow", async () => {
    await expect(prepareSettingsOperation("b", "structure.kind", { kind: "spaceship" })).rejects.toThrow("Zgjidh");
    await expect(prepareSettingsOperation("b", "modules.configure", { show: ["payments"] })).rejects.toThrow("payments");
    const prepared = await prepareSettingsOperation("b", "modules.configure", { show: ["campaigns"], hide: ["orders"] });
    expect(prepared.shown).toEqual(["campaigns"]);
  });
  it("writes only when the settings are still what the owner reviewed", async () => {
    const prepared = await prepareSettingsOperation("b", "stock.settings", { display: "exact" });
    await executeSettingsOperation("b", "u", "stock.settings", { display: "exact" }, prepared.snapshot);
    expect(m.stored).toEqual([["stock", { deduct: "confirmed", display: "exact", defaultMode: "off", lowThreshold: 3 }]]);
    m.settings = { ...base(), stock: { ...base().stock, deduct: "manual" } };
    await expect(executeSettingsOperation("b", "u", "stock.settings", { display: "exact" }, prepared.snapshot)).rejects.toThrow("ndryshuan");
  });
  it("needs a connected website catalog for a refresh or a check", async () => {
    await expect(prepareSettingsOperation("b", "catalog.sync", {})).rejects.toThrow("Integrimet");
  });
});
