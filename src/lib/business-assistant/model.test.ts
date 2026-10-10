import { describe, expect, it } from "vitest";
import { readProposal, valuesFor, previewFor, type Proposal } from "./model";
const id = "11111111-1111-4111-8111-111111111111";
const proposal = (
  action: Proposal["action"],
  changes: Record<string, string>,
  target: string | null = null,
): Proposal =>
  readProposal({
    action,
    id: target,
    message: "Kontrollo ndryshimin.",
    changes: Object.entries(changes).map(([field, value]) => ({
      field,
      value,
    })),
  });
describe("business assistant validation", () => {
  it("rejects tenant fields, unknown operations, duplicate fields and ambiguous targets", () => {
    expect(() => proposal("product_update", { business_id: id }, id)).toThrow();
    expect(() => proposal("product_update", { name: "Test" })).toThrow();
    expect(() =>
      readProposal({ action: "delete_all", id, message: "", changes: [] }),
    ).toThrow();
    expect(() =>
      readProposal({
        action: "product_update",
        id,
        message: "",
        changes: [
          { field: "name", value: "A" },
          { field: "name", value: "B" },
        ],
      }),
    ).toThrow();
  });
  it("updates only requested product fields and preserves unspecified data", () => {
    const p = proposal("product_update", { price_amount: "45.50" }, id);
    expect(
      valuesFor(
        p,
        {
          name: "Barrierë",
          sku: "B1",
          description: "Origjinal",
          price_amount: 30,
          currency: "EUR",
        },
        "Europe/Tirane",
      ),
    ).toEqual({ price_amount: 45.5 });
  });
  it("creates inactive products and validates prices", () => {
    expect(
      valuesFor(
        proposal("product_create", {
          name: "Barrierë",
          price_amount: "45",
          currency: "EUR",
        }),
        null,
        "Europe/Tirane",
      ),
    ).toMatchObject({ name: "Barrierë", is_active: false, price_amount: 45 });
    for (const price of ["-1", "NaN", "Infinity", "", "12.333", "10000000000"])
      expect(() =>
        valuesFor(
          proposal("product_create", { name: "Barrierë", price_amount: price }),
          null,
          "Europe/Tirane",
        ),
      ).toThrow();
  });
  it("retains custom service hours when editing price", () => {
    const hours = [{ day: 1, start: "09:00", end: "17:00" }];
    const row = {
      name: "Konsultë",
      description: "",
      category: "",
      price_amount: 20,
      currency: "EUR",
      price_mode: "fixed",
      booking_enabled: true,
      duration_minutes: 45,
      buffer_minutes: 10,
      hours,
      is_active: true,
    };
    expect(
      valuesFor(
        proposal("service_update", { price_amount: "25" }, id),
        row,
        "Europe/Tirane",
      ),
    ).toMatchObject({ ...row, price_amount: 25 });
    expect(() =>
      valuesFor(
        proposal("service_update", { booking_enabled: "yes" }, id),
        row,
        "Europe/Tirane",
      ),
    ).toThrow();
  });
  it("does not erase hidden service scheduling settings on unrelated edits", () => {
    expect(
      valuesFor(
        proposal("service_update", { description: "E re" }, id),
        {
          name: "Konsultë",
          booking_enabled: false,
          duration_minutes: 45,
          buffer_minutes: 10,
          hours: null,
        },
        "Europe/Tirane",
      ),
    ).toMatchObject({
      duration_minutes: 45,
      buffer_minutes: 10,
      description: "E re",
    });
  });
  it("requires real booking details and rejects invalid dates", () => {
    const data = {
      service_id: id,
      customer_name: "Arta",
      customer_contact: "0690000000",
      date: "2026-10-12",
      time: "10:00",
    };
    expect(
      valuesFor(proposal("booking_create", data), null, "Europe/Tirane"),
    ).toMatchObject({
      starts_at: "2026-10-12T08:00:00.000Z",
      status: "pending",
    });
    expect(() =>
      valuesFor(
        proposal("booking_create", { ...data, customer_contact: "" }),
        null,
        "Europe/Tirane",
      ),
    ).toThrow();
    expect(() =>
      valuesFor(
        proposal("booking_create", { ...data, date: "2026-02-30" }),
        null,
        "Europe/Tirane",
      ),
    ).toThrow();
    expect(() =>
      valuesFor(
        proposal("booking_create", {
          ...data,
          date: "2026-10-25",
          time: "02:30",
        }),
        null,
        "Europe/Tirane",
      ),
    ).toThrow();
  });
  it("preserves knowledge body on title changes and shows human-readable previews", () => {
    const before = {
      title: "Politika",
      body: "Teksti ekzistues",
      is_active: true,
    };
    expect(
      valuesFor(
        proposal("knowledge_update", { title: "Transporti" }, id),
        before,
        "Europe/Tirane",
      ),
    ).toEqual({ title: "Transporti" });
    const preview = previewFor(
      "booking_update",
      { service_id: id, service_name: "Shërbimi i vjetër" },
      { service_id: "another" },
      "Europe/Tirane",
      "Shërbimi i ri",
    );
    expect(preview.fields).toEqual([
      {
        label: "Shërbimi",
        before: "Shërbimi i vjetër",
        after: "Shërbimi i ri",
      },
    ]);
  });
});

it("allows only reviewed instruction changes for an existing AI agent", () => {
  const changes = [
    { field: "instructions", value: "Përgjigju shkurt. Mos shpik çmime." },
  ];
  const p = readProposal({
    action: "agent_update",
    id,
    message: "Kontrollo udhëzimet.",
    changes,
  });
  expect(
    valuesFor(p, { name: "Shitjet", is_active: true }, "Europe/Tirane"),
  ).toEqual({ instructions: changes[0].value });
  expect(() =>
    readProposal({ ...p, changes: [{ field: "is_active", value: "true" }] }),
  ).toThrow();
  expect(() => readProposal({ ...p, id: null })).toThrow();
  expect(() =>
    valuesFor(
      { ...p, changes: [{ field: "instructions", value: "" }] },
      {},
      "Europe/Tirane",
    ),
  ).toThrow();
});
