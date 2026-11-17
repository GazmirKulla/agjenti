import Link from "next/link";
import { loadProducts } from "@/lib/products/load";
import { ProductHeading, ProductMethods } from "@/components/products/shared";
import { ProductCatalog } from "@/components/products/catalog";
import {
  fetchLinkedCatalog,
  isExternalCatalogLinked,
} from "@/lib/integrations/zana";
import { ActionForm } from "@/components/dashboard/action-form";
import { linkExternalProduct } from "@/lib/products/actions";
import { refreshLinkedProducts } from "@/lib/products/linked-actions";
/** The website's price: its own, or the lowest variant price ("nga 1200 ALL"). */
function externalPriceLabel(p: { price: number | null; currency?: string; formats?: { price: number | null }[] } & Record<string, unknown>) {
  const variants = Array.isArray(p.variants) ? (p.variants as { price?: unknown }[]) : p.formats ?? [];
  const prices = variants.map((v) => v.price).filter((x): x is number => typeof x === "number");
  const currency = p.currency ?? "ALL";
  if (typeof p.price === "number") return `${prices.length > 1 && new Set(prices).size > 1 ? "nga " : ""}${p.price} ${currency}`;
  return prices.length ? `nga ${Math.min(...prices)} ${currency}` : "Pa çmim";
}

export default async function ImportedProductsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadProducts(slug);
  let remote: Awaited<ReturnType<typeof fetchLinkedCatalog>> = [];
  let error = "";
  if (await isExternalCatalogLinked(data.business.id)) {
    try {
      remote = await fetchLinkedCatalog(data.business.id);
    } catch {
      error =
        "Katalogu i jashtëm nuk u ngarkua. Kontrollo lidhjen te cilësimet.";
    }
  }
  return (
    <>
      <ProductHeading
        slug={slug}
        title="Lidh produktet e importuara"
        description="Rishiko produktet dhe cakto llojin e workflow-n përpara aktivizimit."
      />
      <details className="panel section-pad product-import-picker">
        <summary>Importo produkte të tjera</summary>
        <ProductMethods slug={slug} />
      </details>
      <ProductCatalog
        slug={slug}
        products={data.products}
        types={data.types}
        workflows={data.workflows}
        mapping
      />
      {error && (
        <p role="alert" className="catalog-notice">
          {error} <Link href={`/b/${slug}/products?detail=website`}>Lidhja me webin →</Link>
        </p>
      )}
      {remote.length > 0 && (
        <section className="panel section-pad product-external">
          <h2>Katalogu i jashtëm</h2>
          <p className="muted-copy">
            Lidh produktet si draft. Variantet, çmimet dhe të dhënat që kërkon
            porosia merren nga webi; plotëso workflow-n para aktivizimit.
          </p>
          {data.products.some((row) => row.external_id) && (
            <ActionForm action={refreshLinkedProducts.bind(null, slug)}>
              <button className="btn btn-ghost">Rifresko nga webi</button>
            </ActionForm>
          )}
          {remote.map((p) => (
            <div key={p.id} className="product-external-row">
              <div>
                <strong>{p.name}</strong>
                <p>{externalPriceLabel(p)}</p>
              </div>
              {data.products.some((row) => row.external_id === p.id) ? (
                <Link
                  className="btn btn-ghost"
                  href={`/b/${slug}/products/${data.products.find((row) => row.external_id === p.id)!.id}`}
                >
                  Hap produktin e lidhur
                </Link>
              ) : (
                <ActionForm action={linkExternalProduct.bind(null, slug)}>
                  <input type="hidden" name="external_id" value={p.id} />
                  <input type="hidden" name="name" value={p.name} />
                  <input type="hidden" name="price" value={p.price ?? ""} />
                  <input type="hidden" name="currency" value="ALL" />
                  <button className="btn btn-ghost">Lidh si draft</button>
                </ActionForm>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
