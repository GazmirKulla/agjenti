import { expect, it } from "vitest";
import { parseService } from "./model";
import { slotCandidates, defaultSettings } from "@/lib/calendar/model";
function input(values: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    name: "Konsultë online",
    currency: "EUR",
    priceMode: "request",
    active: "on",
    ...values,
  }))
    f.set(k, v);
  return f;
}
it("creates informational services without requiring appointment fields", () => {
  const service = parseService(input());
  expect(service.booking_enabled).toBe(false);
  expect(service.hours).toBeNull();
  expect(service.price_amount).toBeNull();
  expect(
    slotCandidates(
      "2026-10-15",
      { id: "service", ...service },
      defaultSettings,
      0,
    ),
  ).toEqual([]);
});
it("validates priced services without inventing a price", () => {
  expect(() => parseService(input({ priceMode: "fixed" }))).toThrow("çmim");
  expect(() =>
    parseService(input({ priceMode: "fixed", price: "-1" })),
  ).toThrow();
  expect(() =>
    parseService(input({ priceMode: "from", price: "12.345" })),
  ).toThrow();
  expect(
    parseService(input({ priceMode: "from", price: "20.50" })),
  ).toMatchObject({ price_amount: 20.5, price_mode: "from" });
});
it("requires duration and a valid custom schedule only when booking is enabled", () => {
  expect(() =>
    parseService(input({ bookingEnabled: "on", duration: "0", buffer: "0" })),
  ).toThrow("Kohëzgjatja");
  expect(() =>
    parseService(
      input({
        bookingEnabled: "on",
        duration: "30",
        buffer: "15",
        customHours: "on",
        hours: "[]",
      }),
    ),
  ).toThrow("interval");
  expect(() =>
    parseService(
      input({
        bookingEnabled: "on",
        duration: "30",
        buffer: "15",
        customHours: "on",
        hours: JSON.stringify([
          { day: 4, start: "10:00", end: "12:00" },
          { day: 4, start: "11:00", end: "13:00" },
        ]),
      }),
    ),
  ).toThrow("mbivendosen");
});
it("intersects the service hours with business hours and includes the buffer", () => {
  const service = parseService(
    input({
      bookingEnabled: "on",
      duration: "30",
      buffer: "15",
      customHours: "on",
      hours: JSON.stringify([{ day: 4, start: "10:00", end: "11:00" }]),
    }),
  );
  const slots = slotCandidates(
    "2026-10-15",
    { id: "service", ...service },
    { ...defaultSettings, timezone: "UTC" },
    0,
  );
  expect(slots.map((s) => s.start)).toEqual([
    "2026-10-15T10:00:00.000Z",
    "2026-10-15T10:15:00.000Z",
  ]);
  expect(
    slotCandidates(
      "2026-10-16",
      { id: "service", ...service },
      { ...defaultSettings, timezone: "UTC" },
      0,
    ),
  ).toEqual([]);
  expect(
    slotCandidates(
      "2026-10-15",
      { id: "service", ...service },
      { ...defaultSettings, timezone: "UTC", closed_dates: ["2026-10-15"] },
      0,
    ),
  ).toEqual([]);
});
