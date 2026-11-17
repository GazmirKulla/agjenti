import { fieldKey, type BusinessField } from "./fields";
import { kindForCategory } from "./kinds";

type TemplateField = Omit<BusinessField, "key">;

/** Starter product fields for each onboarding category whose items are plain
 * products. Categories with their own item kind (properties, vehicles,
 * equipment) already get the kind's fields, and service categories list
 * services, so they have no template. The owner can change or remove any of
 * these afterwards; they are only a starting point. */
const templates: Record<string, TemplateField[]> = {
  retail: [
    { label: "Marka", type: "text" },
    { label: "Ngjyra", type: "select", variant: true },
    { label: "Madhësia", type: "select", variant: true },
    { label: "Materiali", type: "text" },
  ],
  ecommerce: [
    { label: "Marka", type: "text" },
    { label: "Ngjyra", type: "select", variant: true },
    { label: "Madhësia", type: "select", variant: true },
    { label: "Pesha", type: "number", unit: "kg" },
  ],
  fashion: [
    { label: "Madhësia", type: "select", variant: true, options: ["XS", "S", "M", "L", "XL", "XXL"] },
    { label: "Ngjyra", type: "select", variant: true },
    { label: "Materiali", type: "text" },
    { label: "Për", type: "select", options: ["Femra", "Meshkuj", "Fëmijë", "Unisex"] },
    { label: "Marka", type: "text" },
  ],
  electronics: [
    { label: "Marka", type: "text" },
    { label: "Modeli", type: "text" },
    { label: "Kapaciteti", type: "select", variant: true },
    { label: "Ngjyra", type: "select", variant: true },
    { label: "Garancia", type: "number", unit: "muaj" },
  ],
  personalized: [
    { label: "Madhësia", type: "select", variant: true },
    { label: "Ngjyra", type: "select", variant: true },
    { label: "Materiali", type: "text" },
    { label: "Koha e përgatitjes", type: "number", unit: "ditë" },
  ],
  food: [
    { label: "Porcioni", type: "select", variant: true, options: ["Normale", "E madhe"] },
    { label: "Përbërësit", type: "text" },
    { label: "Alergjenët", type: "text" },
    { label: "Pesha", type: "number", unit: "g" },
    { label: "Vegjetariane", type: "boolean" },
  ],
  hospitality: [
    { label: "Kapaciteti", type: "number", unit: "persona" },
    { label: "Shtretërit", type: "text" },
    { label: "Pamja", type: "select", options: ["Deti", "Mali", "Qyteti", "Kopshti"] },
    { label: "Mëngjesi i përfshirë", type: "boolean" },
  ],
  beauty: [
    { label: "Marka", type: "text" },
    { label: "Sasia", type: "select", variant: true },
    { label: "Për lëkurë", type: "text" },
  ],
  manufacturing: [
    { label: "Materiali", type: "text" },
    { label: "Dimensionet", type: "text" },
    { label: "Pesha", type: "number", unit: "kg" },
    { label: "Paketimi", type: "text" },
    { label: "Sasia minimale", type: "number" },
  ],
};

/** The suggested fields for an onboarding category, with stable keys; none for
 * categories whose item kind has its own fields or that have no template. */
export function fieldTemplateFor(category: string | null | undefined): BusinessField[] {
  if (!category || kindForCategory(category) !== "product") return [];
  return (templates[category] ?? []).map(field => ({ key: fieldKey(field.label), ...field }));
}

/** The suggested fields the business does not have yet, matched by key or name. */
export function missingTemplateFields(suggested: BusinessField[], current: { key: string; label: string }[]): BusinessField[] {
  const have = new Set(current.flatMap(f => [f.key, fieldKey(f.label)]));
  return suggested.filter(f => !have.has(f.key));
}
