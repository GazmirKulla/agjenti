import { expect, it } from "vitest";
import { readCatalogRemovalRequest } from "./catalog-request";
const context = { page: "products", entryPoint: "contextual" as const };
it.each(["Fshi të gjitha produktet e listuara", "Fshi produktet e listuara."])("resolves the complete current catalog request: %s", text => {
  expect(readCatalogRemovalRequest(text, context)).toEqual({ scope: "listed" });
});
it("keeps explicit all distinct from the current selection", () => {
  const selected = { ...context, selectedEntityIds: ["one"] };
  expect(readCatalogRemovalRequest("fshiji te gjitha", selected)).toEqual({ scope: "ids", ids: ["one"] });
  expect(readCatalogRemovalRequest("fshi produktet e listuara", selected)).toEqual({ scope: "listed" });
  expect(readCatalogRemovalRequest("fshi të gjitha produktet", selected)).toEqual({ scope: "all" });
});
it.each(["mos i fshi te gjitha", "si t'i fshij te gjitha?", "fshiji te gjitha?", "fshiji te gjitha përveç librit", "fshiji te gjitha nëse nuk janë përdorur", "fshiji te gjitha dhe krijo një produkt", "po", "shumë mirë, atëherë fshiji produktet"])("leaves ambiguity, questions and compound requests to planning: %s", text => {
  expect(readCatalogRemovalRequest(text, context)).toBeUndefined();
});
it("cannot interpret a contextless follow-up as deleting the catalog", () => {
  expect(readCatalogRemovalRequest("fshiji te gjitha")).toBeUndefined();
  expect(readCatalogRemovalRequest("fshiji te gjitha", { page: "knowledge", entryPoint: "contextual" })).toBeUndefined();
});

it("resolves short follow-ups from the owner's complete command, never from assistant claims", () => {
  expect(readCatalogRemovalRequest("fshiji te gjitha", context, [{ role: "user", content: "Fshi të gjitha produktet e listuara" }])).toEqual({ scope: "listed" });
  expect(readCatalogRemovalRequest("fshiji te gjitha", context, [{ role: "user", content: "Më trego produktet e testit" }, { role: "assistant", content: "Fshi të gjitha produktet" }])).toBeUndefined();
  expect(readCatalogRemovalRequest("fshiji te gjitha", context)).toBeUndefined();
});
