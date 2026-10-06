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
          {error} <Link href={`/b/${slug}/settings`}>Cilësimet →</Link>
        </p>
      )}
      {remote.length > 0 && (
        <section className="panel section-pad product-external">
          <h2>Katalogu i jashtëm</h2>
          <p className="muted-copy">
            Lidh produktet si draft. Plotëso workflow-n dhe kontrollo çmimet
            para aktivizimit.
          </p>
          {remote.map((p) => (
            <div key={p.id} className="product-external-row">
              <div>
                <strong>{p.name}</strong>
                <p>{p.price ?? "Pa çmim"}</p>
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
