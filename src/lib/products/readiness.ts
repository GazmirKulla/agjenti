import { priceReady, type ProductPrice } from "./pricing";

/**
 * Whether a product is ready for the agent, as one list shared by the product page, the product form
 * and the catalog list. Each item says what is missing and where it is filled. The agent finds a
 * product from its name, description and field values, quotes its price, sends its photo, and takes
 * an order only through a workflow; an inactive, archived or sold product is not offered at all.
 */
export type ReadinessKey = "name" | "price" | "description" | "details" | "photo" | "workflow" | "active";
export type ReadinessItem = { key: ReadinessKey; label: string; done: boolean; optional: boolean; hint: string; anchor: string };

export type ReadinessInput = ProductPrice & {
  name: string;
  description?: string | null;
  image?: string | null;
  /** How many of the product's own fields (the kind's and the business's) have a value, out of how many exist. */
  details: { filled: number; total: number };
  /** The business workflow is active, or the product has its own process. */
  workflow: boolean;
  /** The owner keeps the product for information only: no order process is needed. */
  informationOnly?: boolean;
  active: boolean;
  archived?: boolean;
  availability?: string | null;
};

export function productReadiness(p: ReadinessInput): ReadinessItem[] {
  const items: ReadinessItem[] = [
    { key: "name", label: "Emri", done: p.name.trim().length >= 2, optional: false, anchor: "product-identity",
      hint: "Me këtë emër e gjen dhe e paraqet Agjenti." },
    { key: "price", label: "Çmimi ose “Sipas kërkesës”", done: priceReady(p), optional: false, anchor: "product-pricing",
      hint: "Agjenti e tregon çmimin; pa të nuk e aktivizon dot produktin." },
    { key: "description", label: "Përshkrimi", done: Boolean(p.description?.trim()), optional: false, anchor: "product-identity",
      hint: "Pa përshkrim, Agjenti e gjen vetëm kur klienti thotë emrin." },
    ...(p.details.total > 0 ? [{ key: "details" as const, label: `Të dhënat (${p.details.filled} nga ${p.details.total})`, done: p.details.filled > 0, optional: false,
      anchor: "product-details", hint: "Agjenti i tregon dhe kërkon sipas tyre, p.sh. masa ose mosha." }] : []),
    { key: "photo", label: "Foto", done: Boolean(p.image?.trim()), optional: true, anchor: "product-photo",
      hint: "Agjenti e dërgon pas përgjigjes kur e sugjeron produktin." },
    p.informationOnly
      ? { key: "workflow", label: "Vetëm për informim", done: true, optional: false, anchor: "product-process",
        hint: "Agjenti e prezanton produktin, por nuk merr porosi për të." }
      : { key: "workflow", label: "Procesi i porosisë", done: p.workflow, optional: false, anchor: "product-process",
        hint: "Pa proces gati, Agjenti informon por nuk merr porosi." },
    { key: "active", label: "Aktiv në katalog", done: p.active && !p.archived && p.availability !== "sold", optional: false, anchor: "product-active",
      hint: "Produktet joaktive, të arkivuara ose të shitura nuk u ofrohen klientëve." },
  ];
  return items;
}

/** What still needs doing, required items first; an optional item never makes a product "incomplete". */
export function missingReadiness(items: ReadinessItem[]) {
  return items.filter(item => !item.done && !item.optional);
}

/** How many of these fields have a value on the product (an empty list or text counts as no value). */
export function filledFields(keys: readonly string[], values: Record<string, unknown> | null | undefined) {
  const filled = keys.filter(key => {
    const value = values?.[key];
    return Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null && value !== false;
  }).length;
  return { filled, total: keys.length };
}
