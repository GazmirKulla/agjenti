import { describe, expect, it } from "vitest";
import { projectCustomerContext, redactUnrequestedContact } from "./customer-context";
import { extractExplicitFacts, migrateContext, resetOrder, setFact, type Fact } from "@/lib/workflows/context";
import { extractCustomerDeclaredFacts } from "@/lib/workflows/customer-declared-facts";
import { rememberTurn } from "@/lib/workflows/guidance";
import { restoreOrder, snapshotOrder } from "@/lib/workflows/conversation-processes";

const f = (value: string): Fact => ({ value, type: "text", source: "message_label", validated: true });
function serviceState() {
  const state = migrateContext(); state.schemaVersion = 3;
  state.processes = { active: null, service: { id: "service-1", versionId: "A", status: "suspended", fields: {},
    order: { project_type: f("website"), budget: { ...f("500"), type: "number" }, contact: f("private-contact"), api_key: f("private-secret") },
    visual: { versionId: "A", nodeId: "budget", status: "waiting", awaiting: false, visited: [], values: { project_type: "STALE" } } } };
  return state;
}
describe("R1 customer-declared facts", () => {
  it.each(["Quhem Synthetic", "Emri im është Synthetic", "Emri: Synthetic"])("extracts supported own name: %s", message => {
    const state = migrateContext(); extractExplicitFacts(state, message);
    expect(state.context?.profile.name?.value).toBe("Synthetic");
    expect(projectCustomerContext(state, "Si quhem?").profile.name.authority).toBe("customer_declared");
  });
  it.each(["A quhem Synthetic?", "Ai quhet Synthetic", "Nëse quhem Synthetic", "Quhem Synthetic dhe dua produktin"])("does not infer a name: %s", message => {
    const state = migrateContext(); extractExplicitFacts(state, message); expect(state.context?.profile.name).toBeUndefined();
  });
  it("allowlists categories; declarations never enter profile, order, catalog or confirmations", () => {
    const state = migrateContext();
    expect(extractCustomerDeclaredFacts(state, "Instagram: synthetic_shop; Lloji i biznesit: dyqan online; Pyetjet tipike: çmime, madhësi dhe porosi")).toBe(3);
    expect(state.customerDeclaredFacts?.stated_needs).toEqual({ ...f("çmime, madhësi dhe porosi"), source: "customer_declaration" });
    expect(state.context).toEqual({ profile: {}, order: {}, execution: {} });
    expect(extractCustomerDeclaredFacts(state, "Password: secret; cmimi: 0; Instagram: other@example.test; Biznesi i tij: tjetër; Instagram: shop?; Summary: anything")).toBe(0);
    expect(projectCustomerContext(state, "Cili është profili im në Instagram?").declared.instagram_handle.value).toBe("synthetic_shop");
    expect(projectCustomerContext(state, "Çfarë pyetjesh marr më shpesh?").declared.stated_needs.authority).toBe("customer_declared");
  });
  it.each([5, 10, 25])("survives %i turns and serialized reload without old message recovery", turns => {
    let state = migrateContext();
    extractExplicitFacts(state, "Quhem Synthetic");
    extractCustomerDeclaredFacts(state, "Instagram: synthetic_shop; Lloji i biznesit: online clothing store; Pyetjet tipike: prices, sizes and orders");
    for (let i = 0; i < turns; i++) { const next = structuredClone(state); rememberTurn(state, next, `Question ${i}`, `Reply ${i}`); state = next; }
    state = migrateContext(JSON.parse(JSON.stringify(state)));
    expect(state.recentMessages).toHaveLength(10);
    expect(JSON.stringify(state.recentMessages)).not.toContain("synthetic_shop");
    expect(projectCustomerContext(state, "Çfarë të kam thënë më parë?")).toMatchObject({
      profile: { name: { value: "Synthetic", authority: "customer_declared" } }, declared: {
        instagram_handle: { value: "synthetic_shop" }, business_type: { value: "online clothing store" }, stated_needs: { value: "prices, sizes and orders" },
      },
    });
    extractCustomerDeclaredFacts(state, "Profili im në Instagram është corrected_shop");
    extractExplicitFacts(state, "Emri im është Corrected");
    const corrected = projectCustomerContext(resetOrder(state), "Çfarë të kam thënë më parë?");
    expect(corrected.profile.name.value).toBe("Corrected"); expect(corrected.declared.instagram_handle.value).toBe("corrected_shop");
    expect(JSON.stringify(corrected)).not.toContain("synthetic_shop");
  });
  it("does not share facts with another conversation/participant or retain mutable references", () => {
    const a = migrateContext(), b = migrateContext(); extractCustomerDeclaredFacts(a, "Instagram: first_customer");
    const projected = projectCustomerContext(a, "Instagrami im?"); projected.declared.instagram_handle.value = "mutated";
    expect(a.customerDeclaredFacts?.instagram_handle?.value).toBe("first_customer");
    expect(projectCustomerContext(b, "Instagrami im?").declared).toEqual({});
  });
  it("ignores malformed historical declarations rather than treating them as verified facts", () => {
    const state = migrateContext();
    state.customerDeclaredFacts = JSON.parse('{"instagram_handle":{"value":123,"type":"text","source":"customer_declaration","validated":true}}');
    expect(projectCustomerContext(state, "Instagrami im?").declared).toEqual({});
  });
});
describe("R1 owned context projection", () => {
  it("keeps v1/v2/v3 readable without upgrading or mutating persisted input", () => {
    const legacy = { fields: {}, customer: { name: "Legacy", phone: null, city: null, address: null } };
    const before = structuredClone(legacy);
    expect(projectCustomerContext(legacy, "Si quhem?").profile.name).toMatchObject({ value: "Legacy", source: "legacy_customer", authority: "legacy_unverified" });
    expect(legacy).toEqual(before);
    for (const schemaVersion of [2, 3] as const) {
      const state = migrateContext(legacy); state.schemaVersion = schemaVersion;
      expect(projectCustomerContext(state, "Si quhem?").profile.name.value).toBe("Legacy");
    }
  });
  it("preserves workflow field provenance, bounds excerpts and refuses invalid values", () => {
    const state = migrateContext(); setFact(state, "project_type", "website", "text", "visual:project-node");
    setFact(state, "description", "x".repeat(350), "text", "message_label");
    state.context!.order.bad = { ...f("not-a-number"), type: "number" };
    const out = projectCustomerContext(state, "Informacion?");
    expect(out.process?.fields.project_type).toMatchObject({ source: "visual:project-node", authority: "customer_declared" });
    expect(out.process?.fields.description.value).toHaveLength(300); expect(out.process?.fields.description.truncated).toBe(true);
    expect(out.process?.fields.bad).toBeUndefined();
  });
  it("uses suspended canonical service facts, not old visual values, unrelated PII or approvals", () => {
    const state = serviceState();
    setFact(state, "customer_phone", "0690000000", "phone", "message:0690000000 other-private-data");
    state.processes!.service!.visual.pendingConfirmation = { nodeId: "review", factsKey: "OLD_TOKEN", expiresAt: 1 };
    const before = structuredClone(state), out = projectCustomerContext(state, "Çfarë project_type dhashë për shërbimin?");
    expect(out.process).toMatchObject({ kind: "service", id: "service-1", versionId: "A", fields: { project_type: { value: "website" } } });
    expect(JSON.stringify(out)).not.toMatch(/STALE|OLD_TOKEN|private|0690000000/);
    expect(state).toEqual(before);
    expect(projectCustomerContext(state, "Sa kushton produkti?").process).toBeUndefined();
  });
  it("refuses ambiguous ownership and expired/completed/version-mismatched snapshots", () => {
    const state = serviceState(); setFact(state, "budget", "200", "number", "message_label");
    state.context!.execution.factOwner = "order";
    state.processes!.order = { id: "order-1", status: "suspended", snapshot: snapshotOrder(state) };
    expect(projectCustomerContext(state, "Sa budget dhashë?").diagnostic).toBe("ambiguous_process");
    state.processes!.service!.visual.versionId = "B";
    expect(projectCustomerContext(state, "Të dhënat e shërbimit?").process).toBeUndefined();
    state.processes!.service!.visual.versionId = "A"; state.processes!.service!.status = "completed";
    expect(projectCustomerContext(state, "Të dhënat e shërbimit?").process).toBeUndefined();
  });
  it("preserves corrected live facts/entity on resume without restoring old review", () => {
    const state = migrateContext(); state.schemaVersion = 3; state.product_id = "product-A";
    state.context!.execution.factOwner = "order"; setFact(state, "size", "M", "text", "message_label");
    state.processes = { active: "order", order: { id: "order-1", status: "active", snapshot: snapshotOrder(state) } };
    setFact(state, "size", "L", "text", "message_label"); state.product_id = "product-B";
    const next = restoreOrder(state, { resume: true });
    expect(projectCustomerContext(next, "Cila është madhësia e porosisë?").process).toMatchObject({ entity: { id: "product-B" }, fields: { size: { value: "L" } } });
    expect(next.context?.execution.orderConfirmed).toBe(false);
  });
  it("exposes booking preferences, not availability, contact or stale confirmation", () => {
    const state = migrateContext(); state.schemaVersion = 3;
    state.processes = { active: null, booking: { id: "nonce", status: "suspended", versionId: "A", draft: {
      nonce: "nonce", phase: "confirm", expires: 2000, serviceId: "service-A", date: "2027-01-05", time: "14:30", contact: "private-contact",
      review: { factsKey: "STALE_REVIEW" }, preparedConfirmation: { factsKey: "STALE_REVIEW" },
    } } };
    const out = projectCustomerContext(state, "Çfarë preferencash rezervimi dhashë?", 1000);
    expect(out.process).toMatchObject({ kind: "booking", authority: "collected_preferences_only", fields: { date: { value: "2027-01-05" }, time: { value: "14:30" } } });
    expect(JSON.stringify(out)).not.toMatch(/STALE_REVIEW|private-contact|confirmed/);
    expect(projectCustomerContext(state, "Rezervimi im?", 2000).process).toBeUndefined();
  });
  it("excludes invalid fields, staff-owned process and unrelated contact data", () => {
    const state = migrateContext(); setFact(state, "budget", "40", "number", "message_label");
    state.context!.execution.invalidFields = ["budget"];
    setFact(state, "customer_phone", "0690000000", "phone", "message_label");
    let out = projectCustomerContext(state, "Sa kushton?"); expect(out.process?.fields).toEqual({}); expect(out.profile).toEqual({});
    expect(redactUnrequestedContact("Phone 0690000000", state, out)).not.toContain("0690000000");
    out = projectCustomerContext(state, "Cili është telefoni im?"); expect(out.profile.phone.value).toBe("0690000000");
    state.staffHandoff = true; expect(projectCustomerContext(state, "Telefoni im?")).toEqual({ profile: {}, declared: {}, diagnostic: "staff_owned" });
  });
});
