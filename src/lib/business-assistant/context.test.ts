import { expect, it } from "vitest";
import {
  parseUIContext,
  contextFromPath,
  assistantSuggestions,
} from "./context";
const id = "11111111-1111-4111-8111-111111111111";
it("recognizes an open product but never treats new/imports as entity IDs", () => {
  expect(contextFromPath(`/b/demo/products/${id}`, "demo")).toEqual({
    page: "products",
    entryPoint: "contextual",
    entityType: "product",
    entityId: id,
  });
  expect(
    contextFromPath("/b/demo/products/new", "demo").entityId,
  ).toBeUndefined();
  expect(
    contextFromPath("/b/demo/products/imports", "demo").entityId,
  ).toBeUndefined();
});
it("rejects malformed or mismatched selections and drops client authority fields", () => {
  expect(() =>
    parseUIContext({
      page: "products",
      entryPoint: "contextual",
      entityType: "booking",
      entityId: id,
    }),
  ).toThrow();
  expect(() =>
    parseUIContext({
      page: "products",
      entryPoint: "contextual",
      entityType: "product",
      entityId: "forged",
    }),
  ).toThrow();
  expect(
    parseUIContext({
      page: "home",
      entryPoint: "home",
      businessId: "forged",
      modules: ["products"],
    }),
  ).toEqual({ page: "home", entryPoint: "home" });
});
it("advertises only available actions for the current page and catalog source", () => {
  expect(
    assistantSuggestions({ page: "orders", entryPoint: "contextual" }, [
      "orders",
    ]),
  ).toEqual([]);
  expect(
    assistantSuggestions(
      { page: "products", entryPoint: "contextual" },
      ["products"],
      true,
    ),
  ).toEqual([]);
  expect(
    assistantSuggestions({ page: "home", entryPoint: "home" }, [
      "services",
    ]).map((s) => s.label),
  ).toEqual(["Shto shërbim"]);
  expect(
    assistantSuggestions({ page: "workflows", entryPoint: "contextual" }, [
      "workflows",
    ]).map((s) => s.label),
  ).toEqual([
    "Shiko rrjedhën",
    "Përshtat hapat",
    "Provoje si klient",
    "Publiko draftin",
  ]);
  expect(
    assistantSuggestions({ page: "home", entryPoint: "home" }, [
      "workflows",
      "services",
    ]).map((s) => s.label),
  ).toEqual(["Shiko rrjedhën", "Përshtat hapat", "Shto shërbim"]);
});
it("carries bounded catalog context and resolves a single checked product", () => {
  expect(
    parseUIContext({
      page: "products",
      entryPoint: "contextual",
      selectedEntityIds: [id],
      searchQuery: "barrier",
      filters: { status: "draft", forged: "ignored" },
    }),
  ).toMatchObject({
    entityType: "product",
    entityId: id,
    filters: { status: "draft" },
    searchQuery: "barrier",
  });
  expect(() =>
    parseUIContext({
      page: "products",
      entryPoint: "contextual",
      selectedEntityIds: Array(21).fill(id),
    }),
  ).toThrow();
  expect(() =>
    parseUIContext({
      page: "products",
      entryPoint: "contextual",
      filters: { status: "forged" },
    }),
  ).toThrow();
});
