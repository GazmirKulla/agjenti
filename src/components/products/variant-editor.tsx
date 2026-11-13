"use client";
import { useState } from "react";
import type { BusinessField } from "@/lib/items/fields";
import type { ProductVariant } from "@/lib/products/variants";

type Row = { id?: string; options: Record<string, string>; sku: string; price: string; is_active: boolean };
const toRow = (v: ProductVariant): Row => ({ id: v.id, options: { ...v.options }, sku: v.sku ?? "", price: v.price_amount === null ? "" : String(v.price_amount), is_active: v.is_active });

/** The product's variants: one row per choice (e.g. 80 cm, 120 cm) with its own
 * code and, when it differs, its own price. Sent with the product form. */
export function VariantEditor({ fields, variants, currency }: { fields: BusinessField[]; variants: ProductVariant[]; currency: string }) {
  const [rows, setRows] = useState<Row[]>(variants.map(toRow));
  const update = (index: number, patch: Partial<Row>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  const addAll = (field: BusinessField) => setRows(current => {
    const present = new Set(current.map(r => r.options[field.key]).filter(Boolean));
    const missing = (field.options ?? []).filter(o => !present.has(o));
    return [...current, ...missing.map(value => ({ options: { [field.key]: value }, sku: "", price: "", is_active: true }))];
  });
  const payload = rows.map(r => ({ ...(r.id ? { id: r.id } : {}), options: r.options, sku: r.sku, price_amount: r.price.trim() === "" ? null : r.price, is_active: r.is_active }));
  return (
    <fieldset id="product-variants" className="grid gap-3">
      <legend className="font-semibold">Variantet</legend>
      <input type="hidden" name="variants_json" value={JSON.stringify(payload)} />
      <p className="muted-copy">
        Shto një rresht për çdo zgjedhje që shet, p.sh. çdo gjatësi. Lëre çmimin bosh kur është i njëjtë me çmimin e produktit.
        Kur produkti ka variante, agjenti e pyet klientin cilin dëshiron dhe porosia merr çmimin e variantit.
      </p>
      {rows.length > 0 && (
        <div className="grid gap-2">
          {rows.map((row, index) => (
            <div key={row.id ?? `new-${index}`} className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))] items-end">
              {fields.map(field => (
                <label key={field.key} className="form-label">
                  {field.label}
                  <input className="field" list={`variant-values-${field.key}`} value={row.options[field.key] ?? ""} maxLength={60}
                    placeholder={field.options?.[0] ?? (field.unit ? `P.sh. 100 ${field.unit}` : "")}
                    onChange={e => update(index, { options: { ...row.options, [field.key]: e.target.value } })} />
                </label>
              ))}
              <label className="form-label">
                Kodi / SKU
                <input className="field" value={row.sku} maxLength={80} placeholder="opsional" onChange={e => update(index, { sku: e.target.value })} />
              </label>
              <label className="form-label">
                Çmimi ({currency})
                <input className="field" type="number" min="0" step="0.01" value={row.price} placeholder="si produkti" onChange={e => update(index, { price: e.target.value })} />
              </label>
              <div className="flex items-center gap-2">
                <label className="toggle-label">
                  <span>Në shitje</span>
                  <input className="switch-input" type="checkbox" checked={row.is_active} onChange={e => update(index, { is_active: e.target.checked })} />
                </label>
                <button type="button" className="btn btn-ghost" aria-label={`Hiq variantin ${index + 1}`} onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Hiqe</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {fields.map(field => field.options?.length ? (
        <datalist key={field.key} id={`variant-values-${field.key}`}>{field.options.map(o => <option key={o} value={o} />)}</datalist>
      ) : null)}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" disabled={rows.length >= 100}
          onClick={() => setRows(current => [...current, { options: {}, sku: "", price: "", is_active: true }])}>+ Shto variant</button>
        {fields.filter(f => f.options?.length).map(field => (
          <button key={field.key} type="button" className="btn btn-ghost" onClick={() => addAll(field)}>+ Të gjitha vlerat e “{field.label}”</button>
        ))}
      </div>
    </fieldset>
  );
}
