import { expect, it } from "vitest";
import { messageDate } from "./message-date";
it("separates days at Tirana midnight, not UTC midnight", () => {
 expect(messageDate("2026-11-04T22:59:00Z", "en-GB")).toMatchObject({day:"2026-11-04",time:"23:59"});
 expect(messageDate("2026-11-04T23:00:00Z", "en-GB")).toMatchObject({day:"2026-11-05",time:"00:00",label:"5 November 2026"});
});
it("handles summer time and keeps the year visible", () => {
 expect(messageDate("2026-06-01T22:00:00Z", "sq-AL")).toMatchObject({day:"2026-06-02",time:"00:00"});
 expect(messageDate("2025-11-04T23:00:00Z", "en-GB").full).toBe("5 November 2025, 00:00");
});
