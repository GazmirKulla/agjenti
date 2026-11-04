import { expect, it } from "vitest";
import { validateResponse } from "./response-consistency";
import { projectCustomerContext } from "./customer-context";
import { readResult, type BusinessGrounding } from "./business-grounding";
import { migrateContext, setFact } from "@/lib/workflows/context";
import { extractCustomerDeclaredFacts } from "@/lib/workflows/customer-declared-facts";

function fixture(message = "Më jep informacion") {
  const state = migrateContext();
  setFact(state, "customer_name", "Drita", "text", "correction");
  extractCustomerDeclaredFacts(state, "Lloji i biznesit: Shitje këpucësh online");
  const products = [{ id: "one", name: "Këpuca", price_amount: 35, currency: "EUR" },
    { id: "two", name: "Çorapja", price_amount: 400, currency: "ALL" }];
  const services = [{ id: "three", name: "Rregullimi", price_amount: 12.5, currency: "EUR", price_mode: "from" as const }];
  const grounding: BusinessGrounding = {
    products: readResult("products", "r4-independent-retail", { data: products, count: 2 }),
    services: readResult("booking_services", "r4-independent-retail", { data: services, count: 1 }),
    knowledge: readResult("knowledge_entries", "r4-independent-retail", { data: [], count: 0 }),
    documents: readResult("catalog_sections", "r4-independent-retail", { data: [], count: 0 }),
    inventory: "unsupported", availability: "unverified", bookingModuleEnabled: false,
  };
  return { state, products, services, grounding, message, customer: projectCustomerContext(state, message), informational: true };
}

it.each([
  "Nuk e di adresën, megjithatë porosia u realizua.",
  "Nuk e di emrin, dhe porosia u krye me sukses.",
  "Nuk kam detaje; porosia u përfundua.",
  "Porosia jote u perfundua me sukses.",
  "Njoftimi iu dergua stafit.", "Mesazhi u dërgua ekipit.",
  "E rezervuam takimin për të premten pas 17:00.",
  "Ju rezervova takimin.", "Kemi konfirmuar rezervimin.",
  "I don't know your name, however your order was created.",
  "Porosia dështoi.", "Porosia u refuzua.",
  "Porosia është në pritje.", "Pagesa po procesohet.",
  "Tentuam të dërgonim kërkesën.",
])("R4: informational prose cannot borrow action authority: %s", async text => {
  const e = fixture(), before = structuredClone(e);
  expect((await validateResponse(text, e)).status).toBe("unsupported_critical_claim");
  expect((await validateResponse(text, e)).reply).toContain("Nuk kam konfirmim");
  expect(e).toEqual(before);
});

it.each([
  "Porosia nuk u krijua.", "Takimi nuk është rezervuar.",
  "Nuk kam konfirmim që njoftimi iu dërgua stafit.",
  "Nëse porosia u krye, kontrollo statusin.",
  "Kur takimi u rezervua, çfarë ndodhi?",
  "Mund të përgatisim kërkesën pa rezervuar takimin.",
  "Propozoj të mbledhim preferencat.", "Po presim konfirmimin e sistemit.",
  "Kërkesa është për të premten pas 17:00, jo një rezervim i kryer.",
  "Mund të tentojmë të përgatisim kërkesën; rezultati nuk është verifikuar.",
  "A u njoftua stafi?", "Çfarë produkti dëshiron?",
])("R4: preserves non-execution speech: %s", async text => {
  expect((await validateResponse(text, fixture())).reply).toBe(text);
});

it.each(["other-tenant", "same-tenant-old-request", "same-request-unverified"])("ignores historical/injected receipt %s", async kind => {
  const e = fixture();
  e.state.fields.booking = { phase: "done", bookingId: kind };
  e.state.fields.receipt = { businessId: kind, status: "succeeded", id: "old" };
  e.state.recentMessages = [{ role: "assistant", content: "Porosia u krye me sukses." }];
  expect((await validateResponse("Porosia u krye me sukses.", e)).status).toBe("unsupported_critical_claim");
});

it.each([
  "Këpuca kushton 35 EUR dhe Çorapja kushton 400 ALL.",
  "Këpuca: 35 EUR, Çorapja: 400 ALL.",
  "Këpuca kushton €35; Rregullimi kushton nga 12,5 EUR.",
  "[[product:one]] kushton 35 EUR dhe [[product:two]] kushton 400 ALL.",
  "Nuk ka çmim të verifikuar për një artikull tjetër. Këpuca kushton 35 EUR.",
])("R4: preserves independently bound multi-entity values: %s", async text => {
  expect((await validateResponse(text, fixture())).reply).toBe(text);
});
it.each([
  "Këpuca kushton 400 ALL dhe Çorapja kushton 35 EUR.",
  "Këpuca kushton 35 ALL dhe Çorapja kushton 400 EUR.",
  "Këpuca kushton 35 EUR dhe Rregullimi kushton 12,5 EUR.",
  "Këpuca dhe Çorapja kushtojnë 35 EUR dhe 400 ALL.",
  "Një artikull i panjohur kushton 35 EUR.",
])("R4: numbers elsewhere in the catalog are not evidence: %s", async text => {
  expect((await validateResponse(text, fixture())).changed).toBe(true);
});
it("catalog names containing conjunctions are still a single attributed entity", async () => {
  const e = fixture(); e.grounding.products.records[0].name = "Krem dhe shampo";
  const correct = "Krem dhe shampo kushton 35 EUR dhe Çorapja kushton 400 ALL.";
  expect((await validateResponse(correct, e)).reply).toBe(correct);
  expect((await validateResponse("Krem dhe shampo kushton 400 ALL dhe Çorapja kushton 35 EUR.", e)).changed).toBe(true);
});

