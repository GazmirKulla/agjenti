"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { suggestProductFields } from "@/lib/products/ai-actions";
import { priceModeLabels, priceModes, priceMode } from "@/lib/products/pricing";
import { ProductBusinessWorkflow } from "@/components/products/business-workflow";
import type { Option } from "@/lib/products/catalog";
import { availabilityLabels, fieldsOf, itemKind } from "@/lib/items/kinds";
import { attributeFields, variantFields, type BusinessField } from "@/lib/items/fields";
import { shownFieldKeys, type FieldUsage } from "@/lib/items/field-visibility";
import type { ProductVariant } from "@/lib/products/variants";
import { VariantEditor } from "@/components/products/variant-editor";
import { StockSection } from "@/components/products/stock-section";
import { filledFields } from "@/lib/products/readiness";
import type { StockMode, StockSettings } from "@/lib/products/stock";

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
  source?: string | null;
  stock_mode?: StockMode;
  stock_quantity?: number | null;
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
  creating = false,
  photoAside = false,
  usage,
  autoSuggest = false,
  stock,
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
  /** A new product from the manual form: no step template and no sold/available status (it starts available). */
  creating?: boolean;
  /** The photo is edited beside the form, so there is no Media section here. */
  photoAside?: boolean;
  /** How many of the business's products fill each field: decides which fields show at once. */
  usage?: FieldUsage;
  /** Runs "Plotëso me AI" once when the form opens (a product read from a website). */
  autoSuggest?: boolean;
  /** How the business counts stock; without it the form has no stock section. */
  stock?: StockSettings;
}) {
  const showAvailability = !creating && (itemKind(kind ?? "product").availability.length > 1);
  const kindDefinition = kind ? itemKind(kind) : null;
  const itemDefinition = kindDefinition ? { ...kindDefinition, fields: fieldsOf(kindDefinition.id, attributeFields(fields)) } : null;
  const choices = variantFields(fields);
  const own = attributeFields(fields);
  const [initiallyShown] = useState(() => shownFieldKeys(own, product?.attributes, usage));
  const [revealed, setRevealed] = useState<string[]>([]);
  const ownKeys = new Set(own.map(f => f.key));
  const visible = (key: string) => !ownKeys.has(key) || initiallyShown.has(key) || revealed.includes(key);
  const waiting = itemDefinition ? itemDefinition.fields.filter(f => !visible(f.key)) : [];
  const details = useRef<HTMLFieldSetElement>(null);
  const [suggesting, startSuggest] = useTransition();
  const [aiMessage, setAiMessage] = useState<{ error?: string; success?: string }>({});
  // Fills only the empty fields: what the owner typed is never overwritten.
  const suggest = () => startSuggest(async () => {
    const form = details.current?.form;
    if (!form || !itemDefinition) return;
    setAiMessage({});
    const result = await suggestProductFields(slug, new FormData(form));
    if ("error" in result) { setAiMessage({ error: result.error }); return; }
    const filled: string[] = [];
    const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    for (const field of itemDefinition.fields) {
      const value = result.suggestion.values[field.key];
      const element = input(`attr_${field.key}`);
      if (value === undefined || !element) continue;
      if (element instanceof HTMLInputElement && element.type === "checkbox") { if (element.checked) continue; element.checked = value === true; }
      else { if (element.value.trim()) continue; element.value = String(value); }
      filled.push(field.label);
    }
    for (const field of choices) {
      const list = result.suggestion.choices[field.key];
      const element = input(`choices_${field.key}`);
      if (!list?.length || !element || element.value.trim()) continue;
      element.value = list.join("; ");
      filled.push(field.label);
    }
    const keys = [...Object.keys(result.suggestion.values)];
    setRevealed(current => [...new Set([...current, ...keys])]);
    setAiMessage(filled.length
      ? { success: `AI plotësoi: ${filled.join(", ")}. Kontrolloji para se të ruash.` }
      : { error: "AI nuk gjeti të dhëna të qarta për fushat bosh. Shto më shumë te përshkrimi ose plotësoji vetë." });
  });
  const hasFields = !!itemDefinition && (itemDefinition.fields.length > 0 || choices.length > 0);
  const noDetails = hasFields && !!itemDefinition && filledFields(itemDefinition.fields.map(f => f.key), product?.attributes).filled === 0
    && choices.every(f => !(Array.isArray(product?.attributes?.[f.key]) && (product?.attributes?.[f.key] as string[]).length));
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoSuggest || !hasFields || autoRan.current) return;
    autoRan.current = true;
    suggest();
  });
  const [mode, setMode] = useState(priceMode(product?.price_mode));
  const [stockMode, setStockMode] = useState<StockMode>(product?.stock_mode ?? (product?.id ? "off" : stock?.defaultMode ?? "off"));
  const [stockQuantity, setStockQuantity] = useState(product?.stock_quantity == null ? "" : String(product.stock_quantity));
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

      {itemDefinition && (
        <fieldset id="product-details" className="grid gap-3" ref={details}>
          <legend className="font-semibold">Të dhënat</legend>
          {(itemDefinition.fields.length > 0 || choices.length > 0) && (
            // All empty: the agent can only match this product by its name, so filling them is the useful next step.
            <div className={`product-ai-fill${noDetails ? " is-empty" : ""}`}>
              {noDetails && <p><strong>Të dhënat janë bosh.</strong> Agjenti e gjen këtë produkt vetëm kur klienti thotë emrin. AI mund t’i plotësojë nga emri dhe përshkrimi; i kontrollon para se të ruash.</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={noDetails ? "btn btn-primary" : "btn btn-ghost"} onClick={suggest} disabled={suggesting}>
                  {suggesting ? "AI po lexon…" : "✦ Plotëso me AI"}
                </button>
                {!noDetails && <span className="muted-copy">Nga emri dhe përshkrimi; plotëson vetëm fushat bosh.</span>}
              </div>
            </div>
          )}
          {aiMessage.error && <p className="form-feedback form-feedback-error" role="alert">{aiMessage.error}</p>}
          {aiMessage.success && <p className="form-feedback form-feedback-success" role="status">{aiMessage.success}</p>}
          {itemDefinition.fields.length === 0 && (
            <p className="muted-copy">Ende nuk ke fusha. Shto p.sh. Ngjyra, Masa ose Materiali, që Agjenti t’ua tregojë klientëve dhe t’i pyesë para porosisë.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {itemDefinition.fields.map((field) => {
              const value = product?.attributes?.[field.key];
              // A field waiting behind "+ Shto të dhënë" stays in the form (hidden), so saving keeps its value.
              const hidden = visible(field.key) ? undefined : { display: "none" } as const;
              if (field.type === "boolean") return (
                <label key={field.key} className="toggle-label" style={hidden} data-field={field.key}>
                  <span>{field.label}</span>
                  <input className="switch-input" type="checkbox" name={`attr_${field.key}`} defaultChecked={value === true} />
                </label>
              );
              if (field.type === "select") return (
                <label key={field.key} className="form-label" style={hidden} data-field={field.key}>
                  {field.label}
                  <select name={`attr_${field.key}`} className="field" defaultValue={typeof value === "string" ? value : ""}>
                    <option value="">—</option>
                    {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              );
              return (
                <label key={field.key} className="form-label" style={hidden} data-field={field.key}>
                  {field.label}{field.unit ? ` (${field.unit})` : ""}
                  <input name={`attr_${field.key}`} className="field" type={field.type === "number" ? "number" : "text"}
                    min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? "any" : undefined}
                    placeholder={field.placeholder} defaultValue={value === undefined || value === true ? "" : String(value)} />
                </label>
              );
            })}
            {showAvailability && (
              <label className="form-label">
                Statusi
                <select name="availability" className="field" defaultValue={product?.availability ?? itemDefinition.availability[0]}>
                  {itemDefinition.availability.map((a) => <option key={a} value={a}>{availabilityLabels[a]}</option>)}
                </select>
              </label>
            )}
          </div>
          {waiting.length > 0 && (
            <label className="form-label">
              <span className="sr-only">Shto të dhënë</span>
              <select className="field" value="" aria-label="Shto të dhënë"
                onChange={e => { const key = e.target.value; if (key) setRevealed(current => [...current, key]); }}>
                <option value="">+ Shto të dhënë ({waiting.length})…</option>
                {waiting.map(f => <option key={f.key} value={f.key}>{f.label}{f.unit ? ` (${f.unit})` : ""}</option>)}
              </select>
            </label>
          )}
          <p className="muted-copy">
            {itemDefinition.fields.length > 0 && <>Agjenti i përdor këto të dhëna për të gjetur atë që kërkon klienti.{showAvailability ? " Artikujt e shitur nuk u ofrohen klientëve." : ""} </>}
            <Link className="inline-link" href={`/b/${slug}/products/structure#fields`}>{itemDefinition.fields.length > 0 ? "Ndrysho fushat" : "Shto fushat"} →</Link>
          </p>
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
          <p className="muted-copy">Ndaji vlerat me ;. Agjenti e pyet klientin cilën dëshiron. Kur një vlerë ka kod ose çmim tjetër, shtoje si variant më poshtë; atëherë vlejnë variantet. <Link className="inline-link" href={`/b/${slug}/products/structure#fields`}>Ndrysho fushat →</Link></p>
        </fieldset>
      )}

      {itemDefinition && choices.length > 0 && (
        <VariantEditor fields={choices} variants={product?.variants ?? []} currency={product?.currency ?? "ALL"}
          stockTracked={Boolean(stock) && stockMode === "tracked" && product?.source !== "linked"} />
      )}

      {!photoAside && <fieldset id="product-media" className="grid gap-3">
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
      </fieldset>}
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

      {itemDefinition && stock && (
        <StockSection slug={slug} settings={stock} mode={stockMode} onMode={setStockMode} quantity={stockQuantity} onQuantity={setStockQuantity}
          hasVariantFields={choices.length > 0} unit={product?.price_unit} linked={product?.source === "linked"} />
      )}

      <fieldset id="product-process" className="grid gap-3">
        <legend className="font-semibold">Workflow dhe produkti</legend>
        <ProductBusinessWorkflow slug={slug} workflow={workflows.find(w => w.businessWorkflow)?.businessWorkflow} product={product?.id ? { ...product, id: product.id } : undefined} />
        {!creating && <label className="form-label">
          <span>Shablloni i porosisë <span className="muted-copy">(opsional)</span></span>
          <select
            name="product_type_id"
            className="field"
            defaultValue={product?.product_type_id ?? ""}
            required={requireType}
          >
            <option value="">
              {requireType ? "Zgjidh shabllonin" : "Pa shabllon (te një produkt i ri zgjidhet vetë)"}
            </option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>}
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

      <label className="toggle-label" id="product-active">
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
