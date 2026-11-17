"use client";
import Link from "next/link";
import { stockCustomerSentence, stockDeductLabels, stockModeLabels, stockModes, type StockMode, type StockSettings } from "@/lib/products/stock";

/**
 * The product's stock: how it is counted, its count and, in the agent's words, what a customer who
 * asks would hear. The order rule (when orders take stock) is the business's and is shown, not edited, here.
 * Variant counts are entered in the variant table; this section's count is for the product and for
 * variants without their own.
 */
export function StockSection({ slug, settings, mode, onMode, quantity, onQuantity, hasVariantFields, unit, linked }: {
  slug: string; settings: StockSettings; mode: StockMode; onMode: (mode: StockMode) => void;
  quantity: string; onQuantity: (value: string) => void; hasVariantFields: boolean; unit?: string | null; linked: boolean;
}) {
  if (linked) return (
    <fieldset id="product-stock" className="grid gap-3">
      <legend className="font-semibold">Gjendja</legend>
      <p className="muted-copy">Ky produkt vjen nga uebi i biznesit: stoku i tij mbahet atje dhe nuk ndryshohet këtu.</p>
    </fieldset>
  );
  const count = quantity.trim() === "" ? null : Number(quantity.replace(",", "."));
  const preview = mode === "off" ? null : Number.isFinite(count) ? count : null;
  return (
    <fieldset id="product-stock" className="grid gap-3">
      <legend className="font-semibold">Gjendja</legend>
      <input type="hidden" name="stock_mode" value={mode} />
      <div className="product-stock-modes" role="radiogroup" aria-label="Si ndiqet stoku">
        {stockModes.map(option => (
          <label key={option} className={`product-stock-mode${mode === option ? " is-selected" : ""}`}>
            <input type="radio" name="stock_mode_choice" value={option} checked={mode === option}
              onChange={() => { onMode(option); if (option === "unique" && quantity.trim() === "") onQuantity("1"); }} />
            <span><strong>{stockModeLabels[option].label}</strong><small>{stockModeLabels[option].hint}</small></span>
          </label>
        ))}
      </div>
      {mode === "tracked" && (
        <label className="form-label">
          Sasia në gjendje{unit ? ` (${unit})` : ""}
          <input name="stock_quantity" className="field" type="number" min="0" step="any" inputMode="decimal" value={quantity}
            placeholder={hasVariantFields ? "Bosh kur çdo variant ka sasinë e vet" : "P.sh. 12"} onChange={e => onQuantity(e.target.value)} />
          {hasVariantFields && <small className="muted-copy">Sasinë e çdo varianti e vendos te tabela e varianteve; një variant pa sasi përdor këtë.</small>}
        </label>
      )}
      {mode === "unique" && (
        <label className="toggle-label">
          <span>Është ende në shitje<small>Kur shitet nga një porosi, kalon vetë te “Shitur”.</small></span>
          <input className="switch-input" type="checkbox" checked={quantity !== "0"} onChange={e => onQuantity(e.target.checked ? "1" : "0")} />
          <input type="hidden" name="stock_quantity" value={quantity === "0" ? "0" : "1"} />
        </label>
      )}
      <p className="product-stock-preview" role="status">
        <strong>Nëse klienti pyet, Agjenti thotë:</strong> {stockCustomerSentence(preview, settings, unit)}
        {mode === "tracked" && hasVariantFields && " Për variantet e thotë për secilin veç."}
      </p>
      {mode !== "off" && (
        <p className="muted-copy">
          {stockDeductLabels[settings.deduct].effect}{" "}
          <Link className="inline-link" href={`/b/${slug}/products/structure#stock`}>Ndrysho rregullin →</Link>
        </p>
      )}
    </fieldset>
  );
}
