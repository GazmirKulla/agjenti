import type { BusinessField } from "@/lib/items/fields";
import { importFields, importLabels, sameCell, type ImportField, type ImportOptions } from "./import-model";
import { splitChoices } from "./variants";

/** How the business's own CSV is read. The AI proposes it, this module checks it against the
 * file and the business's fields, the owner approves it, and the import applies it as plain
 * column links. It never carries product values, prices or stock. */
export const columnUses = [...importFields, "field", "choice", "ignore"] as const;
export type ColumnUse = typeof columnUses[number];
export type PlanColumn = {
  index: number;
  header: string;
  use: ColumnUse;
  /** An existing business field; absent for a field the plan proposes to add. */
  fieldKey?: string;
  /** Name and unit of a field to add (use field or choice without fieldKey). */
  label?: string;
  unit?: string;
  /** Cell values in this column that mean "no value", e.g. "Të ndryshme". */
  blank?: string[];
};
export type ImportPlan = {
  columns: PlanColumn[];
  /** "request": rows without any price are saved with their price on request. */
  missingPrice: "request" | "empty";
};

const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

/** Keeps only what fits the file and the business: one column per import field, existing field keys,
 * named new fields, and "no value" markers that really occur in that column. Anything else is ignored. */
export function validatePlan(raw: unknown, headers: string[], cells: string[][], fields: BusinessField[]): ImportPlan {
  const input = (raw && typeof raw === "object" ? raw : {}) as { columns?: unknown; missingPrice?: unknown };
  const byKey = new Map(fields.map(f => [f.key, f]));
  const taken = new Set<string>(), indexes = new Set<number>();
  const columns: PlanColumn[] = [];
  for (const item of Array.isArray(input.columns) ? input.columns.slice(0, headers.length) : []) {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const index = row.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= headers.length || indexes.has(index)) continue;
    indexes.add(index);
    let use: ColumnUse = columnUses.includes(row.use as ColumnUse) ? row.use as ColumnUse : "ignore";
    const column: PlanColumn = { index, header: headers[index], use };
    if (importFields.includes(use as ImportField)) {
      if (taken.has(use)) column.use = use = "ignore"; else taken.add(use);
    } else if (use === "field" || use === "choice") {
      const label = clean(row.label, 40);
      // An existing field, by its key or by the same name.
      const existing = byKey.get(clean(row.fieldKey, 40)) ?? (label ? fields.find(f => sameCell(f.label, label)) : undefined);
      if (existing && !taken.has(`field:${existing.key}`)) {
        taken.add(`field:${existing.key}`);
        column.fieldKey = existing.key;
        column.use = existing.variant ? "choice" : "field"; // the field's own kind decides
      } else {
        if (label.length < 2 || columns.some(c => c.label && sameCell(c.label, label))) column.use = "ignore";
        else { column.label = label; const unit = clean(row.unit, 12); if (unit) column.unit = unit; }
      }
    }
    const values = new Set(cells.map(c => (c[index] ?? "").trim()).filter(Boolean));
    const blank = (Array.isArray(row.blank) ? row.blank : []).map(v => clean(v, 60)).filter(v => v && [...values].some(cell => sameCell(cell, v) || splitChoices(cell).some(part => sameCell(part, v))));
    if (column.use !== "ignore" && blank.length) column.blank = [...new Set(blank)].slice(0, 10);
    columns.push(column);
  }
  // Every column is in the plan, so the owner sees and can change each one.
  headers.forEach((header, index) => { if (!indexes.has(index)) columns.push({ index, header, use: "ignore" }); });
  return { columns: columns.sort((a, b) => a.index - b.index), missingPrice: input.missingPrice === "request" && taken.has("price_amount") ? "request" : "empty" };
}

/** What the owner picks for one column in the plan: an import field ("name"), an existing
 * business field ("key:gjatesia"), a new field ("new:field" / "new:choice") or "ignore". */
export function columnChoice(c: PlanColumn) {
  return c.fieldKey ? `key:${c.fieldKey}` : c.use === "field" || c.use === "choice" ? `new:${c.use}` : c.use;
}

/** The owner's change to one column. An import field taken by another column frees that column;
 * an existing field is linked to one column only. The server validates the result again. */
