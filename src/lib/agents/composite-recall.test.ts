import { expect, it } from "vitest";
import { migrateContext, extractExplicitFacts, setFact, type Fact } from "@/lib/workflows/context";
import { rememberTurn } from "@/lib/workflows/guidance";
import { snapshotOrder } from "@/lib/workflows/conversation-processes";
import { extractCustomerDeclaredFacts } from "@/lib/workflows/customer-declared-facts";
import { customerFactReference } from "./customer-fact-reference";
import { projectCustomerContext } from "./customer-context";
import { validateResponse } from "./response-consistency";

const composite = "Rikujto perseri emrin, biznesin, Instagramin dhe pyetjet tipike, pa te dhena te reja.";
function fixture() {
  const state = migrateContext(); state.schemaVersion = 3;
  extractExplicitFacts(state, "Quhem Drita");
  extractCustomerDeclaredFacts(state, "Lloji i biznesit: Shitje librash online; Instagram: synthetic_books; Pyetjet tipike: çmimet dhe transporti");
  return state;
}
function evidence(state = fixture(), message = composite) {
  return { state, message, customer: projectCustomerContext(state, message), products: [], services: [], informational: true };
}
it("P1 reproduces composite vs individual reference selection with identical canonical state", () => {
  const state = fixture(), before = structuredClone(state);
  expect(projectCustomerContext(state, "Si quhem une?").profile.name.value).toBe("Drita");
  const projected = projectCustomerContext(state, composite);
  expect(projected.reference?.keys).toEqual(["name", "instagram_handle", "business_type", "stated_needs"]);
  expect(projected.profile.name.value).toBe("Drita");
  expect(Object.keys(projected.declared)).toHaveLength(3);
  expect(state).toEqual(before);
});
it.each(["Më kujto emrin dhe Instagram-in.", "Përmblidh emrin dhe Instagramin që të dhashë.", "Remind me of my name and Instagram."])("two references: %s", message => {
  expect(customerFactReference(message)?.keys).toEqual(["name", "instagram_handle"]);
});
it("imperative recall corrects false absence without changing canonical facts", () => {
  const e = evidence(), before = structuredClone(e.state);
  const out = validateResponse("Nuk e di emrin. Nuk më ke dhënë biznesin, Instagramin apo pyetjet.", e);
  for (const value of ["Drita", "synthetic_books", "Shitje librash online", "çmimet dhe transporti"]) expect(out.reply).toContain(value);
  expect(e.state).toEqual(before);
});
it("correct composite answer passes unchanged", () => {
  const reply = "Emri yt është Drita. Biznesi yt: Shitje librash online. Instagrami yt: synthetic_books. Pyetjet tipike: çmimet dhe transporti.";
  expect(validateResponse(reply, evidence(fixture(), "Çfarë të kam thënë?")).reply).toBe(reply);
});
it("partial recall preserves known facts and identifies only the unavailable requested field", () => {
  const state = fixture(); delete state.customerDeclaredFacts!.instagram_handle;
  const e = evidence(state, "Më kujto emrin dhe Instagramin tim.");
  const out = validateResponse("Nuk më ke dhënë asnjë të dhënë.", e);
  expect(out.reply).toContain("Drita"); expect(out.reply).toContain("Instagram");
  expect(out.reply).not.toContain("synthetic_books"); expect(out.reply).not.toContain("asnjë");
});
it("dynamic process recall does not accept a blanket absence claim", () => {
  const state = migrateContext(); state.schemaVersion = 3;
  setFact(state, "project_type", "website", "text", "message_label");
  setFact(state, "budget", "750", "number", "message_label");
  const out = validateResponse("Nuk kam të dhëna për këtë kërkesë.", evidence(state, "Çfarë dimë deri tani për këtë kërkesë?"));
  expect(out.reply).toContain("website"); expect(out.reply).toContain("750");
});
it("configured field names can select a composite without a domain-specific handler", () => {
  const state = migrateContext();
  setFact(state, "fabric", "cotton", "text", "message_label");
  setFact(state, "engraving", "HELLO", "text", "message_label");
  setFact(state, "unrelated_note", "private", "text", "message_label");
  const e = evidence(state, "Më kujto fabric dhe engraving.");
  expect(Object.keys(e.customer.process!.fields)).toEqual(["engraving", "fabric"]);
  const out = validateResponse("Nuk kam të dhëna.", e);
  expect(out.reply).toContain("cotton"); expect(out.reply).toContain("HELLO"); expect(out.reply).not.toContain("private");
});
it.each(["Ti quhesh Drita. Nuk kam të dhëna për Instagramin.", "Emri yt është Drita. Nuk kam të dhëna për Instagramin."])("correct partially available answer remains unchanged: %s", reply => {
  const state = fixture(); delete state.customerDeclaredFacts!.instagram_handle;
  expect(validateResponse(reply, evidence(state, "Më kujto emrin dhe Instagramin.")).reply).toBe(reply);
});
it("known values cannot be swapped between requested keys", () => {
  const e = evidence(fixture(), "Më kujto emrin dhe Instagramin.");
  expect(validateResponse("Emri yt: synthetic_books. Instagrami yt: Drita.", e).changed).toBe(true);
});
it("a missing field cannot be invented alongside a known field", () => {
  const state = fixture(); delete state.customerDeclaredFacts!.instagram_handle;
  const out = validateResponse("Ti quhesh Drita. Instagrami yt: invented_shop.", evidence(state, "Më kujto emrin dhe Instagramin."));
  expect(out.reply).toContain("Drita"); expect(out.reply).not.toContain("invented_shop");
});
it("unknown facts are not borrowed from assistant history or another state", () => {
  const state = migrateContext(); state.recentMessages = [{ role: "assistant", content: "Ti quhesh Drita." }];
  expect(validateResponse("Ti quhesh Drita.", evidence(state, "Më kujto emrin.")).status).toBe("unverifiable");
  expect(evidence(state, composite).customer.profile).toEqual({});
});
it.each(["Emri: Invented. Instagram: invented_shop.", "Nuk e di emrin. Instagrami yt: invented_shop."])("all-missing composite cannot invent one requested field: %s", reply => {
  const e = evidence(migrateContext(), "Më kujto emrin dhe Instagramin.");
  const result = validateResponse(reply, e);
  expect(result.reply).not.toContain("invented_shop"); expect(result.reply).not.toContain("Invented");
  expect(result.status).toBe("unverifiable");
});
it("recall is idempotent and never merges an unrelated process", () => {
  const state = fixture(); setFact(state, "budget", "400", "number", "correction");
  const e = evidence(state), before = structuredClone(state);
  const first = validateResponse("Nuk kam të dhëna.", e), second = validateResponse("Nuk kam të dhëna.", evidence(state));
  expect(first).toEqual(second); expect(first.reply).not.toContain("400"); expect(state).toEqual(before);
});
it("unavailable process cannot borrow historical model facts", () => {
  const state = migrateContext(); state.recentMessages = [{ role: "assistant", content: "budget: 9000" }];
  const e = evidence(state, "Më kujto të dhënat për shërbimin.");
  expect(validateResponse("budget: 9000.", e).reply).not.toContain("9000");
});
it.each(["Më kujto emrin e biznesit dhe telefonin e stafit.", "Më përmblidh biznesin tuaj.", "Remind me of your business name."])("tenant identity never borrows customer profile: %s", message => {
  const e = evidence(fixture(), message);
  expect(e.customer.profile).toEqual({}); expect(e.customer.declared).toEqual({});
});
it("customer business summary excludes unrelated contacts and process data", () => {
  const state = fixture(); setFact(state, "customer_phone", "0690000000", "phone", "message_label");
  setFact(state, "budget", "700", "number", "message_label");
  const out = projectCustomerContext(state, "Më përmblidh çfarë të kam treguar për biznesin.");
  expect(out.reference?.keys).toEqual(["business_type", "stated_needs"]);
  expect(JSON.stringify(out)).not.toMatch(/0690000000|synthetic_books|Drita|700/);
  expect(out.process).toBeUndefined();
});
it("staff-owned recall projects no private data and cannot resume a process", () => {
  const state = fixture(); state.staffHandoff = true;
  const before = structuredClone(state), e = evidence(state);
  expect(e.customer).toEqual({ profile: {}, declared: {}, diagnostic: "staff_owned" });
  expect(validateResponse("Nuk kam konfirmim.", e).reply).not.toContain("Drita");
  expect(state).toEqual(before);
});
it.each([1, 2, 3])("legacy state v%i survives shortened history and current corrections", version => {
  let state = fixture(); state.schemaVersion = version === 1 ? undefined : version as 2 | 3;
  for (let i = 0; i < 14; i++) { const next = structuredClone(state); rememberTurn(state, next, `Informacion ${i}?`, "Përgjigje"); state = next; }
  expect(JSON.stringify(state.recentMessages)).not.toContain("Drita");
  state = migrateContext(JSON.parse(JSON.stringify(state)));
  extractExplicitFacts(state, "Quhem Arta"); extractCustomerDeclaredFacts(state, "Instagram: corrected_books");
  const out = validateResponse("Nuk më ke dhënë të dhëna.", evidence(state));
  expect(out.reply).toContain("Arta"); expect(out.reply).toContain("corrected_books"); expect(out.reply).not.toContain("Drita");
  expect(state.pendingCustomerQuestion).toBeUndefined();
});
it("unverified or truncated facts are distinguished from missing facts", () => {
  const state = fixture(); state.context!.profile.name!.source = "legacy_customer";
  state.customerDeclaredFacts!.stated_needs!.value = "x".repeat(350);
  const out = projectCustomerContext(state, composite);
  expect(out.unavailable).toContainEqual({ key: "name", reason: "unverified" });
  expect(validateResponse("Ti quhesh Drita.", evidence(state)).reply).not.toContain("emrin: Drita");
  const out2 = validateResponse("Nuk ma ke dhënë emrin.", evidence(state, "Më kujto emrin."));
  expect(out2.reply).not.toContain("Nuk ma ke dhënë"); expect(out2.reply).toContain("verifikohet");
});
const fact = (value: string): Fact => ({ value, type: "text", source: "correction", validated: true });
it.each(["retail", "service", "booking"])("%s composite recall uses only the correct live owner/version", domain => {
  const state = fixture();
  state.context!.order = { size: fact("XL"), usual_size: fact("M"), budget: fact("900") };
  state.context!.execution.factOwner = "order";
  state.processes = { active: "order", order: { id: "order-a", status: "active", snapshot: snapshotOrder(state) } };
  state.processes.service = { id: "service-a", versionId: "A", status: "suspended", fields: {}, order: { project_type: fact("website"), budget: fact("750"), requirements: fact("accessible") },
    visual: { versionId: "A", nodeId: "review", status: "waiting", awaiting: false, visited: [], values: { budget: "STALE" } } };
  state.processes.booking = { id: "booking-a", status: "suspended", versionId: "A", draft: {
    nonce: "booking-a", expires: Date.now() + 60000, phase: "collect", serviceId: "service-b", date: "2027-01-05", time: "18:00", contact: "private" } };
  const message = domain === "retail" ? "Më kujto preferencat për porosinë." : domain === "service" ? "Më kujto të dhënat për shërbimin." : "Më trego preferencat që kam dhënë për rezervimin?";
  const e = evidence(state, message), before = structuredClone(state);
  const values = domain === "retail" ? ["XL", "M", "900"] : domain === "service" ? ["website", "750", "accessible"] : ["2027-01-05", "18:00"];
  const result = validateResponse("Nuk kam të dhëna për kërkesën.", e);
  for (const value of values) expect(result.reply).toContain(value);
  expect(result.reply).not.toMatch(/Drita|synthetic_books|STALE|private/);
  expect(e.customer.process?.id).toBe(domain === "retail" ? "order-a" : domain === "service" ? "service-a" : "booking-a");
  expect(state).toEqual(before);
  const correct = Object.entries(e.customer.process!.fields).map(([key, f]) => `${key}: ${f.value}.`).join(" ");
  expect(validateResponse(correct, e).reply).toBe(correct);
});
