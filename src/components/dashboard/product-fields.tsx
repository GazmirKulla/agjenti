"use client";

import { generateProductDescription } from "@/lib/products/ai-actions";
import { AiSuggestButton } from "@/components/dashboard/ai-suggest-button";

type ProductFieldValues = {
  name?: string;
  sku?: string | null;
  description?: string | null;
  image_url?: string | null;
  price_amount?: number | null;
  currency?: string | null;
  product_type_id?: string | null;
  workflow_id?: string | null;
  is_active?: boolean;
};

export function ProductFields({
  slug,
  product,
  types,
  workflows,
  requireType = false,
}: {
  slug: string;
  product?: ProductFieldValues;
  types: { id: string; name: string }[];
  workflows: { id: string; name: string }[];
  requireType?: boolean;
}) {
  return (
    <>
      <fieldset id="product-identity" className="grid gap-3">
        <legend className="font-semibold">Identiteti</legend>
        <label className="form-label">
          Emri i produktit
          <input
            name="name"
            className="field"
            required
            minLength={2}
            defaultValue={product?.name ?? ""}
          />
        </label>
        <label className="form-label">
          SKU / kodi
          <input
            name="sku"
            className="field"
            placeholder="opsional"
            defaultValue={product?.sku ?? ""}
          />
        </label>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="form-label mb-0">Përshkrimi</span>
            <AiSuggestButton
              action={generateProductDescription.bind(null, slug)}
              targetName="description"
              collect={["name", "product_type_id"]}
              label="Gjenero me AI"
            />
          </div>
          <textarea
            name="description"
            className="field"
            rows={3}
            placeholder="Shkruaj ose gjenero me AI nga emri (p.sh. barriera mbyllëse për parking)."
            defaultValue={product?.description ?? ""}
          />
        </div>
      </fieldset>

      <fieldset id="product-media" className="grid gap-3">
        <legend className="font-semibold">Media</legend>{" "}
        <label className="form-label">
          URL e fotos
          <input
            name="image_url"
            type="url"
            className="field"
            placeholder="https://"
            defaultValue={product?.image_url ?? ""}
          />
        </label>
        <p className="muted-copy">
          Vendos linkun e fotos që dëshiron të shfaqësh në katalog.
        </p>
      </fieldset>
      <fieldset id="product-pricing" className="grid gap-3">
        <legend className="font-semibold">Çmimi</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="form-label">
            Shuma
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              className="field"
              defaultValue={product?.price_amount ?? ""}
              required={false}
            />
          </label>
          <label className="form-label">
            Monedha
            <input
              name="currency"
              className="field"
              maxLength={3}
              defaultValue={product?.currency ?? "ALL"}
              required
            />
          </label>
        </div>
      </fieldset>

      <fieldset id="product-process" className="grid gap-3">
        <legend className="font-semibold">Procesi i porosisë</legend>
        <label className="form-label">
          Lloji i produktit
          <select
            name="product_type_id"
            className="field"
            defaultValue={product?.product_type_id ?? ""}
            required={requireType}
          >
            <option value="">
              {requireType ? "Zgjidh llojin" : "Pa lloj"}
            </option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Workflow i biznesit
          <select
            name="workflow_id"
            className="field"
            defaultValue={product?.workflow_id ?? ""}
          >
            <option value="">Pa workflow</option>
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <label className="toggle-label">
        <span>
          Aktiv në katalog
          <small>Produktet joaktive nuk i sheh Agjenti AI.</small>
        </span>
        <input
          className="switch-input"
          type="checkbox"
          name="is_active"
          defaultChecked={product?.is_active ?? false}
        />
      </label>
    </>
  );
}
