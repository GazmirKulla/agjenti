import { expect, it } from "vitest";
import { added, homePeriod, homeRange, money } from "./model";

it("reads the period from the address, today by default", () => {
  expect(homePeriod("7")).toBe("7");
  expect(homePeriod("30")).toBe("30");
  expect(homePeriod("90")).toBe("today");
  expect(homePeriod(undefined)).toBe("today");
});

it("counts from the start of the first day in the business's time", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  const today = homeRange("today", "Europe/Tirane", now);
  expect(today.from).toBe("2026-11-11T23:00:00.000Z");
  expect(today.tomorrowFrom).toBe("2026-11-12T23:00:00.000Z");
  expect(homeRange("7", "Europe/Tirane", now).from).toBe("2026-11-05T23:00:00.000Z");
});

it("writes added counts and money only when there is something", () => {
  expect(added(3, "të reja")).toBe("+3 të reja");
  expect(added(0, "të reja")).toBeUndefined();
  expect(money([{ total_amount: 120, currency: "EUR" }, { total_amount: "64.4", currency: "eur" }, { total_amount: null, currency: "EUR" }, { total_amount: 20, currency: "USD" }]))
    .toBe("184 € · 20 USD");
  expect(money([])).toBe("");
});
