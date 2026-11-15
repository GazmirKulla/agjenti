import type { LinkedSpec } from "@/lib/integrations/linked-catalog";

/** A photo the store makes for an item (catalog role "output"): processed design, finished product. */
export type OutputField = { key: string; label: string; max?: number };
export type OrderOutputItem = { item: number; productName: string; outputFields: OutputField[] };

type Row = { position: number | null; products: { name: string | null; source?: string | null; external_spec?: unknown } | { name: string | null; source?: string | null; external_spec?: unknown }[] | null };

/** Each item of the order (by position, from 1) with the output photo fields its catalog declares. */
export function orderOutputFields(rows: unknown): OrderOutputItem[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Row[]).slice().sort((a, b) => (a.position ?? -1) - (b.position ?? -1)).map((row, index) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const spec = product?.source === "linked" ? (product.external_spec as Partial<LinkedSpec> | null) : null;
    const outputFields = (Array.isArray(spec?.fields) ? spec!.fields : []).flatMap((f) =>
      f && f.role === "output" && (f.type === "photo" || f.type === "file") && typeof f.key === "string" && typeof f.label === "string"
        ? [{ key: f.key, label: f.label, ...(typeof f.max === "number" ? { max: f.max } : {}) }] : []);
    return { item: index + 1, productName: product?.name ?? "Produkt", outputFields };
  });
}

/** Paths of files in this conversation's order files (uploaded or copied there), at most `max`; null when any is not. */
export function outputFilePaths(raw: unknown, businessId: string, conversationId: string | null, max: number): string[] | null {
  if (!conversationId || !Array.isArray(raw) || !raw.length || raw.length > Math.min(max, 10)) return null;
  const pattern = new RegExp(`^${businessId}/${conversationId}/[0-9a-f-]{36}\\.(jpg|png|webp|heic|heif)$`);
  return raw.every((p) => typeof p === "string" && pattern.test(p)) ? [...new Set(raw as string[])] : null;
}
