import { describe, expect, it } from "vitest";
import { orderDelivery, resolveContact } from "./contact";

describe("resolveContact", () => {
  it("a newer order replaces an older value typed into the customer record, and keeps it visible", () => {
    const contact = resolveContact({
      crm: { values: { name: "Bora", phone: "0691111111" }, at: "2026-11-10T10:00:00Z" },
      order: { values: { name: "Bora", phone: "067 643 0393", city: "Tiranë", address: "Rr. Panajot Pano" }, at: "2026-11-15T10:00:00Z" },
    });
    expect(contact.phone).toMatchObject({ value: "067 643 0393", source: "order" });
    expect(contact.phone?.others).toEqual([{ value: "0691111111", source: "crm", at: "2026-11-10T10:00:00Z" }]);
    expect(contact.name?.others).toEqual([]);
    expect(contact.address).toMatchObject({ value: "Rr. Panajot Pano", source: "order" });
    expect(contact.email).toBeNull();
  });

  it("a customer record edited after the order wins", () => {
    const contact = resolveContact({
      crm: { values: { phone: "+355 69 222 3333" }, at: "2026-11-16T10:00:00Z" },
      order: { values: { phone: "0676430393" }, at: "2026-11-15T10:00:00Z" },
    });
    expect(contact.phone).toMatchObject({ source: "crm", value: "+355 69 222 3333" });
    expect(contact.phone?.others.map((o) => o.source)).toEqual(["order"]);
  });

  it("an agent value without a time only fills what nothing else has", () => {
    const contact = resolveContact({
      crm: { values: { phone: "0691111111" }, at: "2026-11-10T10:00:00Z" },
      agent: { values: { phone: "0676430393", city: "Durrës" }, at: null },
    });
    expect(contact.phone).toMatchObject({ source: "crm", value: "0691111111" });
    expect(contact.phone?.others).toEqual([{ value: "0676430393", source: "agent", at: null }]);
    expect(contact.city).toMatchObject({ source: "agent", value: "Durrës" });
  });

  it("a dated agent memory newer than the record wins", () => {
    const contact = resolveContact({
      crm: { values: { phone: "0691111111" }, at: "2026-11-10T10:00:00Z" },
      agent: { values: { phone: "0676430393" }, at: "2026-11-12T10:00:00Z" },
    });
    expect(contact.phone?.source).toBe("agent");
  });

  it("the same number written differently is not a conflict", () => {
    const contact = resolveContact({
      crm: { values: { phone: "+355 67 643 0393", name: "bora  mato" }, at: "2026-11-10T10:00:00Z" },
      order: { values: { phone: "+35567-643-0393", name: "Bora Mato" }, at: "2026-11-15T10:00:00Z" },
    });
    expect(contact.phone?.others).toEqual([]);
    expect(contact.name?.others).toEqual([]);
  });

  it("on equal times the order comes first, then the record", () => {
    const at = "2026-11-15T10:00:00Z";
    const contact = resolveContact({ crm: { values: { phone: "1111111" }, at }, order: { values: { phone: "2222222" }, at }, agent: { values: { phone: "3333333" }, at } });
    expect(contact.phone?.source).toBe("order");
    expect(contact.phone?.others.map((o) => o.source)).toEqual(["crm", "agent"]);
  });

  it("empty sources give empty fields", () => {
    const contact = resolveContact({ crm: { values: { name: "  " }, at: null } });
    expect(Object.values(contact).every((v) => v === null)).toBe(true);
  });
});

describe("orderDelivery", () => {
  it("reads the saved delivery and ignores anything else", () => {
    expect(orderDelivery({ customer: { name: " Bora ", phone: "067", city: null, address: "", extra: "x" } })).toEqual({ name: "Bora", phone: "067", city: null, address: null });
    expect(orderDelivery({ customer: {} })).toBeNull();
    expect(orderDelivery(null)).toBeNull();
    expect(orderDelivery({ customer: "text" })).toBeNull();
  });
});
