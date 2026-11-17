"use client";
import { useState, useTransition } from "react";
import { previewProductFromUrl } from "@/lib/products/import-actions";
import type { Option, ProductRow } from "@/lib/products/catalog";
import { variantFields, type BusinessField } from "@/lib/items/fields";
import { matchPageOptions } from "@/lib/items/field-suggest";
import Link from "next/link";
import type { FieldUsage } from "@/lib/items/field-visibility";
import { ProductEditor } from "./editor";

/** "Nga faqja e internetit": the owner pastes a product page link, the server
 * reads it, and the usual product form opens prefilled. Nothing is saved
 * until the owner checks it and presses save. */
export function ProductFromWebsite({ slug, types, workflows, kind, fields, usage }: {
  slug: string;
  types: Option[];
  workflows: Option[];
  kind: string;
  fields: BusinessField[];
  usage: FieldUsage;
}) {
  const [draft, setDraft] = useState<{ id: number; product: Partial<ProductRow> } | null>(null);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();
  const [missing, setMissing] = useState<string[]>([]);
  const read = (form: FormData) => start(async () => {
    setMessage({});
    const result = await previewProductFromUrl(slug, form);
    if ("error" in result && result.error) { setMessage({ error: result.error }); return; }
    if (!("product" in result) || !result.product) return;
    const p = result.product;
    // The page's choices (colours, sizes) go into the business's matching fields.
    const { filled, unmatched } = matchPageOptions(p.options ?? [], variantFields(fields));
    setDraft(current => ({ id: (current?.id ?? 0) + 1, product: {
      name: p.name, description: p.description, image_url: p.imageUrl, price_amount: p.price, currency: p.currency ?? "ALL", sku: p.sku,
      ...(Object.keys(filled).length ? { attributes: filled } : {}),
    } }));
    const found = (p.options ?? []).map(o => `${o.name}: ${o.values.join(", ")}`).join(" · ");
    setMessage({ success: `${result.success ?? "U lexua."}${found ? ` Faqja ofron ${found}.` : ""} Kontrollo të dhënat më poshtë dhe ruaje.` });
    setMissing(unmatched.map(o => o.name));
  });
  return (
    <div className="grid gap-4">
      <form className="panel section-pad grid gap-3" action={read}>
        <label className="form-label">
          Linku i produktit në faqen tënde
          <input name="source_url" className="field" type="url" inputMode="url" required placeholder="https://dyqani-im.al/produkt/..." />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Duke lexuar faqen…" : "Lexo produktin"}</button>
          <span className="muted-copy">Lexohen emri, përshkrimi, çmimi, foto dhe kodi; AI plotëson fushat e tua.</span>
        </div>
        {message.error && <p className="form-feedback form-feedback-error" role="alert">{message.error}</p>}
        {message.success && <p className="form-feedback form-feedback-success" role="status">{message.success}</p>}
        {missing.length > 0 && (
          <p className="muted-copy">
            Nuk ke fushë për {missing.join(", ")}. Shtoje te <Link className="inline-link" href={`/b/${slug}/products/fields`}>Fushat</Link> si «Zgjedh klienti», që Agjenti ta pyesë klientin dhe importi ta plotësojë vetë.
          </p>
        )}
      </form>
      {draft && <ProductEditor key={draft.id} slug={slug} types={types} workflows={workflows} kind={kind} fields={fields} usage={usage} draft={draft.product} />}
    </div>
  );
}
