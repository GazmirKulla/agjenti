"use client";
import { useEffect, useState } from "react";
import { ProductFieldsSettings } from "@/components/products/product-fields-settings";
import { StockSettingsForm } from "@/components/products/stock-settings";
import type { BusinessField } from "@/lib/items/fields";
import type { StockSettings } from "@/lib/products/stock";
import { saveStockSettings } from "@/lib/items/actions";

type Structure = {
  enabled: true; names: { plural: string; singular: string }; fields: BusinessField[];
  fixed: { name: string; fields: { key: string; label: string }[] };
  suggested: { category: string | null; fields: BusinessField[] };
  discovered: (BusinessField & { evidence: string })[];
  stock: StockSettings | null; stockEvidence: string | null;
};

/**
 * Onboarding: the products' structure, confirmed before the dashboard opens. The same fields editor and
 * stock rules as Produktet → Struktura, with what the scan found on the business's pages to add. Each part
 * saves on its own; "Vazhdo" moves on whether or not the owner changed anything.
 */
export function ProductStructureStep({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [structure, setStructure] = useState<Structure | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/onboarding/product-structure?slug=${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(response => response.ok ? response.json() : { enabled: false })
      .catch(() => ({ enabled: false }))
      .then((data: Structure | { enabled: false }) => {
        if (!live) return;
        if (!data.enabled) onDone(); else setStructure(data);
      });
    return () => { live = false; };
  }, [slug, onDone]);
  if (!structure) return <div className="onboarding-learning" role="status"><span className="onboarding-spinner" aria-hidden="true" /> Agjenti po përgatit strukturën e produkteve…</div>;
  return (
    <section className="onboarding-structure" aria-label="Struktura e produkteve">
      <p className="profile-review-lead">
        Kështu do të ruhen {structure.names.plural.toLocaleLowerCase("sq")} e tua. Çdo fushë është një e dhënë që Agjenti ua tregon klientëve
        ose i pyet para porosisë. Ruaj çfarë të duhet; çdo gjë ndryshohet më vonë te {structure.names.plural} → Struktura.
      </p>
      <ProductFieldsSettings slug={slug} fields={structure.fields} fixed={structure.fixed} suggested={structure.suggested} discovered={structure.discovered} />
      {structure.stock && (
        <>
          {structure.stockEvidence && <p className="muted-copy">Agjenti propozon “{structure.stock.defaultMode === "unique" ? "Copë unike" : "Ndiq stokun"}” sepse te faqet e tua gjeti: “{structure.stockEvidence}”.</p>}
          <StockSettingsForm settings={structure.stock} action={data => saveStockSettings(slug, data)} />
        </>
      )}
      <div className="onboarding-actions">
        <button type="button" className="onboarding-back" onClick={onDone}>Më vonë</button>
        <div className="onboarding-actions-end">
          <button type="button" className="onboarding-next" onClick={onDone}>Vazhdo</button>
        </div>
      </div>
    </section>
  );
}
