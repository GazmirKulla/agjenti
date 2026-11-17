import { expect, it } from "vitest";
import { fieldTemplateFor, missingTemplateFields } from "./field-templates";
import { parseBusinessFields, readBusinessFields } from "./fields";
import { businessCategories, legacyBusinessCategories } from "@/lib/onboarding/categories";
import { kindInUse, profileCategory } from "./kinds";

it("suggests fields for product categories and none where the kind has its own", () => {
  expect(fieldTemplateFor("fashion").map(f => f.key)).toEqual(["madhesia", "ngjyra", "materiali", "per", "marka"]);
  expect(fieldTemplateFor("automotive")).toEqual([]);
  expect(fieldTemplateFor("realestate")).toEqual([]);
  expect(fieldTemplateFor("healthcare")).toEqual([]);
  expect(fieldTemplateFor(null)).toEqual([]);
});

it("every template is valid as stored and as submitted by the owner", () => {
  for (const [id] of [...businessCategories, ...legacyBusinessCategories]) {
    const fields = fieldTemplateFor(id);
    expect(readBusinessFields(fields)).toEqual(fields);
    const parsed = parseBusinessFields(fields);
    expect("fields" in parsed && parsed.fields).toEqual(fields);
  }
});

it("lists only the suggestions the business does not have, by key or by name", () => {
  const missing = missingTemplateFields(fieldTemplateFor("fashion"), [{ key: "madhesia", label: "Madhësia" }, { key: "x", label: "ngjyra" }]);
  expect(missing.map(f => f.key)).toEqual(["materiali", "per", "marka"]);
});

it("uses the onboarding category's kind when the owner has not chosen one", () => {
  const profile = { signals: { businessType: "automotive" } };
  expect(profileCategory(profile)).toBe("automotive");
  expect(kindInUse(null, profileCategory(profile)).id).toBe("vehicle");
  expect(kindInUse("property", "automotive").id).toBe("property");
  // A field named like one of the kind's own keys gets a key of its own, so it is not hidden.
  const parsed = parseBusinessFields([{ label: "Model" }], kindInUse(null, "automotive").fields.map(f => f.key));
  expect("fields" in parsed && parsed.fields[0].key).toBe("model_2");
});
