import { itemKind as kindOf, parseAttributes, parseAvailability, type Availability } from "@/lib/items/kinds";
import { attributeFields, variantFields, type BusinessField } from "@/lib/items/fields";
import { MAX_CHOICES, parseVariants, splitChoices, type ProductVariant } from "./variants";
import { MAX_PRICE, priceMode, type PriceMode } from "./pricing";

export type ParsedProductFields = {
  name: string;
  description: string | null;
  sku: string | null;
  imageUrl: string | null;
  price: number | null;
  /** Null when the form does not carry the price mode: keep what is stored. */
  priceMode: PriceMode | null;
  priceMax: number | null;
  priceUnit: string | null;
  currency: string;
  productTypeId: string | null;
  workflowId: string | null;
  isActive: boolean;
  /** Null when the form does not carry the kind (e.g. an assistant edit): keep what is stored. */
  itemKind: string | null;
  /** Descriptive fields, and for each variant field the list of values the customer chooses from. */
  attributes: Record<string, string | number | boolean | string[]>;
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

  const mode = form.has("price_mode") ? priceMode(form.get("price_mode")) : null;
  const amount = (key: string) => {
    const text = String(form.get(key) ?? "").trim().replace(",", ".");
    if (!text) return null;
    const n = Number(text);
    return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? Math.round(n * 100) / 100 : NaN;
  };
  const requirePrice = opts?.requirePrice ?? false;
  // A price on request has no amount; the other modes keep the amount the owner typed.
  let price = mode === "request" ? null : amount("price");
  if (Number.isNaN(price)) return { error: "Çmimi duhet të jetë numër pozitiv ose zero." };
  if (price === null && mode !== "request" && (requirePrice || mode === "from" || mode === "range"))
    return { error: "Vendos çmimin e produktit." };
  const priceMax = mode === "range" ? amount("price_max") : null;
  if (mode === "range" && (priceMax === null || Number.isNaN(priceMax))) return { error: "Vendos çmimin “deri” si numër." };
  if (priceMax !== null && price !== null && priceMax < price) return { error: "Çmimi “deri” duhet të jetë sa ose më i madh se çmimi “nga”." };
  const priceUnit = String(form.get("price_unit") ?? "").trim().replace(/\s+/g, " ") || null;
  if (priceUnit && priceUnit.length > 20) return { error: "Njësia e çmimit duhet të ketë deri në 20 shkronja (p.sh. m³, copë)." };
  if (price !== null) price = Math.round(price * 100) / 100;

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
  const attributes: ParsedProductFields["attributes"] = { ...parsedAttributes.attributes };
  // The values the customer chooses from, without one variant row per value ("2; 3; 4").
  if (itemKind) for (const field of variantFields(opts?.fields ?? [])) {
    if (!form.has(`choices_${field.key}`)) continue;
    const values = splitChoices(String(form.get(`choices_${field.key}`)), field.unit);
    if (values.length > MAX_CHOICES) return { error: `“${field.label}” ka më shumë se ${MAX_CHOICES} vlera.` };
    if (values.length) attributes[field.key] = values;
  }
  const availability = parseAvailability(itemKind ?? "product", form.get("availability"));
  let variants: ProductVariant[] | null = null;
  if (form.has("variants_json")) {
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("variants_json"))); } catch { return { error: "Variantet nuk janë të vlefshme." }; }
    const parsedVariants = parseVariants(raw, opts?.fields ?? []);
    if ("error" in parsedVariants) return parsedVariants;
    variants = parsedVariants.variants;
    if (price === null && mode !== "request" && variants.some(v => v.is_active && v.price_amount === null))
      return { error: "Vendos çmimin e produktit, ose çmimin e çdo varianti në shitje." };
  }

  return {
    name,
    description,
    sku,
    imageUrl,
    price,
    priceMode: mode,
    priceMax,
    priceUnit,
    currency,
    productTypeId,
    workflowId,
    isActive,
    itemKind,
    attributes,
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
