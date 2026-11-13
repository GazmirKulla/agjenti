import { detectDelimiter, headerKey, parseTable } from "./csv";
import { httpUrl } from "./batch";
import { parseAmount } from "./page-extract";
import { fieldKey, type BusinessField } from "@/lib/items/fields";

export const importFields = ["name", "sku", "price_amount", "currency", "description", "image_url"] as const;
export type ImportField = typeof importFields[number];
export const importLabels: Record<ImportField, string> = { name: "Emri", sku: "SKU", price_amount: "Çmimi", currency: "Monedha", description: "Përshkrimi", image_url: "Foto" };
export type ImportOptions = { mapping: Partial<Record<ImportField, number>>; fields: ImportField[]; lines?: number[]; productTypeId?: string; workflowId?: string;
  /** Business field key → column index (e.g. gjatesia → 3). */
  attributes?: Record<string, number> };
export type ImportVariant = { options: Record<string, string>; sku: string | null; price_amount: number | null };
type AttributeValue = string | number | boolean;
export const configurationLabels = { product_type_id: "Lloji i produktit", workflow_id: "Workflow i porosisë" };
export type ImportPatchField = ImportField | keyof typeof configurationLabels;
export type CatalogProduct = { attributes?: Record<string, unknown>; product_type_id?: string | null; workflow_id?: string | null; id: string; updated_at: string; name: string; sku: string | null; price_amount: number | null; currency: string; description: string | null; image_url: string | null; is_active: boolean };
export type ImportRow = { line: number; name: string; status: "create" | "update" | "unchanged" | "conflict"; errors: string[]; warnings: string[]; id: string | null; before: CatalogProduct | null; patch: Partial<Record<ImportPatchField, string | number | null>> & { attributes?: Record<string, AttributeValue> }; variants?: ImportVariant[] };
export type ImportPreview = { rows: ImportRow[]; token?: string; advice?: string; fieldLabels?: Record<string, string> };
export type ImportSource = { token: string; headers: string[]; mapping: ImportOptions["mapping"]; count: number; name: string; raw: string; fields?: ImportField[] };

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
    const field = key === "price" ? "price_amount" : key === "image" ? "image_url" : key;
    if (field && mapping[field] === undefined) mapping[field] = index;
  });
  return { headers, cells: table.slice(1), mapping };
}

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");

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
  const attributeColumns = attributeIndexes.map(([key, at]) => ({ field: known.get(key)!, at }));
  const variantColumns = attributeColumns.filter(a => a.field.variant);
  const variantMode = variantColumns.length > 0;
  if (variantMode && options.mapping.name === undefined) throw Error("Për variantet lidh kolonën Emri: rreshtat me të njëjtin emër bëhen një produkt.");
  const key = (s: string) => s.trim().toLowerCase();
  const cellAt = (c: string[], at: number | undefined) => (c[at ?? -1] ?? "").trim();
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
    if (variantMode) {
      const base = typeof row.patch.price_amount === "number" ? row.patch.price_amount : before?.price_amount ?? null;
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
      for (const f of importFields) if (row.patch[f] === before[f]) delete row.patch[f];
      if (!Object.keys(row.patch).length && !row.variants?.length) row.status = "unchanged";
      const price = row.patch.price_amount;
      if (typeof price === "number" && before.price_amount && Math.abs(price - before.price_amount) / before.price_amount >= 0.3) row.warnings.push("Çmimi ndryshon të paktën 30%; kontrolloje.");
    }
    if (row.errors.length) row.status = "conflict";
    return row;
  });
}
