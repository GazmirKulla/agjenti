import { notFound } from "next/navigation";
import { loadProducts } from "@/lib/products/load";
import { ProductHeading } from "@/components/products/shared";
import { ProductEditor } from "@/components/products/editor";
import { ProductDetail } from "@/components/products/detail";
export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { slug, id } = await params;
  const { edit } = await searchParams;
  const data = await loadProducts(slug);
  const product = data.products.find((p) => p.id === id);
  if (!product) notFound();
  // The page opens in view mode; "Përditëso" adds ?edit=1 for the full form.
  if (!edit)
    return (
      <ProductDetail
        key={product.id + (product.updated_at ?? "")}
        slug={slug}
        product={product}
        types={data.types}
        workflows={data.workflows}
        kind={product.item_kind ?? data.items.kind.id}
        fields={data.items.fields}
      />
    );
  return (
    <>
      <ProductHeading
        slug={slug}
        names={data.items.names}
        title="Përditëso produktin"
        description="Ndrysho informacionin, çmimin, variantet dhe procesin e porosisë."
        back={{ href: `/b/${slug}/products/${product.id}`, label: product.name }}
        actions="none"
      />
      <ProductEditor
        key={product.id + JSON.stringify(product)}
        slug={slug}
        product={product}
        types={data.types}
        workflows={data.workflows}
        kind={product.item_kind ?? data.items.kind.id}
        fields={data.items.fields}
      />
    </>
  );
}
