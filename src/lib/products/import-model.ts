import { detectDelimiter, headerKey, parseTable } from "./csv";
import { httpUrl } from "./batch";
import { parseAmount } from "./page-extract";
import { fieldKey, type BusinessField } from "@/lib/items/fields";
import { MAX_CHOICES, splitChoices } from "./variants";
import { priceModeLabels, type PriceMode } from "./pricing";

export const importFields = ["name", "sku", "price_amount", "price_max", "price_unit", "currency", "description", "image_url"] as const;
export type ImportField = typeof importFields[number];
export const importLabels: Record<ImportField, string> = { name: "Emri", sku: "SKU", price_amount: "Çmimi", price_max: "Çmimi maksimal", price_unit: "Njësia e çmimit", currency: "Monedha", description: "Përshkrimi", image_url: "Foto" };
export type ImportOptions = { mapping: Partial<Record<ImportField, number>>; fields: ImportField[]; lines?: number[]; productTypeId?: string; workflowId?: string;
  /** Business field key → column index (e.g. gjatesia → 3). */
  attributes?: Record<string, number>;
  /** Column index → cell values that mean "no value" in that column (e.g. "Të ndryshme"), from the approved reading plan. */
  blanks?: Record<string, string[]>;
  /** "request": a product row without any price is saved with its price on request. */
  missingPrice?: "request" | "empty" };
export type ImportVariant = { options: Record<string, string>; sku: string | null; price_amount: number | null };
type AttributeValue = string | number | boolean | string[];
export const configurationLabels = { product_type_id: "Lloji i produktit", workflow_id: "Workflow i porosisë", price_mode: "Mënyra e çmimit" };
export type ImportPatchField = ImportField | keyof typeof configurationLabels;
export type CatalogProduct = { attributes?: Record<string, unknown>; product_type_id?: string | null; workflow_id?: string | null; id: string; updated_at: string; name: string; sku: string | null; price_amount: number | null;
  price_mode?: PriceMode; price_max?: number | null; price_unit?: string | null; currency: string; description: string | null; image_url: string | null; is_active: boolean };
export type ImportRow = { line: number; name: string; status: "create" | "update" | "unchanged" | "conflict"; errors: string[]; warnings: string[]; id: string | null; before: CatalogProduct | null; patch: Partial<Record<ImportPatchField, string | number | null>> & { attributes?: Record<string, AttributeValue> }; variants?: ImportVariant[] };
export type ImportPreview = { rows: ImportRow[]; token?: string; advice?: string; fieldLabels?: Record<string, string> };
export type ImportSource = { token: string; headers: string[]; mapping: ImportOptions["mapping"]; count: number; name: string; raw: string; fields?: ImportField[];
  /** The reading plan the owner approved before for these same column titles. */
  plan?: import("./import-plan").ImportPlan; options?: ImportOptions };
/** The owner's words for a stored value in the review (e.g. the price mode). */
export const importValueLabel = (field: string, value: unknown) => field === "price_mode" && typeof value === "string" && value in priceModeLabels ? priceModeLabels[value as PriceMode] : value;

export function withCsvHeaders(raw: string) {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/^sep=.\n/i, "").trim();
  const table = parseTable(text);
  if ("error" in table) throw Error(table.error);
  const columns = ["emri", "cmimi", "monedha", "pershkrimi", "sku", "foto"];
  if (!table[0]?.length || table[0].length > columns.length) throw Error("CSV pa tituj përdor rendin: emri, cmimi, monedha, pershkrimi, sku, foto.");
  return columns.slice(0, table[0].length).join(detectDelimiter(text)) + "\n" + text;
}

export function readImportCsv(raw: string) {
  if (typeof raw !== "string" || raw.length > 500000 || !raw.trim() || raw.includes("\0")) throw Error("Ngarko CSV tekst deri në 500,000 karaktere.");
  const table = parseTable(raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/^sep=.\n/i, "").trim());
  if ("error" in table) throw Error(table.error);
  if (table.length < 2 || table.length > 101) throw Error("CSV-ja duhet të ketë tituj kolonash dhe 1–100 rreshta.");
  const headers = table[0];
  if (headers.length > 30 || headers.some(h => !h.trim() || h.length > 120) || new Set(headers).size !== headers.length) throw Error("Përdor deri në 30 kolona me tituj të ndryshëm dhe jo bosh.");
  const mapping: ImportOptions["mapping"] = {};
  headers.forEach((h, index) => {
    const key = headerKey(h);
    // Our own template's titles for the upper price and its unit are read as such.
    const own = (["price_max", "price_unit"] as const).find(f => fold(importLabels[f]) === fold(h));
    const field = own ?? (key === "price" ? "price_amount" : key === "image" ? "image_url" : key);
    if (field && mapping[field] === undefined) mapping[field] = index;
  });
  return { headers, cells: table.slice(1), mapping };
}

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Compares a cell with a plan's "no value" marker: case, accents and spacing do not matter. */
export const sameCell = (a: string, b: string) => {
  const norm = (v: string) => v.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
};

