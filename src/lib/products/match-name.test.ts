import { expect, it } from "vitest";
import { matchingCatalogNames } from "./match-name";
const catalog = [{ name: "Aktivitetet Montessori" }, { name: "Kafshët dhe Natyra" }];
it.each(["Dua te porosis montesori", "Montessori", "Ckemi\nSi jeni\nDua te porosis montesori\nE keni ne gjendje?"])("recognizes the catalog name in %s", message => {
  expect(matchingCatalogNames(catalog, message)).toEqual([catalog[0]]);
});
it("returns every plausible variant instead of choosing by name length", () => {
 const entries = [{ name: "Montessori 3+" }, { name: "Montessori 5+" }];
 expect(matchingCatalogNames(entries, "dua montesori")).toEqual(entries);
 expect(matchingCatalogNames(entries, "Montessori 5+")).toEqual([entries[1]]);
});
it.each(["Dua te porosis", "E keni ne gjendje?", "M", "Montxyzori"])("does not infer a product from %s", message => {
 expect(matchingCatalogNames(catalog, message)).toEqual([]);
});
it("does not fuzzy match numbers or short names", () => {
 expect(matchingCatalogNames([{ name: "AB123456" }, { name: "Puma" }], "AB123457 Pumo")).toEqual([]);
});

it("2B uses inflection evidence without choosing an equally plausible partial name", () => {
 const entries = [{ name: "Paketa Parashkollore" }, { name: "Kursi Parashkollor" }];
 expect(matchingCatalogNames(entries, "Atëherë dua Paketën Parashkollore. Më ndihmon dot ta porosis?")).toEqual([entries[0]]);
 expect(matchingCatalogNames([{ name: "Paketa" }, { name: "Paketa Plus" }], "Paketën")).toHaveLength(2);
 expect(matchingCatalogNames([{ name: "Konsulta" }, { name: "Konsultim tjetër" }], "Sa zgjat Konsultën?")).toEqual([{ name: "Konsulta" }]);
});
