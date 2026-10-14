import { expect, it } from "vitest";
import { authNext } from "./next";
it("allows only the exact mobile continuation route", () => {
  expect(authNext("/auth/mobile/continue")).toBe("/auth/mobile/continue");
  expect(authNext("/auth/mobile/continue?next=https://other.test")).toBe("/auth/continue");
  expect(authNext("//other.test/auth/mobile/continue")).toBe("/auth/continue");
});
