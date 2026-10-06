import { loadProducts } from "@/lib/products/load";
import {
  ProductHeading,
  ProductMethods,
  ProductTips,
} from "@/components/products/shared";
import { ProductEditor } from "@/components/products/editor";
import { ProductIntake } from "@/components/dashboard/product-intake";
import { IntelligenceTrigger } from "@/components/business-intelligence/trigger";
import { createProduct, importProductBatch } from "@/lib/products/actions";
export default async function NewProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ method?: string }>;
}) {
  const { slug } = await params;
  const { method: requested } = await searchParams;
  const method = ["manual", "csv", "website", "instagram", "audio"].includes(
    requested ?? "",
  )
    ? requested!
    : "manual";
  const data = await loadProducts(slug);
  return (
    <>
      <ProductHeading
        slug={slug}
        title="Shto produkt të ri"
        description="Shto produktet dorazi, nga website, CSV, Instagram ose audio."
      />
      <ProductMethods slug={slug} active={method} />
      {method === "manual" ? (
        <ProductEditor
          slug={slug}
          types={data.types}
          workflows={data.workflows}
        />
      ) : method === "csv" ? (
        <div className="products-workspace">
          <ProductIntake
            slug={slug}
            types={data.types}
            workflows={data.workflows}
            instagramStatus={null}
            instagramUsername={null}
            createAction={createProduct.bind(null, slug)}
            importAction={importProductBatch.bind(null, slug)}
            initialMethod="csv"
            hideTabs
          />
          <ProductTips />
        </div>
      ) : (
        <div className="products-workspace">
          <section className="panel section-pad">
            <h2>
              {method === "audio"
                ? "Përshkruaj produktin me zë"
                : method === "website"
                  ? "Importo nga website-i"
                  : "Analizo postimet e Instagram-it"}
            </h2>
            <p className="muted-copy">
              Përdor panelin e përbashkët për të nxjerrë produktet, për të
              plotësuar informacionin që mungon dhe për t’i konfirmuar. Pastaj
              lidhi me llojin dhe workflow-n.
            </p>
            <IntelligenceTrigger
              source={method as "audio" | "website" | "instagram"}
            >
              Hap {method === "audio" ? "regjistrimin" : "analizën"} →
            </IntelligenceTrigger>
          </section>
          <ProductTips />
        </div>
      )}
    </>
  );
}
