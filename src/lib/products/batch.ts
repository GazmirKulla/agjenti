import { parseAmount } from "./page-extract";

export const PRODUCT_BATCH_LIMIT = 100;

export type ProductBatchItem = {
  name: string;
  description: string | null;
  sku: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string;
  externalId: string | null;
};

export function parseProductBatch(
  input: unknown,
): { items: ProductBatchItem[]; skipped: number } | { error: string } {
  if (!Array.isArray(input)) return { error: "Lista e produkteve nuk është e vlefshme." };
  if (!input.length) return { error: "Zgjidh të paktën një produkt." };
  if (input.length > PRODUCT_BATCH_LIMIT) {
    return { error: `Mund të ruhen deri në ${PRODUCT_BATCH_LIMIT} produkte njëherësh.` };
  }

  const items: ProductBatchItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of input) {
    const item = normalizeBatchItem(raw);
    if (!item) {
      skipped += 1;
      continue;
    }
    if (item.externalId) {
      if (seen.has(item.externalId)) {
        skipped += 1;
        continue;
      }
      seen.add(item.externalId);
    }
    items.push(item);
  }
  if (!items.length) return { error: "Asnjë rresht nuk kishte emër të vlefshëm." };
  return { items, skipped };
}

export function normalizeCurrency(value: unknown): string {
  const text = String(value ?? "")
    .trim()
    .toUpperCase()
    .replaceAll("Ë", "E");
  if (!text || text === "LEK" || text === "LEKE") return "ALL";
  if (text === "€" || text === "EURO") return "EUR";
  if (text === "$") return "USD";
  if (text === "£") return "GBP";
  return /^[A-Z]{3}$/.test(text) ? text : "ALL";
}

export function optionalUuid(value: unknown): string | null | { error: string } {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    return { error: "Lloji ose workflow-i nuk është i vlefshëm." };
  }
  return text;
}

export function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function batchSummary(created: number, updated: number, skipped: number): string {
  const parts: string[] = [];
  if (created === 1) parts.push("U shtua 1 produkt.");
  else if (created > 1) parts.push(`U shtuan ${created} produkte.`);
  if (updated === 1) parts.push("1 produkt nga Instagram u përditësua.");
  else if (updated > 1) parts.push(`${updated} produkte nga Instagram u përditësuan.`);
  if (skipped === 1) parts.push("1 rresht u la jashtë.");
  else if (skipped > 1) parts.push(`${skipped} rreshta u lanë jashtë.`);
  return parts.join(" ");
}

function normalizeBatchItem(raw: unknown): ProductBatchItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = String(row.name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (name.length < 2) return null;

  let price: number | null = null;
  if (row.price != null && String(row.price).trim() !== "") {
    price = parseAmount(typeof row.price === "number" ? row.price : String(row.price));
    if (price == null) return null;
  }

  let externalId: string | null = null;
  if (row.externalId != null && String(row.externalId).trim()) {
    const id = String(row.externalId).trim();
    if (!/^ig:[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    externalId = id;
  }

  return {
    name,
    description: cleanDescription(row.description),
    sku: cleanSku(row.sku),
    imageUrl: httpUrl(row.imageUrl ?? row.image_url),
    price,
    currency: normalizeCurrency(row.currency),
    externalId,
  };
}

function cleanDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  if (text.length <= 4000) return text;
  return `${text.slice(0, 3999).trimEnd()}…`;
}

function cleanSku(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, 80);
}
