import { expect, it } from "vitest";
import { expandBookingManage } from "./booking-manage-definition";
import { reviewLines } from "./review-summary";
import type { Fact, Value } from "./contracts";

it("shows the customer only the booking and the new time when they review a change, never its internals", () => {
  const { fields, steps } = expandBookingManage("manage", "end");
  const key = (name: string) => fields.find(f => f.id.endsWith(`_${name}`))!.id;
  const values: Record<string, Value> = { action: "reschedule", bookingId: "0b2509b6-b7ab-4fee-90ff-541b285b917b", serviceId: "6bd06514-729c-4f15-bfe7-46795b360fd3",
    serviceName: "Konsulencë për fëmijë", startsAt: "2026-11-27 11:00", status: "confirmed", bookingRevision: 2, date: "2026-11-27", time: "12:00" };
  const facts = Object.fromEntries(Object.entries(values).map(([name, value]) => [key(name), { value } as Fact]));
  const move = steps.find(s => s.kind === "confirm" && s.fieldIds.includes(key("date")));
  const lines = reviewLines(move!.kind === "confirm" ? move!.fieldIds : [], fields, facts);
  expect(lines.map(l => l.value)).toEqual(["Konsulencë për fëmijë", "2026-11-27 11:00", "2026-11-27", "12:00"]);
  expect(JSON.stringify(lines)).not.toMatch(/0b2509b6|6bd06514|reschedule|confirmed/);
});
