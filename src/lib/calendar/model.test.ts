import { describe, it, expect } from "vitest";
import {
  defaultSettings,
  localInstant,
  overlaps,
  parseSettings,
  slotCandidates,
  validDate,
} from "./model";
const service = {
  id: "service",
  name: "Haircut",
  duration_minutes: 30,
  buffer_minutes: 15,
  is_active: true,
};
describe("appointment availability", () => {
  it("converts business wall time and rejects DST gaps/ambiguity", () => {
    expect(localInstant("2026-10-15", "09:00", "Europe/Tirane")).toBe(
      "2026-10-15T07:00:00.000Z",
    );
    expect(() =>
      localInstant("2026-03-29", "02:30", "Europe/Tirane"),
    ).toThrow();
    expect(() =>
      localInstant("2026-10-25", "02:30", "Europe/Tirane"),
    ).toThrow();
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2026-99-99")).toBe(false);
  });
  it("fits duration and buffer inside working hours", () => {
    const slots = slotCandidates(
      "2026-10-15",
      service,
      { ...defaultSettings, hours: [{ day: 4, start: "09:00", end: "10:00" }] },
      0,
    );
    expect(slots).toHaveLength(2);
    expect(slots.at(-1)?.blockedUntil).toBe("2026-10-15T08:00:00.000Z");
  });
  it("respects split shifts, closed dates and elapsed slots", () => {
    const cfg = {
      ...defaultSettings,
      hours: [
        { day: 4, start: "09:00", end: "10:00" },
        { day: 4, start: "13:00", end: "14:00" },
      ],
    };
    expect(
      slotCandidates(
        "2026-10-15",
        service,
        cfg,
        Date.parse("2026-10-15T10:00Z"),
      ),
    ).toHaveLength(2);
    expect(
      slotCandidates(
        "2026-10-15",
        service,
        { ...cfg, closed_dates: ["2026-10-15"] },
        0,
      ),
    ).toEqual([]);
  });
  it("allows adjacent bookings and treats buffer as busy", () => {
    expect(
      overlaps(
        "2026-10-15T09:00Z",
        "2026-10-15T09:45Z",
        "2026-10-15T09:30Z",
        "2026-10-15T10:00Z",
      ),
    ).toBe(true);
    expect(
      overlaps(
        "2026-10-15T09:00Z",
        "2026-10-15T09:45Z",
        "2026-10-15T09:45Z",
        "2026-10-15T10:00Z",
      ),
    ).toBe(false);
  });
  it("rejects overlapping shifts and invalid configuration", () => {
    expect(() =>
      parseSettings({
        ...defaultSettings,
        hours: [
          { day: 1, start: "09:00", end: "12:00" },
          { day: 1, start: "11:00", end: "13:00" },
        ],
      }),
    ).toThrow("mbivendosen");
    expect(() =>
      parseSettings({ ...defaultSettings, timezone: "Not/AZone" }),
    ).toThrow();
  });
});