/** Columns whose title is a business field's name or key ("Gjatësia", "gjatesia") map to that field. */
export function autoMapAttributes(headers: string[], fields: BusinessField[], taken: number[], current: Record<string, number> = {}) {
  const mapping = { ...current };
  const used = new Set([...taken, ...Object.values(mapping)]);
  for (const field of fields) {
    if (mapping[field.key] !== undefined) continue;
    const at = headers.findIndex((h, i) => !used.has(i) && [fold(field.label), fold(field.key), fold(fieldKey(field.label))].includes(fold(h)));
    if (at >= 0) { mapping[field.key] = at; used.add(at); }
  }
  return mapping;
}

function attributeValue(field: BusinessField, value: string): { value?: AttributeValue; error?: string } {
  if (field.type === "number") {
    const n = Number(value.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? { value: n } : { error: `“${field.label}” duhet të jetë numër.` };
  }
  if (field.type === "boolean") {
    const yes = ["po", "yes", "true", "1", "x", "ka"].includes(fold(value)), no = ["jo", "no", "false", "0", "nuk"].includes(fold(value));
    return yes ? { value: true } : no ? { value: false } : { error: `“${field.label}” pranon vetëm Po ose Jo.` };
  }
  if (field.type === "select" && !field.variant) {
    const match = field.options?.find(o => fold(o) === fold(value));
    return match ? { value: match } : { error: `“${value}” nuk është vlerë e “${field.label}”.` };
  }
  return value.length <= (field.variant ? 60 : 120) ? { value } : { error: `“${field.label}” është shumë i gjatë.` };
}

function priceOf(value: string) {
  const numeric = value.replace(/(?:ALL|EUR|USD|GBP|LEKE|LEKË?|€|\$|£)/giu, "").trim();
  const amount = /^(?:\d+|\d+[.,]\d{1,2}|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?)$/.test(numeric) ? parseAmount(numeric) : null;
  return amount === null || amount < 0 || amount > 9999999999.99 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001 ? null : amount;
}

/** Rows become products. When a variant column (e.g. Gjatësia) is mapped, rows with the same
 * name become ONE product and each row one variant with its own SKU and price. */
export function buildImportPreview(raw: string, options: ImportOptions, catalog: CatalogProduct[], businessFields: BusinessField[] = []): ImportRow[] {
  const { headers, cells } = readImportCsv(raw);
  if (!options || !Array.isArray(options.fields) || !options.fields.length || options.fields.some(f => !importFields.includes(f)) || !options.mapping || typeof options.mapping !== "object") throw Error("Zgjidh fushat që do të importohen.");
  const indexes = Object.entries(options.mapping);
  const attributeIndexes = Object.entries(options.attributes ?? {});
  const known = new Map(businessFields.map(f => [f.key, f]));
  if (indexes.some(([f, n]) => !importFields.includes(f as ImportField) || !Number.isInteger(n) || n! < 0 || n! >= headers.length)
    || attributeIndexes.some(([k, n]) => !known.has(k) || !Number.isInteger(n) || n < 0 || n >= headers.length)
    || new Set([...indexes, ...attributeIndexes].map(([, n]) => n)).size !== indexes.length + attributeIndexes.length) throw Error("Lidhja e kolonave është e pavlefshme.");
  if (options.mapping.name === undefined && options.mapping.sku === undefined) throw Error("Lidh kolonën Emri ose SKU.");
  if (options.lines && (!Array.isArray(options.lines) || options.lines.some(n => !Number.isInteger(n) || n < 2 || n > cells.length + 1))) throw Error("Zgjedhje rreshtash e pavlefshme.");
  const blanks = Object.entries(options.blanks ?? {});
  if (options.blanks && (typeof options.blanks !== "object" || blanks.length > headers.length || blanks.some(([at, list]) => !/^\d+$/.test(at) || Number(at) >= headers.length
    || !Array.isArray(list) || list.length > 10 || list.some(v => typeof v !== "string" || !v.trim() || v.length > 60)))) throw Error("Vlerat “pa vlerë” të planit janë të pavlefshme.");
  if (options.missingPrice !== undefined && options.missingPrice !== "request" && options.missingPrice !== "empty") throw Error("Zgjedhje e pavlefshme për rreshtat pa çmim.");
  const attributeColumns = attributeIndexes.map(([key, at]) => ({ field: known.get(key)!, at }));
  const variantColumns = attributeColumns.filter(a => a.field.variant);
  const variantMode = variantColumns.length > 0;
  if (variantMode && options.mapping.name === undefined) throw Error("Për variantet lidh kolonën Emri: rreshtat me të njëjtin emër bëhen një produkt.");
  const key = (s: string) => s.trim().toLowerCase();
  // A cell the approved plan reads as "no value" (e.g. "Të ndryshme") is empty: it preserves, never writes.
  const isBlank = (at: number, value: string) => (options.blanks?.[String(at)] ?? []).some(marker => sameCell(marker, value));
  const cellAt = (c: string[], at: number | undefined) => { const value = (c[at ?? -1] ?? "").trim(); return at !== undefined && isBlank(at, value) ? "" : value; };
  const choicesAt = (c: string[], field: BusinessField, at: number) => splitChoices(cellAt(c, at), field.unit).filter(v => !isBlank(at, v));
  const skus = cells.map(c => key(cellAt(c, options.mapping.sku)));
  const seenTargets = new Set<string>();
  // Each unit is one product: a single line, or in variant mode every line with the same name.
  const lines = cells.map((_, i) => i + 2).filter(line => !options.lines || options.lines.includes(line));
  const units: number[][] = [];
  if (variantMode) {
    const groups = new Map<string, number[]>();
    for (const line of lines) { const name = key(cellAt(cells[line - 2], options.mapping.name)); groups.set(name, [...(groups.get(name) ?? []), line]); }
    units.push(...groups.values());
  } else units.push(...lines.map(line => [line]));
  return units.map(group => {
    const line = group[0], c = cells[line - 2];
    const pick = (f: ImportField) => cellAt(c, options.mapping[f]);
    const name = pick("name"), sku = variantMode ? "" : pick("sku");
    const matches = sku ? catalog.filter(p => key(p.sku ?? "") === key(sku))
      : variantMode && name ? catalog.filter(p => key(p.name) === key(name)) : [];
    const before = matches.length === 1 ? matches[0] : null;
    const row: ImportRow = { line, name: name || before?.name || `Rreshti ${line}`, status: before ? "update" : "create", errors: [], warnings: [], id: before?.id ?? null, before, patch: {} };
    for (const at of group) if (cells[at - 2].length !== headers.length) row.errors.push(`Rreshti ${at}: numri i vlerave nuk përputhet me kolonat.`);
    if (!variantMode && (matches.length > 1 || (sku && skus.filter(s => s === key(sku)).length > 1))) row.errors.push("SKU e përsëritur; zgjidh konfliktin në CSV.");
    if (variantMode && matches.length > 1) row.errors.push("Ka disa produkte me këtë emër; dalloji emrat përpara importit.");
    if (!variantMode && !before && name && cells.filter(r => key(r[options.mapping.name ?? -1] ?? "") === key(name)).length > 1) row.errors.push("Emër i përsëritur në CSV; dallo produktet përpara shtimit.");
    if (!variantMode && !before && name && catalog.some(p => key(p.name) === key(name))) row.errors.push("Ekziston një produkt me këtë emër. Vendos SKU-në e tij për përditësim ose dalloni emrat.");
    if (before && seenTargets.has(before.id)) row.errors.push("Produkti është zgjedhur dy herë.");
    if (before) seenTargets.add(before.id);
    for (const field of options.fields) {
      if (variantMode && field === "sku") continue; // each row's SKU belongs to its variant
      if (field === "price_max" || field === "price_unit") continue; // read with the price below
      let value = pick(field);
      if (variantMode && field === "price_amount") {
        // The product shows the lowest price; each variant keeps its own.
        const prices = group.map(at => priceOf(cellAt(cells[at - 2], options.mapping.price_amount))).filter((n): n is number => n !== null);
        value = prices.length ? String(Math.min(...prices)) : value;
      }
      // Absent columns and empty cells preserve the existing value. Clearing is not implicit.
      if (options.mapping[field] === undefined || !value) continue;
      if (field === "price_amount") {
        const amount = priceOf(value);
        if (amount === null) row.errors.push("Çmim i pavlefshëm.");
        else row.patch[field] = amount;
      } else if (field === "currency") {
        const currency = ({ LEK: "ALL", LEKE: "ALL", "LEKË": "ALL", EURO: "EUR", "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[value.toUpperCase()] ?? value.toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) row.errors.push("Monedhë e pavlefshme.");
        else row.patch[field] = currency;
      } else if (field === "image_url") {
        if (!httpUrl(value)) row.errors.push("URL e fotos duhet të jetë http/https.");
        else row.patch[field] = value;
      } else {
        const max = field === "description" ? 4000 : field === "sku" ? 80 : 180;
        if (value.length > max || (field === "name" && value.length < 2)) row.errors.push(`${importLabels[field]} nuk ka gjatësi të vlefshme.`);
        else row.patch[field] = value;
      }
    }
    // The price's mode: a range when there is an upper price, on request when the approved plan says
    // rows without any price are quoted by staff. A single price stays as it is ("from" is kept).
    const uses = (f: ImportField) => options.fields.includes(f) && options.mapping[f] !== undefined;
    const maxText = uses("price_max") ? pick("price_max") : "";
    const max = maxText ? priceOf(maxText) : null;
    if (maxText && max === null) row.errors.push("Çmim maksimal i pavlefshëm.");
    const min = typeof row.patch.price_amount === "number" ? row.patch.price_amount : null;
    const anyPrice = group.some(at => cellAt(cells[at - 2], options.mapping.price_amount) || (uses("price_max") && cellAt(cells[at - 2], options.mapping.price_max)));
    if (max !== null) {
      if (min === null) row.errors.push("Ka çmim maksimal pa çmim minimal.");
      else if (max < min) row.errors.push("Çmimi maksimal është më i vogël se çmimi minimal.");
      else if (max > min) { row.patch.price_mode = "range"; row.patch.price_max = max; }
    }
    if (min !== null && !row.patch.price_mode && !(before?.price_mode === "from" && !uses("price_max"))) { row.patch.price_mode = "fixed"; row.patch.price_max = null; }
    if (!anyPrice && options.missingPrice === "request" && uses("price_amount")) {
      row.patch.price_mode = "request"; row.patch.price_amount = null; row.patch.price_max = null;
    }
    if (uses("price_unit")) {
      const unit = pick("price_unit");
      if (unit.length > 20) row.errors.push("Njësia e çmimit duhet të ketë deri në 20 shkronja.");
      else if (unit) row.patch.price_unit = unit;
    }
    const priceUnit = pick("price_amount").match(/(ALL|EUR|USD|GBP|LEKE|LEKË?|€|\$|£)/iu)?.[1].toUpperCase();
    const unit = priceUnit ? ({ LEK: "ALL", LEKE: "ALL", "LEKË": "ALL", "€": "EUR", "$": "USD", "£": "GBP" } as Record<string,string>)[priceUnit] ?? priceUnit : undefined;
    if (unit && options.fields.includes("price_amount")) {
      if (row.patch.currency && row.patch.currency !== unit) row.errors.push("Monedha në çmim nuk përputhet me kolonën Monedha.");
      else if (!row.patch.currency && options.fields.includes("currency")) row.patch.currency = unit;
      else if (!options.fields.includes("currency") && unit !== (before?.currency ?? "ALL")) row.errors.push("Çmimi ka monedhë tjetër. Përfshi edhe fushën Monedha.");
    }
    // The business's own descriptive fields (Druri, Ngjyra…), from the product's first row.
    const attributes: Record<string, AttributeValue> = {};
    for (const { field, at } of attributeColumns) {
      if (field.variant) continue;
      const value = cellAt(c, at);
      if (!value) continue;
      const parsed = attributeValue(field, value);
      if (parsed.error) row.errors.push(parsed.error); else attributes[field.key] = parsed.value!;
    }
    const changedAttributes = Object.fromEntries(Object.entries(attributes).filter(([k, v]) => before?.attributes?.[k] !== v));
    if (Object.keys(changedAttributes).length) row.patch.attributes = changedAttributes;
    // A cell with several values ("2; 3; 4") lists what the customer chooses from, kept on the product.
    // Then every variant column of that row is a list; rows with the same name must not carry lists.
    const listed = variantColumns.some(({ field, at: column }) => group.some(at => choicesAt(cells[at - 2], field, column).length > 1));
    if (listed && group.length > 1) row.errors.push(`Rreshtat me emrin “${row.name}” kanë lista vlerash (p.sh. 2; 3; 4). Mbaj një rresht për produktin, ose një vlerë për çdo rresht.`);
    if (listed && group.length === 1) {
      for (const { field, at: column } of variantColumns) {
        const values = choicesAt(c, field, column);
        if (!values.length) continue;
        if (values.length > MAX_CHOICES) row.errors.push(`“${field.label}” ka më shumë se ${MAX_CHOICES} vlera.`);
        else if (values.some(v => v.length > 60)) row.errors.push(`Një vlerë e “${field.label}” është shumë e gjatë.`);
        else attributes[field.key] = values;
      }
    }
    const changedLists = Object.fromEntries(Object.entries(attributes).filter(([k, v]) => Array.isArray(v) && JSON.stringify(before?.attributes?.[k]) !== JSON.stringify(v)));
    if (Object.keys(changedLists).length) row.patch.attributes = { ...(row.patch.attributes ?? {}), ...changedLists };
    if (variantMode && !listed) {
      const base = typeof row.patch.price_amount === "number" && row.patch.price_mode !== "range" ? row.patch.price_amount : before?.price_mode === "fixed" || !before?.price_mode ? before?.price_amount ?? null : null;
      const seen = new Set<string>();
      row.variants = group.flatMap(at => {
        const cellsAt = cells[at - 2];
        const chosen: Record<string, string> = {};
        for (const { field, at: column } of variantColumns) {
          const value = cellAt(cellsAt, column);
          if (!value) continue;
          const parsed = attributeValue(field, value);
          if (parsed.error) row.errors.push(`Rreshti ${at}: ${parsed.error}`); else chosen[field.key] = String(parsed.value);
        }
        if (!Object.keys(chosen).length) { if (group.length > 1) row.errors.push(`Rreshti ${at}: mungon vlera e variantit (${variantColumns.map(v => v.field.label).join(", ")}).`); return []; }
        const signature = JSON.stringify(variantColumns.map(v => chosen[v.field.key] ?? null));
        if (seen.has(signature)) { row.errors.push(`Rreshti ${at}: ky variant përsëritet.`); return []; }
        seen.add(signature);
        const variantSku = options.fields.includes("sku") ? cellAt(cellsAt, options.mapping.sku) : "";
        if (variantSku.length > 80) row.errors.push(`Rreshti ${at}: SKU shumë e gjatë.`);
        const priceText = options.fields.includes("price_amount") ? cellAt(cellsAt, options.mapping.price_amount) : "";
        const price = priceText ? priceOf(priceText) : null;
        if (priceText && price === null) row.errors.push(`Rreshti ${at}: çmim i pavlefshëm.`);
        return [{ options: chosen, sku: variantSku || null, price_amount: price !== null && price !== base ? price : null }];
      });
      if (row.variants.length) row.warnings.push(`${row.variants.length} variante: ${row.variants.map(v => Object.values(v.options).join(" / ")).join(", ")}.`);
      else delete row.variants;
    }
    if (options.productTypeId && options.productTypeId !== before?.product_type_id) row.patch.product_type_id = options.productTypeId;
    if (options.workflowId && options.workflowId !== before?.workflow_id) row.patch.workflow_id = options.workflowId;
    if (!before) {
      if (!row.patch.name) row.errors.push("Për produkt të ri duhet të importohet emri.");
      row.patch.currency ??= "ALL";
      row.warnings.push("Krijohet si draft joaktiv.");
      if (!sku && !variantMode) row.warnings.push("Pa SKU; shto një kod për përditësime të ardhshme.");
    } else {
      for (const f of [...importFields, "price_mode"] as const) if (row.patch[f] === (before[f] ?? (f === "price_mode" ? "fixed" : null))) delete row.patch[f];
      if (!Object.keys(row.patch).length && !row.variants?.length) row.status = "unchanged";
      const price = row.patch.price_amount;
      if (typeof price === "number" && before.price_amount && Math.abs(price - before.price_amount) / before.price_amount >= 0.3) row.warnings.push("Çmimi ndryshon të paktën 30%; kontrolloje.");
    }
    if (row.errors.length) row.status = "conflict";
    return row;
  });
}