export function editPlanColumn(plan: ImportPlan, index: number, change: { choice?: string; label?: string; unit?: string }, fields: BusinessField[]): ImportPlan {
  const current = plan.columns.find(c => c.index === index);
  if (!current) return plan;
  const choice = change.choice ?? columnChoice(current);
  const next: PlanColumn = { index, header: current.header, use: "ignore", ...(current.blank ? { blank: current.blank } : {}) };
  if (choice.startsWith("key:")) {
    const field = fields.find(f => f.key === choice.slice(4));
    if (field) Object.assign(next, { use: field.variant ? "choice" : "field", fieldKey: field.key });
  } else if (choice === "new:field" || choice === "new:choice") {
    // A new field starts with the column's title as its name; the owner can rename it and set its unit.
    const label = clean(change.label ?? current.label ?? current.header, 40), unit = clean(change.unit ?? current.unit, 12);
    Object.assign(next, { use: choice.slice(4), label, ...(unit ? { unit } : {}) });
  } else if (columnUses.includes(choice as ColumnUse)) next.use = choice as ColumnUse;
  const frees = (c: PlanColumn) => c.index !== index && (
    importFields.includes(next.use as ImportField) && c.use === next.use
    || next.fieldKey !== undefined && c.fieldKey === next.fieldKey);
  const columns = plan.columns.map(c => c.index === index ? next : frees(c) ? { index: c.index, header: c.header, use: "ignore" as const } : c);
  return { columns, missingPrice: columns.some(c => c.use === "price_amount") ? plan.missingPrice : "empty" };
}

/** The new business fields the plan adds, in the shape the field settings save. */
export function planNewFields(plan: ImportPlan) {
  return plan.columns.filter(c => (c.use === "field" || c.use === "choice") && !c.fieldKey && c.label)
    .map(c => ({ label: c.label!, type: "text" as const, ...(c.unit ? { unit: c.unit } : {}), variant: c.use === "choice" }));
}

/** After the new fields exist: link each planned column to its field by name. */
export function linkPlanFields(plan: ImportPlan, fields: BusinessField[]): ImportPlan {
  return { ...plan, columns: plan.columns.map(c => {
    if (c.fieldKey || (c.use !== "field" && c.use !== "choice")) return c;
    const field = fields.find(f => c.label && sameCell(f.label, c.label));
    return field ? { index: c.index, header: c.header, use: field.variant ? "choice" : "field", fieldKey: field.key, ...(c.blank ? { blank: c.blank } : {}) } : { index: c.index, header: c.header, use: "ignore" };
  }) };
}

/** The approved plan as import options: the column links the import already understands. */
export function planOptions(plan: ImportPlan, base: Pick<ImportOptions, "fields" | "lines" | "productTypeId" | "workflowId">): ImportOptions {
  const mapping: ImportOptions["mapping"] = {}, attributes: Record<string, number> = {}, blanks: Record<string, string[]> = {};
  for (const c of plan.columns) {
    if (importFields.includes(c.use as ImportField)) mapping[c.use as ImportField] = c.index;
    else if (c.fieldKey) attributes[c.fieldKey] = c.index;
    else continue;
    if (c.blank?.length) blanks[String(c.index)] = c.blank;
  }
  return { ...base, mapping, attributes, ...(Object.keys(blanks).length ? { blanks } : {}), missingPrice: plan.missingPrice };
}

const quote = (values: string[]) => values.map(v => `“${v}”`).join(", ");

/** One plain sentence per column, e.g. "Gjatësia (m): klienti zgjedh 2, 3, 4 (fushë e re “Gjatësia”, m)". */
export function describePlan(plan: ImportPlan, cells: string[][], fields: BusinessField[]): string[] {
  const byKey = new Map(fields.map(f => [f.key, f]));
  const lines = plan.columns.map(c => {
    const field = c.fieldKey ? byKey.get(c.fieldKey) : undefined;
    const name = field ? `fusha “${field.label}”${field.unit ? `, ${field.unit}` : ""}` : `fushë e re “${c.label}”${c.unit ? `, ${c.unit}` : ""}`;
    const isBlank = (v: string) => c.blank?.some(b => sameCell(b, v));
    const sample = [...new Set(cells.flatMap(row => splitChoices((row[c.index] ?? "").trim(), field?.unit ?? c.unit)).filter(v => !isBlank(v)))];
    const shown = sample.slice(0, 6).join(", ") + (sample.length > 6 ? "…" : "");
    const what = c.use === "ignore" ? "nuk importohet"
      : c.use === "choice" ? `klienti zgjedh ${shown || "vlerat e rreshtit"} (${name})`
      : c.use === "field" ? `të dhënë e produktit (${name})`
      : c.use === "price_amount" ? "çmimi (ose çmimi “nga”)"
      : c.use === "price_max" ? "çmimi “deri”: me të, çmimi bëhet nga–deri"
      : c.use === "price_unit" ? `njësia e çmimit${shown ? ` (${shown})` : ""}`
      : importLabels[c.use as ImportField].toLowerCase();
    return `${c.header}: ${what}${c.blank?.length ? `; ${quote(c.blank)} lexohet si pa vlerë` : ""}.`;
  });
  if (plan.missingPrice === "request") lines.push("Rreshtat pa asnjë çmim ruhen me çmim “Sipas kërkesës”.");
  return lines;
}
