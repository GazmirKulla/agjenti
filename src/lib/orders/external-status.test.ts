import { expect, it, vi } from "vitest";
import { readExternalStatus, recordExternalStatus } from "./external-status";

const now = new Date("2026-11-17T10:00:00Z");

it("reads a website status with its name, keeping a past time and refusing unsafe keys", () => {
  expect(readExternalStatus({ status: "in_printing", statusLabel: " Në printim ", changedAt: "2026-11-17T09:00:00Z" }, now))
    .toEqual({ status: "in_printing", label: "Në printim", at: "2026-11-17T09:00:00.000Z" });
  expect(readExternalStatus({ status: "ready" }, now)).toEqual({ status: "ready", label: "ready", at: now.toISOString() });
  // A time far in the future would block later notices: the arrival time is kept instead.
  expect(readExternalStatus({ status: "ready", changedAt: "2030-01-01T00:00:00Z" }, now)?.at).toBe(now.toISOString());
  expect(readExternalStatus({ status: "drop table" }, now)).toBeNull();
  expect(readExternalStatus({ status: 5 }, now)).toBeNull();
});

it("writes only this business's order sent to the website, and never over a newer status", async () => {
  const calls: unknown[][] = [];
  const query = {
    update: (...args: unknown[]) => (calls.push(["update", ...args]), query),
    eq: (...args: unknown[]) => (calls.push(["eq", ...args]), query),
    or: (...args: unknown[]) => (calls.push(["or", ...args]), query),
    select: vi.fn(async () => ({ data: [{ id: "o1" }], error: null })),
  };
  const db = { from: () => query } as never;
  expect(await recordExternalStatus(db, "biz", "ord_1", { status: "ready", label: "E printuar", at: "2026-11-17T09:00:00.000Z" })).toBe(true);
  expect(calls).toContainEqual(["eq", "business_id", "biz"]);
  expect(calls).toContainEqual(["eq", "external_system", "external"]);
  expect(calls).toContainEqual(["eq", "external_order_id", "ord_1"]);
  expect(calls).toContainEqual(["or", "external_status_at.is.null,external_status_at.lte.2026-11-17T09:00:00.000Z"]);
  query.select.mockResolvedValueOnce({ data: [], error: null });
  expect(await recordExternalStatus(db, "biz", "ord_1", { status: "ready", label: "E printuar", at: "2026-11-17T08:00:00.000Z" })).toBe(false);
});
