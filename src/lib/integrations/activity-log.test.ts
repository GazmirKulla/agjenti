import { expect, it } from "vitest";
import { describeIntegrationLog, formatActivityRange, groupIntegrationLogs } from "./activity-log";

const row = (id: string, target: string, status: string, created_at: string, error: string | null = null) => ({ id, target, status, error, created_at });

it("names known integration calls and keeps unknown ones verbatim", () => {
  expect(describeIntegrationLog({ target: "orders", status: "ok" })).toEqual({ ok: true, label: "Porosia u dërgua në faqe" });
  expect(describeIntegrationLog({ target: "orders", status: "failed" })).toEqual({ ok: false, label: "Porosia nuk u dërgua në faqe" });
  expect(describeIntegrationLog({ target: "meta", status: "unknown_account" })).toEqual({ ok: false, label: "meta · unknown_account" });
});

it("groups only consecutive identical outcomes", () => {
  const grouped = groupIntegrationLogs([
    row("1", "orders", "ok", "2026-11-24T12:00:00Z"),
    row("2", "orders", "ok", "2026-11-24T11:00:00Z"),
    row("3", "orders", "failed", "2026-11-24T10:00:00Z", "http_500"),
    row("4", "orders", "ok", "2026-11-24T09:00:00Z"),
  ]);
  expect(grouped.map(e => [e.id, e.count, e.ok, e.latest, e.earliest])).toEqual([
    ["1", 2, true, "2026-11-24T12:00:00Z", "2026-11-24T11:00:00Z"],
    ["3", 1, false, "2026-11-24T10:00:00Z", "2026-11-24T10:00:00Z"],
    ["4", 1, true, "2026-11-24T09:00:00Z", "2026-11-24T09:00:00Z"],
  ]);
});

it("writes the day once when a range stays within one Tirana day", () => {
  expect(formatActivityRange("2026-11-24T08:12:00Z", "2026-11-24T13:32:00Z")).toMatch(/^24 .+09:12 – 14:32$/);
  expect(formatActivityRange("2026-11-23T08:12:00Z", "2026-11-24T13:32:00Z")).toMatch(/^23 .+ – 24 .+14:32$/);
  expect(formatActivityRange("2026-11-24T08:12:00Z", "2026-11-24T08:12:00Z")).not.toContain("–");
});
