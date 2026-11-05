import { expect, it } from "vitest";
import { validFieldCandidate } from "./field-candidates";

it("validates model-extracted values against server types, options and field ownership", () => {
  expect(validFieldCandidate({ key: "quantity", type: "number" }, "2")).toBe(true);
  expect(validFieldCandidate({ key: "quantity", type: "number" }, "many")).toBe(false);
  expect(validFieldCandidate({ key: "size", type: "text", options: ["S", "M"] }, "M")).toBe(true);
  expect(validFieldCandidate({ key: "size", type: "text", options: ["S", "M"] }, "L")).toBe(false);
  expect(validFieldCandidate({ key: "contact", type: "email" }, "wrong")).toBe(false);
  expect(validFieldCandidate({ key: "constructor", type: "text" }, "bad")).toBe(false);
  expect(validFieldCandidate({ key: "photo", type: "photo" }, "photo_received")).toBe(false);
  expect(validFieldCandidate({ key: "description", type: "text", maxLength: 3 }, "long")).toBe(false);
});
