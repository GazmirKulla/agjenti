"use client";
import { ProductBusinessWorkflow } from "@/components/products/business-workflow";
import type { Option } from "@/lib/products/catalog";
import { availabilityLabels, itemKind } from "@/lib/items/kinds";

type ProductFieldValues = {
  id?: string;
  name?: string;
  sku?: string | null;
  description?: string | null;
  image_url?: string | null;
  price_amount?: number | null;
  currency?: string | null;
  product_type_id?: string | null;
  workflow_id?: string | null;
  is_active?: boolean;
  attributes?: Record<string, string | number | boolean>;
  availability?: string;
  visual_draft?: { id: string; name: string; status: string } | null;
  visual_workflow?: { flowId: string; name: string } | null;
};

export function ProductFields({
  slug,
  product,
  types,
  workflows,
  requireType = false,
  kind,
}: {
  slug: string;
  product?: ProductFieldValues;
  types: { id: string; name: string }[];
  workflows: Option[];
  requireType?: boolean;
  /** The item kind; when given, its own fields and availability are part of the form. */
  kind?: string;
}) {
  const itemDefinition = kind ? itemKind(kind) : null;
  return (
    <>
      {itemDefinition && <input type="hidden" name="item_kind" value={itemDefinition.id} />}
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
          </div>
          <textarea
            name="description"
            className="field"
            rows={3}
            placeholder="Përshkruaj produktin, veçoritë dhe përdorimin e tij."
            defaultValue={product?.description ?? ""}
          />
        </div>
      </fieldset>

      {itemDefinition && (itemDefinition.fields.length > 0 || itemDefinition.availability.length > 1) && (
        <fieldset id="product-details" className="grid gap-3">
          <legend className="font-semibold">Të dhënat</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {itemDefinition.fields.map((field) => {
              const value = product?.attributes?.[field.key];
              if (field.type === "boolean") return (
                <label key={field.key} className="toggle-label">
                  <span>{field.label}</span>
                  <input className="switch-input" type="checkbox" name={`attr_${field.key}`} defaultChecked={value === true} />
                </label>
              );
              if (field.type === "select") return (
                <label key={field.key} className="form-label">
                  {field.label}
                  <select name={`attr_${field.key}`} className="field" defaultValue={typeof value === "string" ? value : ""}>
                    <option value="">—</option>
                    {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              );
              return (
                <label key={field.key} className="form-label">
                  {field.label}{field.unit ? ` (${field.unit})` : ""}
                  <input name={`attr_${field.key}`} className="field" type={field.type === "number" ? "number" : "text"}
                    min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? "any" : undefined}
                    placeholder={field.placeholder} defaultValue={value === undefined || value === true ? "" : String(value)} />
                </label>
              );
            })}
            {itemDefinition.availability.length > 1 && (
              <label className="form-label">
                Statusi
                <select name="availability" className="field" defaultValue={product?.availability ?? itemDefinition.availability[0]}>
                  {itemDefinition.availability.map((a) => <option key={a} value={a}>{availabilityLabels[a]}</option>)}
                </select>
              </label>
            )}
          </div>
          <p className="muted-copy">Agjenti i përdor këto të dhëna për të gjetur atë që kërkon klienti. Artikujt e shitur nuk u ofrohen klientëve.</p>
        </fieldset>
      )}

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
        <legend className="font-semibold">Workflow dhe produkti</legend>
        <ProductBusinessWorkflow slug={slug} workflow={workflows.find(w => w.businessWorkflow)?.businessWorkflow} product={product?.id ? { ...product, id: product.id } : undefined} />
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
        <details open={Boolean(product?.workflow_id)}>
          <summary>Proces i posaçëm i porosisë (opsional)</summary>
        <label className="form-label">
          Procesi pas zgjedhjes së produktit
          <select
            name="workflow_id"
            key={workflows.map(workflow => workflow.id).join("|")}
            className="field"
            defaultValue={product?.workflow_id ?? ""}
          >
            <option value="">{product?.visual_workflow || product?.visual_draft ? "Ruaj procesin vizual ekzistues" : "Përdor workflow-in kryesor"}</option>
            {workflows.filter(w => w.id).map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
        </label>
        </details>
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
