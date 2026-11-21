import { expect, it } from "vitest";
import { staffChangeKind } from "./notices";

it("tells the customer only about a staff decision they need to know", () => {
  const at = "2026-12-04T09:00:00Z";
  expect(staffChangeKind({ status: "pending", starts_at: at }, { status: "confirmed", starts_at: at })).toBe("confirmed");
  expect(staffChangeKind({ status: "confirmed", starts_at: at }, { status: "cancelled", starts_at: at })).toBe("cancelled");
  expect(staffChangeKind({ status: "confirmed", starts_at: at }, { status: "confirmed", starts_at: "2026-12-04T10:00:00Z" })).toBe("moved");
  // Same time in another format, a notes-only edit, a new booking or an already cancelled one: nothing to say.
  expect(staffChangeKind({ status: "confirmed", starts_at: at }, { status: "confirmed", starts_at: "2026-12-04T09:00:00+00:00" })).toBeNull();
  expect(staffChangeKind(null, { status: "confirmed", starts_at: at })).toBeNull();
  expect(staffChangeKind({ status: "cancelled", starts_at: at }, { status: "cancelled", starts_at: at })).toBeNull();
});
