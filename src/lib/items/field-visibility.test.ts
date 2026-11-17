import { expect, it } from "vitest";
import { fieldUsage, shownFieldKeys } from "./field-visibility";

const fields = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `f${i}` }));

it("shows every field while the business has only a few", () => {
  expect([...shownFieldKeys(fields(6), {}, { counts: {}, total: 50 })]).toEqual(["f0", "f1", "f2", "f3", "f4", "f5"]);
});
it("with many fields shows the product's own values and the fields most products use", () => {
  const usage = fieldUsage([
    { attributes: { f0: "a", f9: 2 } }, { attributes: { f0: "b", f9: 0 } }, { attributes: { f0: "", f1: false, f2: [] } }, { attributes: null },
  ]);
  expect(usage).toEqual({ counts: { f0: 2, f9: 2 }, total: 4 });
  expect([...shownFieldKeys(fields(10), { f4: "x", f5: "" }, usage)].sort()).toEqual(["f0", "f4", "f9"]);
});
it("before there are products to learn from, shows the first fields plus any with a value", () => {
  expect([...shownFieldKeys(fields(10), { f8: true }, { counts: {}, total: 1 })].sort()).toEqual(["f0", "f1", "f2", "f3", "f4", "f5", "f8"]);
});
