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
};

export function parseProductForm(
  form: FormData,
  opts?: { requirePrice?: boolean },
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
  };
}

export function shortenDescription(value: string | null | undefined, max = 120) {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
