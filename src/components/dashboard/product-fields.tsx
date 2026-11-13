"use client";
import { useState } from "react";
import { priceModeLabels, priceModes, priceMode } from "@/lib/products/pricing";
import { ProductBusinessWorkflow } from "@/components/products/business-workflow";
import type { Option } from "@/lib/products/catalog";
import { availabilityLabels, fieldsOf, itemKind } from "@/lib/items/kinds";
import { attributeFields, variantFields, type BusinessField } from "@/lib/items/fields";
import type { ProductVariant } from "@/lib/products/variants";
import { VariantEditor } from "@/components/products/variant-editor";

type ProductFieldValues = {
  id?: string;
  name?: string;
  sku?: string | null;
  description?: string | null;
  image_url?: string | null;
  price_amount?: number | null;
  price_mode?: string | null;
  price_max?: number | null;
  price_unit?: string | null;
  currency?: string | null;
  product_type_id?: string | null;
  workflow_id?: string | null;
  is_active?: boolean;
  attributes?: Record<string, string | number | boolean | string[]>;
  availability?: string;
  variants?: ProductVariant[];
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
  fields = [],
}: {
  slug: string;
  product?: ProductFieldValues;
  types: { id: string; name: string }[];
  workflows: Option[];
  requireType?: boolean;
  /** The item kind; when given, its own fields and availability are part of the form. */
  kind?: string;
  /** The business's own product fields and variant choices. */
  fields?: BusinessField[];
}) {
  const kindDefinition = kind ? itemKind(kind) : null;
  const itemDefinition = kindDefinition ? { ...kindDefinition, fields: fieldsOf(kindDefinition.id, attributeFields(fields)) } : null;
  const choices = variantFields(fields);
  const [mode, setMode] = useState(priceMode(product?.price_mode));
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

      {itemDefinition && choices.length > 0 && (
        <fieldset id="product-choices" className="grid gap-3">
          <legend className="font-semibold">Vlerat që zgjedh klienti</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {choices.map(field => {
              const list = product?.attributes?.[field.key];
              return (
                <label key={field.key} className="form-label">
                  {field.label}{field.unit ? ` (${field.unit})` : ""}
                  <input name={`choices_${field.key}`} className="field" defaultValue={Array.isArray(list) ? list.join("; ") : ""}
                    placeholder={field.options?.length ? field.options.slice(0, 3).join("; ") : "P.sh. 2; 3; 4"} />
                </label>
              );
            })}
          </div>
          <p className="muted-copy">Ndaji vlerat me ;. Agjenti e pyet klientin cilën dëshiron. Kur një vlerë ka kod ose çmim tjetër, shtoje si variant më poshtë; atëherë vlejnë variantet.</p>
        </fieldset>
      )}

      {itemDefinition && choices.length > 0 && (
        <VariantEditor fields={choices} variants={product?.variants ?? []} currency={product?.currency ?? "ALL"} />
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
            Mënyra e çmimit
            <select name="price_mode" className="field" value={mode} onChange={e => setMode(priceMode(e.target.value))}>
              {priceModes.map(m => <option key={m} value={m}>{priceModeLabels[m]}</option>)}
            </select>
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
          {mode !== "request" && (
            <label className="form-label">
              {mode === "range" ? "Nga" : mode === "from" ? "Duke filluar nga" : "Shuma"}
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                className="field"
                defaultValue={product?.price_amount ?? ""}
                required={mode !== "fixed"}
              />
            </label>
          )}
          {mode === "range" && (
            <label className="form-label">
              Deri
              <input name="price_max" type="number" min="0" step="0.01" className="field" defaultValue={product?.price_max ?? ""} required />
            </label>
          )}
          {mode !== "request" && (
            <label className="form-label">
              Për njësi (opsionale)
              <input name="price_unit" className="field" maxLength={20} placeholder="P.sh. m³, copë, m" defaultValue={product?.price_unit ?? ""} />
            </label>
          )}
        </div>
        {mode === "request" && <p className="muted-copy">Klienti e merr çmimin nga stafi. Agjenti nuk jep çmim dhe nuk e porosit vetë këtë produkt.</p>}
        {(mode === "range" || mode === "from") && <p className="muted-copy">Agjenti e tregon këtë çmim. Porosia automatike kërkon një çmim të caktuar, p.sh. te variantet.</p>}
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
