import type { BusinessField } from "./fields";
import type { KindField } from "./kinds";

/** AI suggestions for a product's fields, read from its name and description.
 * The model only proposes; every value is checked here against the field's
 * type and allowed values, and the owner reviews it in the form before saving. */

export type FieldSuggestion = {
  /** Descriptive fields: one value each. */
  values: Record<string, string | number | boolean>;
  /** Fields the customer chooses from: the values this product comes in. */
  choices: Record<string, string[]>;
};

type Described = { key: string; label: string; type: string; unit?: string; options?: string[]; choice?: true };

/** The fields as the model reads them. */
export function describeFields(attributes: KindField[], choices: BusinessField[]): Described[] {
  return [
    ...attributes.map(f => ({ key: f.key, label: f.label, type: f.type, ...(f.unit ? { unit: f.unit } : {}),
      ...(f.options?.length ? { options: f.options.map(o => o.label) } : {}) })),
    ...choices.map(f => ({ key: f.key, label: f.label, type: "list", ...(f.unit ? { unit: f.unit } : {}),
      ...(f.options?.length ? { options: f.options } : {}), choice: true as const })),
  ];
}

const same = (a: string, b: string) => a.localeCompare(b, "sq", { sensitivity: "base" }) === 0;

/** Reads the model's JSON tolerantly: anything that does not fit a field is dropped. */
export function parseFieldSuggestion(text: string, attributes: KindField[], choices: BusinessField[]): FieldSuggestion {
  const result: FieldSuggestion = { values: {}, choices: {} };
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return result;
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return result; }
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const values = (root.vlerat && typeof root.vlerat === "object" ? root.vlerat : {}) as Record<string, unknown>;
  const lists = (root.zgjedhjet && typeof root.zgjedhjet === "object" ? root.zgjedhjet : {}) as Record<string, unknown>;

  for (const field of attributes) {
    const value = values[field.key];
    if (value === undefined || value === null || value === "") continue;
    if (field.type === "boolean") { if (value === true) result.values[field.key] = true; continue; }
    if (field.type === "number") {
      const n = typeof value === "number" ? value
        : /\d/.test(String(value)) ? Number(String(value).replace(",", ".").replace(/[^\d.]/g, "")) : NaN;
      if (Number.isFinite(n) && n >= 0) result.values[field.key] = n;
      continue;
    }
    const text = String(value).trim();
    if (field.type === "select") {
      // The stored value of the option whose label (or value) the model named.
      const option = field.options?.find(o => same(o.label, text) || same(o.value, text));
      if (option) result.values[field.key] = option.value;
      continue;
    }
    if (text) result.values[field.key] = text.slice(0, 120);
  }

  for (const field of choices) {
    const list = lists[field.key];
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const picked: string[] = [];
    for (const item of list) {
      const text = String(item ?? "").trim().slice(0, 60);
      // A known value keeps the owner's spelling.
      const known = field.options?.find(o => same(o, text)) ?? text;
      const id = known.toLocaleLowerCase("sq");
      if (!text || seen.has(id)) continue;
      seen.add(id); picked.push(known);
    }
    if (picked.length) result.choices[field.key] = picked.slice(0, 40);
  }
  return result;
}

/** Puts the choices a website page offers (e.g. Ngjyra: Red, Blue) into the
 * business's matching customer-chosen fields, by name. What has no matching
 * field is returned, so the owner can add the field. */
export function matchPageOptions(options: { name: string; values: string[] }[], choices: BusinessField[]): {
  filled: Record<string, string[]>;
  unmatched: { name: string; values: string[] }[];
} {
  const norm = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const filled: Record<string, string[]> = {};
  const unmatched: { name: string; values: string[] }[] = [];
  for (const option of options) {
    const wanted = norm(option.name);
    const field = choices.find(f => !filled[f.key] && [norm(f.key), norm(f.label)].some(n => n === wanted || n.startsWith(wanted) || wanted.startsWith(n)));
    if (field) filled[field.key] = option.values.slice(0, 40);
    else unmatched.push(option);
  }
  return { filled, unmatched };
}
