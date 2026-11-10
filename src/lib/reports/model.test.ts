import { expect, it } from "vitest";
import { groupDigits, reportRange, shortDate, summarize, type ReportDay } from "./model";

const day = (d: string, inbound: number): ReportDay => ({ day: d, inbound, aiReplies: 0, orders: 0, bookings: 0, customers: 0 });

it("sums the current period and compares it with the one before", () => {
  const days = [day("2026-11-01", 2), day("2026-11-02", 2), day("2026-11-03", 5), day("2026-11-04", 1)];
  const summary = summarize(days, 2, "inbound");
  expect(summary.total).toBe(6);
  expect(summary.previous).toBe(4);
  expect(summary.change).toBe(50);
  expect(summary.days.map((d) => d.day)).toEqual(["2026-11-03", "2026-11-04"]);
});

it("has no change when the period before was empty", () => {
  expect(summarize([day("2026-11-01", 0), day("2026-11-02", 3)], 1, "inbound").change).toBeNull();
});

it("accepts only the offered ranges", () => {
  expect(reportRange("7")).toBe(7);
  expect(reportRange("90")).toBe(90);
  expect(reportRange("365")).toBe(30);
  expect(reportRange(undefined)).toBe(30);
});

it("formats dates and numbers without locale data", () => {
  expect(shortDate("2026-11-09")).toBe("09.11");
  expect(groupDigits(40414)).toBe("40 414");
  expect(groupDigits(999)).toBe("999");
});
