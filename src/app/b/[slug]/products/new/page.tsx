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
import { scanInstagramProducts } from "@/lib/products/import-actions";
import { createServiceSupabase } from "@/lib/supabase/service";

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

  let instagramStatus: string | null = null;
  let instagramUsername: string | null = null;
  if (method === "instagram" || method === "csv") {
    const { data: ig } = await createServiceSupabase()
      .from("instagram_connections")
      .select("username,status")
      .eq("business_id", data.business.id)
      .neq("status", "disconnected")
      .maybeSingle();
    instagramStatus = ig?.status ?? null;
    instagramUsername = ig?.username ?? null;
  }

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
      ) : method === "csv" || method === "instagram" ? (
        <div className="products-workspace">
          <ProductIntake
            slug={slug}
            types={data.types}
            workflows={data.workflows}
            instagramStatus={instagramStatus}
            instagramUsername={instagramUsername}
            createAction={createProduct.bind(null, slug)}
            importAction={importProductBatch.bind(null, slug)}
            scanAction={
              method === "instagram"
                ? scanInstagramProducts.bind(null, slug)
                : undefined
            }
            initialMethod={method === "instagram" ? "instagram" : "csv"}
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
                : "Importo nga website-i"}
            </h2>
            <p className="muted-copy">
              Përdor panelin e përbashkët për të nxjerrë produktet, për të
              plotësuar informacionin që mungon dhe për t’i konfirmuar. Pastaj
              lidhi me llojin dhe workflow-n.
            </p>
            <IntelligenceTrigger
              source={method as "audio" | "website"}
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
