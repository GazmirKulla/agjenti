import { loadProducts } from "@/lib/products/load";
import {
  ProductHeading,
  ProductMethods,
  ProductMethodTip,
  ProductTips,
} from "@/components/products/shared";
import { ProductEditor } from "@/components/products/editor";
import { ProductIntake } from "@/components/dashboard/product-intake";
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
  // Without a method the page is the chooser: three cards and a tip.
  const method = ["manual", "csv", "instagram"].includes(requested ?? "")
    ? requested!
    : null;
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
        names={data.items.names}
        title={data.items.titles.create}
        description="Zgjidh mënyrën më të shpejtë për të shtuar produkte në katalog."
        actions="none"
      />
      <ProductMethods slug={slug} active={method ?? undefined} />
      {!method ? (
        <ProductMethodTip />
      ) : method === "manual" ? (
        <ProductEditor
          slug={slug}
          types={data.types}
          workflows={data.workflows}
          kind={data.items.kind.id}
        fields={data.items.fields}
        />
      ) : (
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
      )}
    </>
  );
}
