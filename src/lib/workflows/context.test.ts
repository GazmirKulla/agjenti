import { expect, it } from "vitest";
import { emptyState } from "./engine";
import { getFact, migrateContext, setFact } from "./context";

it("migrates customer fields but never guesses the meaning of a custom field", () => {
    const old = emptyState();
    old.customer.phone = "+355691234567";
    old.fields.emri_klientit = "unverified";
    const s = migrateContext(old);
    expect(getFact(s, "customer_phone")?.value).toBe(old.customer.phone);
    expect(s.context?.profile.name).toBeUndefined();
    expect(s.context?.order.emri_klientit.value).toBe("unverified");
});

it("validates phone and field ownership instead of accepting arbitrary answers", () => {
    const s = migrateContext(emptyState());
    expect(setFact(s, "customer_phone", "Ana", "text", "test")).toBe(false);
    expect(setFact(s, "constructor", "x", "text", "test")).toBe(false);
});

it("does not promote leftover confirmation flags into a valid approval", () => {
    const input = { ...emptyState(), schemaVersion: 3 as const, product_id: "p", step_key: "order_ready", fields: { size: "M" } };
    input.customer.phone = "0691111111";
    const state = migrateContext(input);
    expect(state.customer.phone).toBe(input.customer.phone);
    expect(state.context!.order.size.value).toBe("M");
    expect(state.context!.execution.orderConfirmed).toBe(false);
    expect(state.context!.execution.orderReview).toBeUndefined();
});

it("uses canonical profile values instead of contradictory leftover projections", () => {
    const state = migrateContext(emptyState());
    setFact(state, "customer_phone", "0691111111", "phone", "customer");
    state.customer.phone = "0690000000";
    expect(migrateContext(state).customer.phone).toBe("0691111111");
});

it("revokes confirmation when a stored value fails validation", () => {
    const state = migrateContext(emptyState());
    setFact(state, "customer_phone", "+355691234567", "phone", "message_evidence");
    state.context!.execution.orderConfirmed = true;
    expect(setFact(state, "customer_phone", "", "phone", "message_evidence")).toBe(false);
    expect(state.context!.execution.invalidFields).toContain("customer_phone");
    expect(state.context!.execution.orderConfirmed).toBe(false);
});
