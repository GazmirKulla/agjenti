import { describe, expect, it } from "vitest";
import { briefingAnswer, briefingQuestion, briefingSummary, reportingRange, type Briefing } from "./briefing-model";

describe("reporting calendar", () => {
  it("uses business dates across UTC boundaries, yesterday and Monday-based current week", () => {
    const now = new Date("2026-10-19T22:30:00Z");
    expect(reportingRange("today", "Europe/Tirane", now)).toEqual({
      from: "2026-10-19T22:00:00.000Z", to: "2026-10-20T22:00:00.000Z", startDate: "2026-10-20", endDate: "2026-10-20",
    });
    expect(reportingRange("yesterday", "Europe/Tirane", now).startDate).toBe("2026-10-19");
    expect(reportingRange("week", "Europe/Tirane", now)).toMatchObject({ startDate: "2026-10-19", endDate: "2026-10-20" });
    expect(reportingRange("week", "UTC", new Date("2026-10-18T15:00Z")).startDate).toBe("2026-10-12");
    expect(reportingRange("today", "America/Los_Angeles", new Date("2026-10-20T01:00Z")).startDate).toBe("2026-10-19");
  });
  it.each([["2026-03-29T16:00Z", 23], ["2026-10-25T16:00Z", 25]])("handles DST at %s (%s hours)", (date, hours) => {
    const range = reportingRange("today", "Europe/Tirane", new Date(date));
    expect((Date.parse(range.to) - Date.parse(range.from)) / 3600000).toBe(hours);
  });
  it("handles a skipped midnight without inventing a UTC day", () => {
    const range = reportingRange("today", "America/Santiago", new Date("2026-09-06T16:00Z"));
    expect(range.from).toBe("2026-09-06T04:00:00.000Z");
    expect((Date.parse(range.to) - Date.parse(range.from)) / 3600000).toBe(23);
  });
  it.each(["", "not/a-timezone"])("fails closed for invalid timezone %s", zone =>
    expect(() => reportingRange("today", zone, new Date())).toThrow());
});
describe("read-only questions", () => {
  it.each([
    ["Çfarë ndodhi sot në biznes?", "today"], ["Sa mesazhe morëm sot?", "today"],
    ["Sa porosi kemi dje?", "yesterday"], ["Më jep përmbledhjen e javës.", "week"],
    ["Show me the business summary for this week", "week"], ["How many orders yesterday?", "yesterday"],
  ])("recognizes %s without a model", (text, period) => expect(briefingQuestion(text)).toBe(period));
  it.each(["Krijo një porosi sot", "Sa porosi kemi sot dhe dje?", "Sa porosi sot dhe krijo një produkt", "Compare orders today", "Sa të ardhura kemi sot?"])(
    "does not consume unsupported or mutating requests: %s", text => expect(briefingQuestion(text)).toBeNull(),
  );
});
it("formats exact verified numbers, distinguishes zero/unavailable/disabled and does not invent trends", () => {
  const reading = { status: "available" as const, count: 0, checkedAt: "2026-10-20T12:00Z", href: "/b/test/inbox" };
  const data: Briefing = { businessId: "b", businessName: "Test", timezone: "UTC", generatedAt: reading.checkedAt, recordedBefore: reading.checkedAt,
    period: "today", range: reportingRange("today", "UTC", new Date(reading.checkedAt)),
    metrics: { messages: { ...reading, count: 17 }, orders: reading, customers: { ...reading, status: "unavailable", count: null }, bookings: { ...reading, status: "disabled", count: null } },
    attention: { handoffs: reading, integrationFailures: reading }, unavailableMetrics: ["customers"] };
  expect(briefingAnswer(data, "en")).toContain("Incoming messages: 17");
  expect(briefingAnswer(data, "sq")).toContain("Porosi të krijuara: 0");
  expect(briefingAnswer(data, "en")).toContain("New CRM customers: Currently unavailable");
  expect(briefingAnswer(data, "en")).toContain("Bookings created: The module is not enabled or authorized.");
  expect(briefingSummary(data, "sq")).toContain("pjesshme");
  data.configurationError = "timezone_invalid";
  expect(briefingSummary(data, "en")).toContain("timezone is invalid");
});
