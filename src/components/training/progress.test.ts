import { describe, expect, it } from "vitest";
import { stepOf, timeLeft } from "./progress";

const start = "2026-11-15T10:00:00.000Z";
const at = (minutes: number) => Date.parse(start) + minutes * 60_000;

describe("import progress", () => {
  it("estimates the rest of the step from its pace so far", () => {
    expect(timeLeft({ done: 10, total: 40, stageStartedAt: start }, at(5))).toBe("rreth 15 minuta për këtë hap");
    expect(timeLeft({ done: 39, total: 40, stageStartedAt: start }, at(5))).toBe("rreth 1 minutë për këtë hap");
  });

  it("says nothing it cannot know", () => {
    expect(timeLeft({ done: 0, total: 40, stageStartedAt: start }, at(5))).toBe("");
    expect(timeLeft({ done: 10, total: 40 }, at(5))).toBe("");
    expect(timeLeft({ done: 40, total: 40, stageStartedAt: start }, at(5))).toBe("");
    expect(timeLeft({ done: 10, total: 35, stageStartedAt: start, open: true }, at(5))).toBe("");
  });

  it("numbers the steps the owner sees", () => {
    expect(stepOf({ stage: "count", source: "instagram_export" })).toBe("Hapi 1 nga 5");
    expect(stepOf({ stage: "extract", source: "instagram_export" })).toBe("Hapi 3 nga 5");
    expect(stepOf({ stage: "ingest", source: "inbox" })).toBe("Hapi 1 nga 6");
    expect(stepOf({ stage: "extract", source: "inbox" })).toBe("Hapi 4 nga 6");
    expect(stepOf({ stage: "history", source: "inbox", historyOnly: true })).toBe("");
  });
});
