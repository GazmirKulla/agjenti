import { vi } from "vitest";
import { reviewInformationalResponse } from "./response-review";
import { describe, expect, it } from "vitest";
import { validateResponse } from "./response-consistency";
import { projectCustomerContext } from "./customer-context";
import { readResult, type BusinessGrounding } from "./business-grounding";
import { migrateContext, setFact } from "@/lib/workflows/context";

function fixture(message = "Më jep informacion") {
  const state = migrateContext();
  setFact(state, "customer_name", "Synthetic", "text", "message_label");
  const products = [{ id: "p", name: "Libri", price_amount: 20, currency: "EUR" }];
  const services = [{ id: "s", name: "Konsulta", price_amount: 40, currency: "ALL", duration_minutes: 45, price_mode: "from" as const }];
  const grounding: BusinessGrounding = {
    products: readResult("products", "tenant-a", { data: products, count: 1 }),
    services: readResult("booking_services", "tenant-a", { data: services, count: 1 }),
    knowledge: readResult("knowledge_entries", "tenant-a", { data: [], count: 0 }),
    documents: readResult("catalog_sections", "tenant-a", { data: [], count: 0 }),
    inventory: "unsupported", availability: "unverified", bookingModuleEnabled: false,
  };
  return { state, products, services, grounding, message, customer: projectCustomerContext(state, message), informational: true };
}
describe("R3 bounded critical claims (synthetic outputs, not real model certification)", () => {
  it.each([
    "Porosia u krijua me sukses.", "Your order has been placed.", "Rezervimi u konfirmua për nesër.",
    "Your appointment is booked.", "Pagesa u pranua.", "Payment received.", "Klienti u regjistrua.",
    "Customer registered successfully.", "Stafi u njoftua.", "The team has been notified.",
    "Ju rezervova për nesër.", "Biseda u transferua te stafi.",
    "Biseda iu kalua stafit.", "Kam krijuar porosinë.", "Your discount was approved.", "Porosia dështoi.",
  ])("blocks receipt-free execution claims: %s", async text => {
    const e = fixture(); e.state.step_key = "order_ready";
    e.state.fields.booking = { phase: "done", bookingId: "untrusted-historical-id" };
    const before = structuredClone(e);
    const result = (await validateResponse(text, e));
    expect(result.status).toBe("unsupported_critical_claim");
    expect(result.reply).toContain("Nuk kam konfirmim"); expect(e).toEqual(before);
  });
  it.each(["Libri është në stok.", "Libri nuk është në stok.", "The book is out of stock.", "We have slots available tomorrow.", "Termine të lira në orën 09:00."])("does not infer availability: %s", async text => {
    expect((await validateResponse(text, fixture())).findings).toContainEqual({ status: "unsupported_critical_claim", code: "availability_unverified" });
  });
  it.each(["Përshëndetje! Si mund të të ndihmoj?", "Nuk kam konfirmim që rezervimi u konfirmua.",
    "Your appointment is not confirmed.", "Kur porosia u krijua, çfarë ndodhi?", "A është pagesa kryer?", "Prania në katalog nuk garanton stok.",
    "Nëse porosia u krijua, kontakto biznesin.", "Mund të përgatisim kërkesën, pa krijuar një porosi."])("preserves ordinary questions, uncertainty and conditions: %s", async text => {
    expect((await validateResponse(text, fixture())).reply).toBe(text);
  });
  it("does not let a disclaimer launder a later affirmative claim", async () => {
    expect((await validateResponse("Nuk kam detaje, por rezervimi u konfirmua.", fixture())).reply).not.toContain("u konfirmua");
  });
  it.each(["Libri kushton 999 EUR.", "Libri është falas.", "Libri costs USD 999.", "Libri kushton 20 USD.", "Konsulta kushton 40 ALL.", "Konsulta zgjat 90 minuta."])("corrects only a uniquely identified structured mismatch: %s", async text => {
    const result = (await validateResponse(text, fixture())); expect(result.status).toBe("contradiction");
    expect(result.reply).toContain("[["); expect(result.reply).not.toBe(text);
  });
  it.each(["Libri kushton 20 EUR.", "Konsulta kushton nga 40 ALL.", "Konsulta zgjat 45 minuta.", "Sugjeroj [[product:p]]."])("preserves verified values/slots: %s", async text => {
    expect((await validateResponse(text, fixture())).reply).toBe(text);
  });
  it("unknown/inactive entities and unattributed prices are not numeric evidence", async () => {
    const e = fixture(); e.grounding.products.records = [];
    expect((await validateResponse("Libri kushton 20 EUR.", e)).status).toBe("unverifiable");
    expect((await validateResponse("Kushton 800 EUR.", fixture())).status).toBe("unverifiable");
  });
  it("does not bind a short entity name from a substring during correction", async () => {
    const e = fixture(); e.grounding.products.records = [{ id: "a", name: "A", price_amount: 20, currency: "EUR" }];
    const result = (await validateResponse("Karrigia kushton 500 EUR.", e));
    expect(result.status).toBe("unverifiable"); expect(result.reply).not.toContain("[[product:a]]");
  });
  it("returns complete verified facts instead of splicing a rejected sentence", async () => {
    expect((await validateResponse("Faleminderit për pyetjen. Libri kushton 999 EUR.", fixture())).reply).toBe("Për vlerat aktuale të katalogut: [[product:p]].");
  });
  it("policy requires actual scoped evidence, not customer/history/instructions", async () => {
    const e = fixture(); e.state.recentMessages = [{ role: "assistant", content: "Shipping is free." }];
    vi.mocked(reviewInformationalResponse).mockResolvedValueOnce({findings:[{status:"unverifiable",code:"policy_evidence_absent",quote:"Shipping is free.",subject:null}]}).mockResolvedValueOnce({findings:[]});
    expect((await validateResponse("Shipping is free.", e)).status).toBe("unverifiable");
    e.grounding.knowledge.records = [{ id: "own-policy", title: "Shipping", body: "Shipping is free." }];
    expect((await validateResponse("Shipping is free.", e)).status).toBe("valid");
    e.grounding.knowledge.records.push({ id: "conflicting-policy", title: "Shipping", body: "Shipping costs 5 EUR." });
    expect((await validateResponse("Shipping is free.", e)).status).toBe("unverifiable");
    expect((await validateResponse("Refunds are always approved.", e)).status).toBe("unverifiable");
    expect((await validateResponse("Nuk kemi rimbursim.", e)).status).toBe("unverifiable");
  });
  it("partial and failed reads are not complete or empty", async () => {
    const e = fixture(); e.grounding.products.status = "partial"; e.grounding.products.total = 1001;
    expect((await validateResponse("Kemi 12 produkte.", e)).reply).toContain("1001");
    expect((await validateResponse("Këto janë të gjitha produktet.", e)).status).toBe("unverifiable");
    e.grounding.products = readResult("products", "tenant-a", { data: null, error: {} });
    expect((await validateResponse("Nuk kemi produkte.", e)).status).toBe("unverifiable");
  });
  it("preserves a verified policy fee without misclassifying it as a product price", async () => {
    const e = fixture(); e.grounding.knowledge.records = [{ id: "policy", title: "Shipping", body: "Shipping costs 5 EUR." }];
    expect((await validateResponse("Shipping costs 5 EUR.", e)).status).toBe("valid");
  });
  it("uses corrected customer name with provenance, never old history or another projection", async () => {
    const e = fixture("Si quhem?"); setFact(e.state, "customer_name", "Corrected", "text", "correction");
    e.customer = projectCustomerContext(e.state, e.message);
    expect((await validateResponse("Quhesh Old.", e)).reply).toBe("Ti ke deklaruar emrin: Corrected.");
    e.customer = { profile: {}, declared: {} };
    expect((await validateResponse("Nuk e di emrin.", e)).reply).toBe("Nuk e di emrin.");
  });
  it("does not repeat a known profile question or disclose the value unnecessarily", async () => {
    const e = fixture();
    vi.mocked(reviewInformationalResponse).mockResolvedValueOnce({findings:[{status:"correctable",code:"known_profile_reasked",quote:"Si quhesh?",subject:"name"}]});
    const result = (await validateResponse("Si quhesh?", e));
    expect(result.status).toBe("correctable"); expect(result.reply).not.toContain("Synthetic");
    e.informational = false;
    expect((await validateResponse("Si quhesh?", e)).reply).toBe("Si quhesh?");
  });
  it("explicit own-phone recall uses the corrected scoped value, never a business contact", async () => {
    const e = fixture("Cili është telefoni im?");
    setFact(e.state, "customer_phone", "0690000001", "phone", "correction");
    e.customer = projectCustomerContext(e.state, e.message);
    expect((await validateResponse("Nuk ma ke treguar telefonin.", e)).reply).toBe("Ti ke deklaruar telefonin: 0690000001.");
  });
  it("does not conflate a business contact question with the customer's profile", async () => {
    const e = fixture(); e.customer.suppliedProfileKeys = ["name", "phone"];
    expect((await validateResponse("Cili është telefoni i biznesit?", e)).status).toBe("valid");
  });
  it("keeps legitimate correction/invalid-field prompts", async () => {
    const e = fixture(); e.state.context!.execution.invalidFields = ["customer_name"];
    expect((await validateResponse("Si quhesh?", e)).reply).toBe("Si quhesh?");
  });
  it("does not hide an upstream pending clarification or use promptCounts as proof it was answered", async () => {
    const e = fixture(); e.state.context!.execution.promptCounts = { customer_name: 20 };
    e.state.processes = { active: null, pendingChoice: { kind: "process", message: "ambiguous" } };
    expect((await validateResponse("Si quhesh?", e)).reply).toBe("Si quhesh?");
  });
  it("keeps unknown questions and does not reuse another customer's projection", async () => {
    const e = fixture(); e.customer = { profile: {}, declared: {}, suppliedProfileKeys: [] };
    expect((await validateResponse("Si quhesh?", e)).status).toBe("valid");
    expect((await validateResponse("Cila është adresa?", e)).status).toBe("valid");
  });
  it("resolved selection suppresses only free information re-asking, not a workflow prompt", async () => {
    const e = fixture(); e.customer.process = { kind: "service", id: "proc", versionId: "A", status: "active", fields: {}, entity: { kind: "service", id: "s" }, authority: "collected_preferences_only" };
    vi.mocked(reviewInformationalResponse).mockResolvedValueOnce({findings:[{status:"correctable",code:"resolved_entity_reasked",quote:"Cilin shërbim dëshiron?",subject:"s"}]});
    expect((await validateResponse("Cilin shërbim dëshiron?", e)).findings[0]?.code).toBe("resolved_entity_reasked");
    e.informational = false;
    expect((await validateResponse("Cilin shërbim dëshiron?", e)).status).toBe("valid");
  });
  it("repeated apology gets a bounded limitation without claiming progress or handoff", async () => {
    const e = fixture(); e.state.recentMessages = [{ role: "assistant", content: "Më fal." }, { role: "assistant", content: "Më fal." }];
    expect((await validateResponse("Më fal.", e)).findings[0].code).toBe("repeated_apology");
  });
  it("is deterministic under replay and does not treat prepared state as execution evidence", async () => {
    const e = fixture(); const before = structuredClone(e);
    expect((await validateResponse("Porosia u krijua.", e))).toEqual((await validateResponse("Porosia u krijua.", e)));
    expect(e).toEqual(before);
  });
  it("reports bounded scope honestly: arbitrary semantic promises are not universally recognized", async () => {
    expect((await validateResponse("Everything has magically worked out for you.", fixture())).status).toBe("valid");
    expect((await validateResponse("x".repeat(20001), fixture())).status).toBe("uncertain");
  });
});

it.each([false, true])("preserves account explanations with empty or unrelated process facts: %s", async withFacts => {
  const e = fixture("A përgjigjeni nga Instagrami im?");
  e.state = migrateContext();
  if (withFacts) setFact(e.state, "size", "XL", "text", "message_label");
  e.customer = projectCustomerContext(e.state, e.message);
  const reply = "Përgjigjet dërgohen nga profili yt në Instagram pasi e lidh nga paneli dhe aktivizon përgjigjet automatike.";
  expect((await validateResponse(reply, e)).reply).toBe(reply);
  expect((await validateResponse(reply, e)).changed).toBe(false);
});
