import { itemKind as kindOf, parseAttributes, parseAvailability, type Availability } from "@/lib/items/kinds";
import { attributeFields, type BusinessField } from "@/lib/items/fields";
import { parseVariants, type ProductVariant } from "./variants";

export type ParsedProductFields = {
  name: string;
  description: string | null;
  sku: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string;
  productTypeId: string | null;
  workflowId: string | null;
  isActive: boolean;
  /** Null when the form does not carry the kind (e.g. an assistant edit): keep what is stored. */
  itemKind: string | null;
  attributes: Record<string, string | number | boolean>;
  availability: Availability;
  /** Null when the form does not carry the variant table: keep the stored variants. */
  variants: ProductVariant[] | null;
};

export function parseProductForm(
  form: FormData,
  opts?: { requirePrice?: boolean; fields?: BusinessField[] },
): ParsedProductFields | { error: string } {
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2)
    return { error: "Vendos emrin e produktit (të paktën 2 karaktere)." };

  const description = String(form.get("description") ?? "").trim() || null;
  const sku = String(form.get("sku") ?? "").trim() || null;

  const imageRaw = String(form.get("image_url") ?? "").trim();
  let imageUrl: string | null = null;
  if (imageRaw) {
    try {
      const url = new URL(imageRaw);
      if (url.protocol !== "http:" && url.protocol !== "https:")
        return { error: "URL e fotos duhet të fillojë me http ose https." };
      imageUrl = url.toString();
    } catch {
      return { error: "URL e fotos nuk është e vlefshme." };
    }
  }

  const priceText = String(form.get("price") ?? "").trim();
  const requirePrice = opts?.requirePrice ?? false;
  let price: number | null = null;
  if (priceText) {
    price = Number(priceText);
    if (!Number.isFinite(price) || price < 0)
      return { error: "Çmimi duhet të jetë numër pozitiv ose zero." };
  } else if (requirePrice) {
    return { error: "Vendos çmimin e produktit." };
  }

  const currency = String(form.get("currency") ?? "ALL")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    return { error: "Monedha duhet të jetë kodi me 3 shkronja (p.sh. ALL)." };

  const productTypeId = String(form.get("product_type_id") ?? "").trim() || null;
  const workflowId = String(form.get("workflow_id") ?? "").trim() || null;
  const isActive = form.get("is_active") === "on";
  const itemKind = form.has("item_kind") ? kindOf(String(form.get("item_kind"))).id : null;
  const parsedAttributes = itemKind ? parseAttributes(itemKind, form, attributeFields(opts?.fields ?? [])) : { attributes: {} };
  if ("error" in parsedAttributes && parsedAttributes.error) return { error: parsedAttributes.error };
  const availability = parseAvailability(itemKind ?? "product", form.get("availability"));
  let variants: ProductVariant[] | null = null;
  if (form.has("variants_json")) {
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("variants_json"))); } catch { return { error: "Variantet nuk janë të vlefshme." }; }
    const parsedVariants = parseVariants(raw, opts?.fields ?? []);
    if ("error" in parsedVariants) return parsedVariants;
    variants = parsedVariants.variants;
    if (price === null && variants.some(v => v.is_active && v.price_amount === null))
      return { error: "Vendos çmimin e produktit, ose çmimin e çdo varianti në shitje." };
  }

  return {
    name,
    description,
    sku,
    imageUrl,
    price,
    currency,
    productTypeId,
    workflowId,
    isActive,
    itemKind,
    attributes: parsedAttributes.attributes,
    availability,
    variants,
  };
}

export function shortenDescription(value: string | null | undefined, max = 120) {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