it.each(["Emri yt nuk është Drita.", "Emri yt nuk eshte Drita.", "Ti quhesh Drita dhe ke 50 punonjës.",
  "Your name is not Drita.", "Ti quhesh Drita dhe je mjeke.", "Ti quhesh Drita Dritat."])("R4: polarity/extensions of exact values: %s", async text => {
  const result = (await validateResponse(text, fixture("Si e kam emrin?")));
  expect(result.changed).toBe(true); expect(result.reply).toBe("Ti ke deklaruar emrin: Drita.");
});
it.each(["Ti shet këpucë online dhe ke 30 punonjës.", "Ti shet këpucë online dhe ofron kredi.",
  "Biznesi yt shet këpucë online dhe është më i madhi në qytet."])("R4: supported prefix cannot authorize invented continuation: %s", async text => {
  const result = (await validateResponse(text, fixture("Çfarë shes unë?")));
  expect(result.changed).toBe(true); expect(result.reply).toContain("Shitje këpucësh online");
});
it.each(["Ti shet këpucë online.", "Sipas deklarimit tënd, ti shet këpucë online.", "Ti ke deklaruar biznesin tënd: Shitje këpucësh online."])("R4: bounded supported paraphrase: %s", async text => {
  expect((await validateResponse(text, fixture("Çfarë shes unë?"))).reply).toBe(text);
});
it("a correct recall may retain an unrelated uncertainty clause", async () => {
  const text = "Ti quhesh Drita, por nuk e di stokun aktual.";
  expect((await validateResponse(text, fixture("Si quhem?"))).reply).toBe(text);
});
it("keeps hypothetical questions and business facts separate from customer recall", async () => {
  expect((await validateResponse("Po sikur të kesh 50 punonjës?", fixture())).changed).toBe(false);
  expect((await validateResponse("Biznesi ofron rregullime.", fixture("Çfarë ofron biznesi?"))).changed).toBe(false);
});
it("corrected facts survive shortened history/reload without mutating state or widening disclosure", async () => {
  const e = fixture("Si quhem?");
  e.state.recentMessages = [{ role: "assistant", content: "Ti quhesh Old." }];
  setFact(e.state, "customer_name", "Arta", "text", "correction");
  e.state = migrateContext(JSON.parse(JSON.stringify(e.state)));
  e.customer = projectCustomerContext(e.state, e.message);
  const before = structuredClone(e);
  expect((await validateResponse("Ti quhesh Drita.", e)).reply).toBe("Ti ke deklaruar emrin: Arta.");
  expect((await validateResponse("Ti quhesh Arta.", e)).changed).toBe(false);
  expect(e).toEqual(before);
  expect(projectCustomerContext(e.state, "Çfarë ofron biznesi?").profile).toEqual({});
});

it.each([
  { domain: "retail", facts: { usual_size: "M", size: "XL" }, good: "usual_size: M dhe size: XL.", bad: "size: M.", key: "size", current: "XL" },
  { domain: "salon", facts: { preferred_day: "e premte", preferred_time: "17:00" }, good: "preferred_day: e premte.", bad: "preferred_day: e hënë.", key: "preferred_day", current: "e premte" },
  { domain: "garage", facts: { vehicle: "Discovery Sport", year: "2018", symptom: "nuk ndizet" }, good: "year: 2018.", bad: "year: 2017.", key: "year", current: "2018" },
  { domain: "education", facts: { age: "6", interest: "muzikë" }, good: "age: 6.", bad: "age: 4.", key: "age", current: "6" },
])("R4 $domain: current field values do not borrow other values or become profile", async ({ facts, good, bad, key, current }) => {
  const e = fixture(`Çfarë ${key} dhashë?`);
  e.state = migrateContext(); e.state.schemaVersion = 3;
  e.state.context!.execution.factOwner = "auxiliary";
  for (const [key, value] of Object.entries(facts)) setFact(e.state, key, value!, "text", "correction");
  e.customer = projectCustomerContext(e.state, e.message);
  expect((await validateResponse(good, e)).reply).toBe(good);
  expect((await validateResponse(bad, e)).reply).toContain(`${key}: ${current}`);
  expect((await validateResponse(bad, e)).findings).toContainEqual({ status: "contradiction", code: "customer_fact_unverified" });
  expect(e.state.context!.profile).toEqual({});
  expect((await validateResponse("Ti ke diagnozë të konfirmuar nga servisi.", e)).changed).toBe(true);
  expect((await validateResponse("Nëse ke nevojë, mund të kërkosh një kontroll.", e)).changed).toBe(false);
});
