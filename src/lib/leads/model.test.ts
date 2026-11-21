import { expect, it } from "vitest";
import { followUpHours, leadFilter } from "./model";

it("reads the owner's follow-up time, falling back to four hours", () => {
  expect(followUpHours(null)).toBe(4);
  expect(followUpHours({ followUpHours: 24 })).toBe(24);
  expect(followUpHours({ followUpHours: 7 })).toBe(4);
});

it("accepts only the known lead filters for Bisedat", () => {
  expect(leadFilter("open")).toBe("open");
  expect(leadFilter("waiting")).toBe("waiting");
  expect(leadFilter("anything")).toBeNull();
  expect(leadFilter(undefined)).toBeNull();
});
