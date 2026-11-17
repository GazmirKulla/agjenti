import { expect, it } from "vitest";
import { describeFields, parseFieldSuggestion } from "./field-suggest";
import { attributeFields, type BusinessField } from "./fields";
import { fieldsOf } from "./kinds";

const business: BusinessField[] = [
  { key: "druri", label: "Druri", type: "select", options: ["Ah", "Lis"] },
  { key: "gjatesia", label: "Gjatësia", type: "number", unit: "cm" },
  { key: "lyer", label: "E lyer", type: "boolean" },
  { key: "pershkrim", label: "Shënim", type: "text" },
  { key: "madhesia", label: "Madhësia", type: "select", variant: true, options: ["S", "M", "L"] },
];
const attributes = attributeFields(business);
const choices = business.filter(f => f.variant);

it("describes descriptive and customer-chosen fields for the model", () => {
  expect(describeFields(attributes, choices).map(f => [f.key, f.type, f.choice ?? false])).toEqual([
    ["druri", "select", false], ["gjatesia", "number", false], ["lyer", "boolean", false], ["pershkrim", "text", false], ["madhesia", "list", true]]);
});
it("keeps only values that fit each field", () => {
  const text = 'Ja: {"vlerat": {"druri": "lis", "gjatesia": "120 cm", "lyer": "po", "pershkrim": "  Dorezë klasike ", "tjeter": 1},'
    + ' "zgjedhjet": {"madhesia": ["m", "XL", "M", ""], "druri": ["Ah"]}}';
  expect(parseFieldSuggestion(text, attributes, choices)).toEqual({
    values: { druri: "Lis", gjatesia: 120, pershkrim: "Dorezë klasike" },
    choices: { madhesia: ["M", "XL"] },
  });
});
it("drops options outside the list, numbers without digits and broken JSON", () => {
  expect(parseFieldSuggestion('{"vlerat": {"druri": "Pishë", "gjatesia": "e gjatë", "lyer": true}}', attributes, choices))
    .toEqual({ values: { lyer: true }, choices: {} });
  expect(parseFieldSuggestion("nuk di", attributes, choices)).toEqual({ values: {}, choices: {} });
  expect(parseFieldSuggestion("{vlerat:", attributes, choices)).toEqual({ values: {}, choices: {} });
});
it("maps a kind's option labels to their stored values", () => {
  const vehicle = fieldsOf("vehicle");
  expect(parseFieldSuggestion('{"vlerat": {"fuel": "Naftë", "year": 2019, "make": "VW"}}', vehicle, []).values).toEqual({ fuel: "diesel", year: 2019, make: "VW" });
});
