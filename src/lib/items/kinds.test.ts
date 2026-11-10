import { expect, it } from "vitest";
import { attributeSummary, itemKind, itemNames, itemTitles, kindForCategory, parseAttributes, parseAvailability } from "./kinds";

const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.set(k, v); return f; };

it("starts real estate businesses with listings and keeps plain products elsewhere", () => {
  expect(kindForCategory("realestate")).toBe("property");
  expect(kindForCategory("retail")).toBe("product");
  expect(itemKind("unknown").id).toBe("product");
});

it("lets the owner's own words win over the kind's names and titles", () => {
  expect(itemNames("property")).toEqual({ plural: "Listimet", singular: "listim" });
  expect(itemNames("property", { plural: "Pronat", singular: "pronë" })).toEqual({ plural: "Pronat", singular: "pronë" });
  expect(itemTitles("equipment").create).toBe("Shto pajisje të re");
  expect(itemTitles("property", { singular: "pronë" }).create).toBe("Shto: pronë");
});

it("reads only the kind's own fields, typed and validated", () => {
  const parsed = parseAttributes("property", form({ attr_deal: "rent", attr_size_m2: "85,5", attr_furnished: "on", attr_city: " Durrës ", attr_hack: "x" }));
  expect(parsed).toEqual({ attributes: { deal: "rent", size_m2: 85.5, furnished: true, city: "Durrës" } });
  expect(parseAttributes("property", form({ attr_deal: "gift" })).error).toMatch(/Shitje apo qira/);
  expect(parseAttributes("vehicle", form({ attr_year: "abc" })).error).toMatch(/Viti/);
});

it("keeps availability to what the kind allows", () => {
  expect(parseAvailability("product", "rented")).toBe("available");
  expect(parseAvailability("property", "rented")).toBe("rented");
});

it("summarizes the fields marked for lists", () => {
  expect(attributeSummary("property", { deal: "sale", property_type: "apartment", city: "Tiranë", size_m2: 1200, rooms: "3+1", floor: 4 }))
    .toBe("Shitje · Apartament · Tiranë · 1 200 m² · 3+1");
  expect(attributeSummary("product", { anything: 1 })).toBe("");
});
