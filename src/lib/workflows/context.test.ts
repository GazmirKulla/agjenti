import { describe, expect, it } from "vitest";
import { emptyState, type WorkflowStepDef } from "./engine";
import { advanceSharedOrder, extractExplicitFacts, getFact, migrateContext, resetOrder, setFact, sharedPrompt } from "./context";
const steps: WorkflowStepDef[] = [{ key: "size", kind: "choice", label: "Madhësia", options: ["M", "L"] }, { key: "customer", kind: "customer" }];
function order() { const s = migrateContext(emptyState()); s.product_id = "product"; s.step_key = "size"; return s; }
function profile() { const s = order(); extractExplicitFacts(s, "Emri: Ana; Telefon: +355691234567; Qyteti: Tiranë; Adresa: Rruga A"); return s; }
describe("shared conversation context", () => {
    it("migrates customer fields but never guesses the meaning of a custom field", () => {
        const old = emptyState();
        old.customer.phone = "+355691234567";
        old.fields.emri_klientit = "unverified";
        const s = migrateContext(old);
        expect(getFact(s, "customer_phone")?.value).toBe(old.customer.phone);
        expect(s.context?.profile.name).toBeUndefined();
        expect(s.context?.order.emri_klientit.value).toBe("unverified");
    });
    it("extracts multiple explicit facts before their questions", () => {
        const s = order();
        expect(extractExplicitFacts(s, "Emri: Ana; Telefon: +355691234567; Madhësia: M", steps)).toBe(3);
        const next = advanceSharedOrder(s, "", false, steps, true);
        expect(next.step_key).toBe("customer");
        expect(sharedPrompt(next, steps)).toContain("qytetin, adresën");
        expect(sharedPrompt(next, steps)).not.toContain("telefonin");
    });
    it("does not reprompt known fields and requires a separate final confirmation", () => {
        let s = advanceSharedOrder(profile(), "M", false, steps);
        expect(s.step_key).toBe("order_confirm");
        expect(s.context?.execution.orderConfirmed).toBe(false);
        s = advanceSharedOrder(s, "po", false, steps);
        expect(s.step_key).toBe("order_ready");
        expect(s.context?.execution.orderConfirmed).toBe(true);
    });
    it("preserves a missing question during informational interruptions", () => {
        const s = advanceSharedOrder(order(), "Sa kushton?", false, steps);
        expect(s.step_key).toBe("size");
        expect(s.fields.size).toBeUndefined();
    });
    it("validates choice and phone instead of accepting arbitrary answers", () => {
        expect(advanceSharedOrder(order(), "XL", false, steps).step_key).toBe("size");
        const s = order();
        expect(setFact(s, "customer_phone", "Ana", "text", "test")).toBe(false);
        expect(setFact(s, "constructor", "x", "text", "test")).toBe(false);
    });
    it("invalidates final confirmation on address correction without losing other data", () => {
        let s = advanceSharedOrder(profile(), "M", false, steps);
        s = advanceSharedOrder(s, "po", false, steps);
        s = advanceSharedOrder(s, "Adresa: Rruga B", false, steps);
        expect(s.step_key).toBe("order_confirm");
        expect(s.context?.execution.orderConfirmed).toBe(false);
        expect(s.customer.address).toBe("Rruga B");
        expect(s.customer.phone).toBe("+355691234567");
    });
    it("starts a new order with profile confirmation but no old photos, variants or approvals", () => {
        const s = profile();
        setFact(s, "size", "M", "text", "test");
        setFact(s, "photo", "photo_received", "photo", "test");
        s.context!.execution.orderConfirmed = true;
        const next = resetOrder(s);
        expect(next.context?.order).toEqual({});
        expect(next.fields).toEqual({});
        expect(next.context?.execution.profileConfirmation).toBe("pending");
        expect(next.customer.name).toBe("Ana");
    });
    it("uses a single summary for a returning customer then continues", () => {
        let s = resetOrder(profile());
        s.product_id = "product";
        s.step_key = "customer";
        expect(sharedPrompt(s, steps)).toContain("A vlejnë për këtë porosi?");
        s = advanceSharedOrder(s, "po", false, steps);
        expect(s.step_key).toBe("order_confirm");
        expect(s.context?.execution.profileConfirmation).toBe("confirmed");
        expect(s.context?.execution.orderConfirmed).not.toBe(true);
    });
    it("keeps confirmations explicit even when a field with their key exists", () => {
        const s = profile();
        setFact(s, "approval", "po", "text", "old");
        s.step_key = "approval";
        const next = advanceSharedOrder(s, "", false, [{ key: "approval", kind: "confirm" }, ...steps], true);
        expect(next.step_key).toBe("approval");
    });
    it("advances beyond a customer step when more required steps follow", () => {
        const s = profile();
        s.step_key = "customer";
        expect(advanceSharedOrder(s, "", false, [{ key: "customer", kind: "customer" }, { key: "photo", kind: "photo" }], true).step_key).toBe("photo");
    });
});
it("does not silently retain an old phone after an invalid correction", () => {
    let s = advanceSharedOrder(profile(), "M", false, steps);
    s = advanceSharedOrder(s, "po", false, steps);
    s = advanceSharedOrder(s, "Telefon: gabim", false, steps);
    expect(s.step_key).toBe("order_confirm");
    expect(s.context?.execution.orderConfirmed).toBe(false);
    expect(sharedPrompt(s, steps)).toContain("Kontrollo telefonin");
    s = advanceSharedOrder(s, "+355699999999", false, steps);
    expect(s.customer.phone).toBe("+355699999999");
    expect(sharedPrompt(s, steps)).toContain("Konfirmoni porosinë");
    expect(s.context?.execution.orderConfirmed).toBe(false);
});
