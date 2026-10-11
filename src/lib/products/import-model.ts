import { detectDelimiter, headerKey, parseTable } from "./csv";
import { httpUrl } from "./batch";
import { parseAmount } from "./page-extract";

export const importFields = ["name", "sku", "price_amount", "currency", "description", "image_url"] as const;
export type ImportField = typeof importFields[number];
export const importLabels: Record<ImportField, string> = { name: "Emri", sku: "SKU", price_amount: "Çmimi", currency: "Monedha", description: "Përshkrimi", image_url: "Foto" };
export type ImportOptions = { mapping: Partial<Record<ImportField, number>>; fields: ImportField[]; lines?: number[]; productTypeId?: string; workflowId?: string };
export const configurationLabels = { product_type_id: "Lloji i produktit", workflow_id: "Workflow i porosisë" };
export type ImportPatchField = ImportField | keyof typeof configurationLabels;
export type CatalogProduct = { product_type_id?: string | null; workflow_id?: string | null; id: string; updated_at: string; name: string; sku: string | null; price_amount: number | null; currency: string; description: string | null; image_url: string | null; is_active: boolean };
export type ImportRow = { line: number; name: string; status: "create" | "update" | "unchanged" | "conflict"; errors: string[]; warnings: string[]; id: string | null; before: CatalogProduct | null; patch: Partial<Record<ImportPatchField, string | number | null>> };
export type ImportPreview = { rows: ImportRow[]; token?: string; advice?: string };
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

export function buildImportPreview(raw: string, options: ImportOptions, catalog: CatalogProduct[]): ImportRow[] {
  const { headers, cells } = readImportCsv(raw);
  if (!options || !Array.isArray(options.fields) || !options.fields.length || options.fields.some(f => !importFields.includes(f)) || !options.mapping || typeof options.mapping !== "object") throw Error("Zgjidh fushat që do të importohen.");
  const indexes = Object.entries(options.mapping);
  if (indexes.some(([f, n]) => !importFields.includes(f as ImportField) || !Number.isInteger(n) || n! < 0 || n! >= headers.length) || new Set(indexes.map(([, n]) => n)).size !== indexes.length) throw Error("Lidhja e kolonave është e pavlefshme.");
  if (options.mapping.name === undefined && options.mapping.sku === undefined) throw Error("Lidh kolonën Emri ose SKU.");
  if (options.lines && (!Array.isArray(options.lines) || options.lines.some(n => !Number.isInteger(n) || n < 2 || n > cells.length + 1))) throw Error("Zgjedhje rreshtash e pavlefshme.");
  const key = (s: string) => s.trim().toLowerCase();
  const skus = cells.map(c => key(c[options.mapping.sku ?? -1] ?? ""));
  const seenTargets = new Set<string>();
  return cells.flatMap((c, i) => {
    const line = i + 2;
    if (options.lines && !options.lines.includes(line)) return [];
    const pick = (f: ImportField) => (c[options.mapping[f] ?? -1] ?? "").trim();
    const sku = pick("sku"), name = pick("name");
    const matches = sku ? catalog.filter(p => key(p.sku ?? "") === key(sku)) : [];
    const before = matches.length === 1 ? matches[0] : null;
    const row: ImportRow = { line, name: name || before?.name || `Rreshti ${line}`, status: before ? "update" : "create", errors: [], warnings: [], id: before?.id ?? null, before, patch: {} };
    if (c.length !== headers.length) row.errors.push("Numri i vlerave nuk përputhet me kolonat.");
    if (matches.length > 1 || (sku && skus.filter(s => s === key(sku)).length > 1)) row.errors.push("SKU e përsëritur; zgjidh konfliktin në CSV.");
    if (!before && name && cells.filter(row => key(row[options.mapping.name ?? -1] ?? "") === key(name)).length > 1) row.errors.push("Emër i përsëritur në CSV; dallo produktet përpara shtimit.");
    if (!before && name && catalog.some(p => key(p.name) === key(name))) row.errors.push("Ekziston një produkt me këtë emër. Vendos SKU-në e tij për përditësim ose dalloni emrat.");
    if (before && seenTargets.has(before.id)) row.errors.push("Produkti është zgjedhur dy herë.");
    if (before) seenTargets.add(before.id);
    for (const field of options.fields) {
      const value = pick(field);
      // Absent columns and empty cells preserve the existing value. Clearing is not implicit.
      if (options.mapping[field] === undefined || !value) continue;
      if (field === "price_amount") {
        const numeric = value.replace(/(?:ALL|EUR|USD|GBP|LEKE|LEKË?|€|\$|£)/giu, "").trim();
        const amount = /^(?:\d+|\d+[.,]\d{1,2}|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?)$/.test(numeric) ? parseAmount(numeric) : null;
        if (amount === null || amount < 0 || amount > 9999999999.99 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) row.errors.push("Çmim i pavlefshëm.");
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
    if (options.productTypeId && options.productTypeId !== before?.product_type_id) row.patch.product_type_id = options.productTypeId;
    if (options.workflowId && options.workflowId !== before?.workflow_id) row.patch.workflow_id = options.workflowId;
    if (!before) {
      if (!row.patch.name) row.errors.push("Për produkt të ri duhet të importohet emri.");
      row.patch.currency ??= "ALL";
      row.warnings.push("Krijohet si draft joaktiv.");
      if (!sku) row.warnings.push("Pa SKU; shto një kod për përditësime të ardhshme.");
    } else {
      for (const f of importFields) if (row.patch[f] === before[f]) delete row.patch[f];
      if (!Object.keys(row.patch).length) row.status = "unchanged";
      const price = row.patch.price_amount;
      if (typeof price === "number" && before.price_amount && Math.abs(price - before.price_amount) / before.price_amount >= 0.3) row.warnings.push("Çmimi ndryshon të paktën 30%; kontrolloje.");
    }
    if (row.errors.length) row.status = "conflict";
    return [row];
  });
}
