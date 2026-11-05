import { expect, it } from "vitest";
import { readActivitySteps } from "./activity-steps";

it("shows legacy previews and preserves receipt identities", () => {
  expect(readActivitySteps([{ version: 1, requestId: "receipt-1", preview: { title: "Arkivo", subject: "Produkt" } }]))
    .toEqual({ version: 1, steps: [{ requestId: "receipt-1", title: "Arkivo", subject: "Produkt" }] });
});

it("shows both prepared and dependent configuration steps without a top-level preview", () => {
  const result = readActivitySteps([
    { version: 2, requestId: "first", definition: { key: "knowledge.save" }, prepared: { preview: { title: "Ruaj", subject: "Orari" } } },
    { version: 2, requestId: "next", definition: { key: "business.verify" } },
  ]);
  expect(result).toEqual({ version: 2, steps: [
    { requestId: "first", title: "Ruaj", subject: "Orari" },
    { requestId: "next", title: "Verifiko konfigurimin", subject: undefined },
  ] });
});

it("reports unreadable and mixed formats without crashing or enabling legacy resume", () => {
  for (const value of [null, {}, [], [null], [{ version: 1, requestId: "a" }],
    [{ version: 2, requestId: "a", definition: { key: "unknown" } }],
    [{ version: 1, requestId: "a", preview: { title: "A" } }, { version: 2, requestId: "b" }]]) {
    expect(readActivitySteps(value)).toBeNull();
  }
});
