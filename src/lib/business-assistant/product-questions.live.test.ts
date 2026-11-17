import { describe, expect, it, vi } from "vitest";

/** Behaviour of the real owner-assistant model on catalog questions, over a synthetic catalog.
 * Calls OpenAI, so it runs only on request:
 *   AGJENTI_LIVE_EVAL=1 OPENAI_API_KEY=… yarn vitest run src/lib/business-assistant/product-questions.live.test.ts
 * The database is a synthetic in-memory catalog; nothing is read from or written to a real business.
 * Questions in several languages are test data; the runtime holds no phrase lists. */
const live = process.env.AGJENTI_LIVE_EVAL === "1" && Boolean(process.env.OPENAI_API_KEY?.trim());

const m = vi.hoisted(() => ({ scans: 0 }));
vi.mock("@/lib/capabilities/assessment", () => ({ assessBusinessCapabilities: async () => [], summarizeCapabilityAssessments: () => [] }));
vi.mock("@/lib/actions/operations/service", () => ({ prepareOperation: vi.fn(), executeOperation: vi.fn() }));
vi.mock("@/lib/supabase/service", () => {
  const fields = [
    { key: "mosha_e_rekomanduar", label: "Mosha e rekomanduar", type: "text" },
    { key: "faqe", label: "Faqe", type: "text" },
    { key: "gjuha", label: "Gjuha", type: "text" },
    { key: "formati", label: "Formati", type: "text" },
    { key: "kategoria_edukative", label: "Kategoria edukative", type: "text" },
  ];
  const product = (i: number, name: string, price: number, age: string, pages: string, category: string) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`, name, sku: null, image_url: null, description: `Material edukativ ${i}.`, price_amount: price, price_mode: "fixed",
    price_max: null, price_unit: null, currency: "ALL", is_active: true, archived_at: null, availability: "available", item_kind: "product", product_type_id: null,
    workflow_id: null, created_at: "2026-11-16T10:00:00Z", updated_at: `2026-11-16T10:0${i}:00Z`,
    attributes: { mosha_e_rekomanduar: age, faqe: pages, gjuha: "Shqip", formati: "Digital PDF", kategoria_edukative: category },
  });
  const products = [
    product(1, "Paketa Parashkollore", 990, "3-5 vjec", "120", "Parashkollor"),
    product(2, "Shkruaj dhe Mesoj", 550, "5-7 vjec", "48", "Shkrim dhe lexim"),
    product(3, "Kafshe dhe Natyra", 490, "3-6 vjec", "36", "Natyre dhe shkence"),
    product(4, "Libri i Shkronjave", 850, "4-7 vjec", "80", "Alfabet dhe gjuhe"),
    product(5, "Paketa Kreative 5+", 1290, "5-8 vjec", "64", "Krijimtari"),
  ];
  const result = (table: string, calls: string[]) => {
    if (table === "products") {
      if (calls.includes("range")) { m.scans++; return { data: products, error: null }; }
      return { data: products, count: products.length, error: null };
    }
    if (table === "businesses") return { data: { id: "business", name: "Studio sintetik", item_kind: null, item_plural: null, item_singular: null, dashboard_profile: null, product_fields: fields }, error: null };
    if (table === "product_variants") return { data: [], error: null };
    return { data: calls.includes("maybeSingle") ? null : [], count: 0, error: null };
  };
  return { createServiceSupabase: () => ({ rpc: async () => ({ data: null, error: null }), from: (table: string) => {
    const calls: string[] = [];
    const chain: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result(table, calls)).then(resolve, reject) };
    for (const name of ["select", "eq", "neq", "in", "gte", "lte", "is", "ilike", "or", "order", "limit", "range", "returns", "maybeSingle", "single"])
      chain[name] = () => { calls.push(name); return chain; };
    return chain;
  } }) };
});

const access = { businessId: "business", userId: "owner", modules: ["products"], catalogSource: "internal" };
const context = { page: "products", entryPoint: "contextual" as const, searchQuery: "", filters: { status: "all" } };
async function ask(question: string) {
  process.env.TOKEN_ENCRYPTION_KEY ||= "synthetic-test-key";
  const { planRequest } = await import("./service");
  m.scans = 0;
  const result = await planRequest(access, question, [], context);
  if (process.env.AGJENTI_LIVE_EVAL_PRINT === "1") console.log(`Q: ${question}\nA: ${result.message}\n`);
  return { message: result.message, scanned: m.scans > 0 };
}
const says = (message: string, n: number) => new RegExp(`(^|[^\\d])${n}([^\\d]|$)`).test(message);

describe.skipIf(!live)("owner assistant answers catalog questions from server-run queries (live model)", () => {
  it("counts pages stored as text through the server query", async () => {
    const { message, scanned } = await ask("sa produkte kanë më shumë se 60 faqe?");
    expect(scanned).toBe(true);
    expect(says(message, 3)).toBe(true);
  }, 120_000);

  it("answers in another language with the same server facts", async () => {
    const { message, scanned } = await ask("How many products have fewer than 50 pages?");
    expect(scanned).toBe(true);
    expect(says(message, 2)).toBe(true);
  }, 120_000);

  it("compares prices through the server query", async () => {
    const { message, scanned } = await ask("Quanti prodotti costano più di 800 lek?");
    expect(scanned).toBe(true);
    expect(says(message, 3)).toBe(true);
  }, 120_000);

  it("finds products missing a value", async () => {
    const { message, scanned } = await ask("Cilat produkte nuk e kanë kodin SKU të plotësuar?");
    expect(scanned).toBe(true);
    expect(says(message, 5) || ["Paketa Parashkollore", "Shkruaj dhe Mesoj", "Kafshe dhe Natyra", "Libri i Shkronjave", "Paketa Kreative 5+"].every(n => message.includes(n))).toBe(true);
  }, 120_000);

  it("finds the most expensive product", async () => {
    const { message, scanned } = await ask("Kush produkt eshte me i shtrenjte?");
    expect(scanned).toBe(true);
    expect(message).toContain("Paketa Kreative 5+");
  }, 120_000);

  it("reproduces stored names and values exactly", async () => {
    const { message } = await ask("Më trego emrat e produkteve dhe moshën e rekomanduar për secilin.");
    for (const exact of ["Shkruaj dhe Mesoj", "Kafshe dhe Natyra", "3-5 vjec", "5-7 vjec"]) expect(message).toContain(exact);
  }, 120_000);
});
