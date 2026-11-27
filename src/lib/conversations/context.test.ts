import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/crypto/tokens", () => ({ decryptSecret: () => "token" }));
vi.mock("@/lib/conversations/profile", () => ({ readProcessProfile: async () => undefined }));
vi.mock("@/lib/orchestration/version-store", () => ({ loadProcessVersion: async () => null, compileProcessVersion: () => [] }));
import { fieldPresentation } from "./context";
import { orderFields } from "@/lib/orchestration/order-definition";
import { bookingFields } from "@/lib/orchestration/booking-definition";
import { bookingManageFields } from "@/lib/orchestration/booking-manage-definition";

describe("fieldPresentation", () => {
  it("shows built-in order fields in the owner's words and hides identifiers", () => {
    const { fields, key } = orderFields("linear_test");
    const byId = (id: string) => fieldPresentation(fields.find((f) => f.id === id)!);
    expect(byId(key("productId"))).toEqual({ label: null, missing: "Produkti" });
    expect(byId(key("productName"))).toEqual({ label: "Produkti", missing: null });
    expect(byId(key("options")).label).toBeNull();
    expect(byId("customer_phone")).toEqual({ label: "Telefoni", missing: "Telefoni" });
  });
  it("hides booking settings and names booking fields", () => {
    const { fields, key } = bookingFields("node");
    const byId = (id: string) => fieldPresentation(fields.find((f) => f.id === id)!);
    expect(byId(key("serviceId"))).toEqual({ label: null, missing: "Shërbimi" });
    expect(byId(key("timezone")).label).toBeNull();
    expect(byId(key("date")).label).toBe("Data");
  });
  it("names a change to an existing booking in the owner's words, never the agent's internal wording", () => {
    const { fields, key } = bookingManageFields("auto_booking_manage");
    const byId = (id: string) => fieldPresentation(fields.find((f) => f.id === id)!);
    expect(byId(key("action"))).toMatchObject({ label: "Kërkesa", values: { cancel: "Anulim", reschedule: "Zhvendosje" } });
    expect(byId(key("startsAt")).label).toBe("Rezervimi aktual");
    expect(byId(key("date"))).toMatchObject({ label: "Data e re", onlyWhenMoving: true });
    for (const name of ["bookingId", "serviceId", "status", "bookingRevision", "changeable"]) expect(byId(key(name)).label).toBeNull();
    for (const field of fields) expect(JSON.stringify(fieldPresentation(field))).not.toMatch(/customer|booking they|server/i);
  });
  it("keeps the business's own labels and hides photos", () => {
    expect(fieldPresentation({ id: "size", subject: "order", label: "Masa", type: "choice", required: true })).toEqual({ label: "Masa", missing: "Masa" });
    expect(fieldPresentation({ id: "pic", subject: "order", label: "Foto", type: "photo", required: true }).label).toBeNull();
  });
});
